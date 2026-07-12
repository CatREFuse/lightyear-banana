import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const { values } = parseArgs({
  options: {
    version: { type: 'string' },
    'build-number': { type: 'string' },
    check: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false }
  },
  strict: true
})

const version = values.version?.trim()
const buildNumber = values['build-number']?.trim()

if (!version || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
  throw new Error('--version must be a release version in x.y.z format')
}

if (!buildNumber || !/^\d{12}$/.test(buildNumber)) {
  throw new Error('--build-number must contain exactly 12 digits')
}

if (values.check && values['dry-run']) {
  throw new Error('--check and --dry-run cannot be used together')
}

const targetFiles = {
  packageJson: 'package.json',
  packageLock: 'package-lock.json',
  pluginManifest: 'plugin/manifest.json',
  standaloneManifest: 'standalone-uxp-plugin/manifest.json',
  electronMain: 'electron/main.js',
  buildInfo: 'src/buildInfo.ts',
  standaloneIndex: 'standalone-uxp-plugin/index.html',
  standaloneMain: 'standalone-uxp-plugin/main.js',
  standalonePackage: 'standalone-uxp-plugin/package.mjs',
  readme: 'README.md'
}

function absolutePath(relativePath) {
  return path.join(projectRoot, relativePath)
}

function readText(relativePath) {
  return readFileSync(absolutePath(relativePath), 'utf8')
}

function replaceExactlyOnce(source, pattern, replacement, label) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const matches = [...source.matchAll(new RegExp(pattern.source, flags))]
  if (matches.length !== 1) {
    throw new Error(`${label} must match exactly once; found ${matches.length}`)
  }

  return source.replace(pattern, () => replacement)
}

function replaceAllMatches(source, pattern, replacement, label) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const globalPattern = new RegExp(pattern.source, flags)
  const matches = [...source.matchAll(globalPattern)]
  if (!matches.length) {
    throw new Error(`${label} must match at least once`)
  }

  return source.replace(globalPattern, replacement)
}

function stageJson(stagedFiles, relativePath, update) {
  const source = readText(relativePath)
  const value = JSON.parse(source)
  update(value)
  const lineEnding = source.includes('\r\n') ? '\r\n' : '\n'
  const serialized = `${JSON.stringify(value, null, 2)}\n`.replaceAll('\n', lineEnding)
  stagedFiles.set(relativePath, serialized)
}

function stageText(stagedFiles, relativePath, update) {
  stagedFiles.set(relativePath, update(readText(relativePath)))
}

function stageReleaseVersion() {
  const stagedFiles = new Map()

  stageJson(stagedFiles, targetFiles.packageJson, (packageJson) => {
    packageJson.version = version
  })

  stageJson(stagedFiles, targetFiles.packageLock, (packageLock) => {
    if (!packageLock.packages?.['']) {
      throw new Error('package-lock.json is missing packages[""]')
    }

    packageLock.version = version
    packageLock.packages[''].version = version
  })

  for (const manifestPath of [targetFiles.pluginManifest, targetFiles.standaloneManifest]) {
    stageJson(stagedFiles, manifestPath, (manifest) => {
      manifest.version = version
    })
  }

  stageText(stagedFiles, targetFiles.electronMain, (source) =>
    replaceExactlyOnce(
      source,
      /const UXP_PACKAGE_FILE = 'lightyear-banana-[^'\r\n]+\.ccx'/,
      `const UXP_PACKAGE_FILE = 'lightyear-banana-${version}.ccx'`,
      'electron UXP package filename'
    )
  )

  stageText(stagedFiles, targetFiles.buildInfo, (source) => {
    let updated = replaceExactlyOnce(
      source,
      /version: '[^'\r\n]+'/,
      `version: '${version}'`,
      'buildInfo version'
    )
    updated = replaceExactlyOnce(
      updated,
      /buildNumber: '[^'\r\n]+'/,
      `buildNumber: '${buildNumber}'`,
      'buildInfo build number'
    )
    return replaceExactlyOnce(
      updated,
      /displayVersion: '[^'\r\n]+'/,
      `displayVersion: 'v${version}+${buildNumber}'`,
      'buildInfo display version'
    )
  })

  stageText(stagedFiles, targetFiles.standaloneIndex, (source) =>
    replaceExactlyOnce(
      source,
      /Lightyear Banana v\d+\.\d+\.\d+/,
      `Lightyear Banana v${version}`,
      'standalone index version'
    )
  )

  stageText(stagedFiles, targetFiles.standaloneMain, (source) =>
    replaceExactlyOnce(
      source,
      /const APP_TITLE = 'Lightyear Banana v\d+\.\d+\.\d+'/,
      `const APP_TITLE = 'Lightyear Banana v${version}'`,
      'standalone app title version'
    )
  )

  stageText(stagedFiles, targetFiles.standalonePackage, (source) =>
    replaceExactlyOnce(
      source,
      /lightyear-banana-standalone-\d+\.\d+\.\d+\.zip/,
      `lightyear-banana-standalone-${version}.zip`,
      'standalone archive version'
    )
  )

  stageText(stagedFiles, targetFiles.readme, (source) => {
    let updated = replaceAllMatches(
      source,
      /lightyear-banana-\d+\.\d+\.\d+-(mac|win)\.zip/,
      (_match, platform) => `lightyear-banana-${version}-${platform}.zip`,
      'README desktop archive versions'
    )
    updated = replaceAllMatches(
      updated,
      /lightyear-banana-\d+\.\d+\.\d+\.ccx/,
      `lightyear-banana-${version}.ccx`,
      'README CCX versions'
    )
    return replaceAllMatches(
      updated,
      /dist\/release-\d+\.\d+\.\d+\//,
      `dist/release-${version}/`,
      'README release directory version'
    )
  })

  return stagedFiles
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`)
  }
}

function verifyReleaseVersion(read = readText) {
  const readTargetJson = (relativePath) => JSON.parse(read(relativePath))
  const packageJson = readTargetJson(targetFiles.packageJson)
  const packageLock = readTargetJson(targetFiles.packageLock)
  const pluginManifest = readTargetJson(targetFiles.pluginManifest)
  const standaloneManifest = readTargetJson(targetFiles.standaloneManifest)

  assertEqual(packageJson.version, version, 'package.json version')
  assertEqual(packageLock.version, version, 'package-lock.json version')
  assertEqual(packageLock.packages?.['']?.version, version, 'package-lock root package version')
  assertEqual(pluginManifest.version, version, 'plugin manifest version')
  assertEqual(standaloneManifest.version, version, 'standalone manifest version')
  const assertTargetContains = (relativePath, expected, label) => {
    if (!read(relativePath).includes(expected)) {
      throw new Error(`${label} is missing ${JSON.stringify(expected)}`)
    }
  }
  assertTargetContains(
    targetFiles.electronMain,
    `const UXP_PACKAGE_FILE = 'lightyear-banana-${version}.ccx'`,
    'electron UXP package filename'
  )
  assertTargetContains(targetFiles.buildInfo, `version: '${version}'`, 'buildInfo version')
  assertTargetContains(targetFiles.buildInfo, `buildNumber: '${buildNumber}'`, 'buildInfo build number')
  assertTargetContains(
    targetFiles.buildInfo,
    `displayVersion: 'v${version}+${buildNumber}'`,
    'buildInfo display version'
  )
  assertTargetContains(targetFiles.standaloneIndex, `Lightyear Banana v${version}`, 'standalone index version')
  assertTargetContains(
    targetFiles.standaloneMain,
    `const APP_TITLE = 'Lightyear Banana v${version}'`,
    'standalone app title version'
  )
  assertTargetContains(
    targetFiles.standalonePackage,
    `lightyear-banana-standalone-${version}.zip`,
    'standalone archive version'
  )
  assertTargetContains(targetFiles.readme, `lightyear-banana-${version}-mac.zip`, 'README macOS archive version')
  assertTargetContains(targetFiles.readme, `lightyear-banana-${version}-win.zip`, 'README Windows archive version')
  assertTargetContains(targetFiles.readme, `lightyear-banana-${version}.ccx`, 'README CCX version')
  assertTargetContains(targetFiles.readme, `dist/release-${version}/`, 'README release directory version')
}

if (values.check) {
  verifyReleaseVersion()
  console.log(`Release version verified: ${version} build ${buildNumber}`)
} else {
  const stagedFiles = stageReleaseVersion()
  const readStaged = (relativePath) => stagedFiles.get(relativePath) ?? readText(relativePath)
  verifyReleaseVersion(readStaged)

  if (values['dry-run']) {
    console.log(`Release version dry run passed: ${version} build ${buildNumber}`)
  } else {
    for (const [relativePath, content] of stagedFiles) {
      writeFileSync(absolutePath(relativePath), content)
    }
    verifyReleaseVersion()
    console.log(`Release version stamped: ${version} build ${buildNumber}`)
  }
}

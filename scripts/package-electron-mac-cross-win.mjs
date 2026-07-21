import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { packager } from '@electron/packager'

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDir = path.join(projectRoot, 'dist')
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
const electronPackage = JSON.parse(readFileSync(require.resolve('electron/package.json'), 'utf8'))
const buildInfoSource = readFileSync(path.join(projectRoot, 'src', 'buildInfo.ts'), 'utf8')
const buildNumber = buildInfoSource.match(/buildNumber: '([^']+)'/)?.[1]
const appName = 'Lightyear Banana'
const stagingDir = path.join(distDir, 'mac-cross-win-staging')
const outDir = path.join(distDir, 'mac-cross-win')
const archivePath = path.join(distDir, `${packageJson.name}-${packageJson.version}-mac-cross-win.zip`)

function assertInsideDist(targetPath) {
  const relative = path.relative(distDir, targetPath)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to modify path outside dist: ${targetPath}`)
  }
}

function resetGeneratedPath(targetPath) {
  assertInsideDist(targetPath)
  rmSync(targetPath, { force: true, recursive: true })
}

function quotePowerShellString(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function copyRequiredPath(source, destination) {
  if (!existsSync(source)) {
    throw new Error(`Required build input is missing: ${source}`)
  }
  if (statSync(source).isDirectory()) {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        [
          '$ErrorActionPreference = "Stop"',
          `$source = ${quotePowerShellString(source)}`,
          `$destination = ${quotePowerShellString(destination)}`,
          'New-Item -ItemType Directory -Path $destination -Force | Out-Null',
          'Copy-Item -Path (Join-Path $source "*") -Destination $destination -Recurse -Force'
        ].join('; ')
      ],
      { cwd: projectRoot, stdio: 'inherit' }
    )
    return
  }
  mkdirSync(path.dirname(destination), { recursive: true })
  copyFileSync(source, destination)
}

if (process.platform !== 'win32') {
  throw new Error('This diagnostic cross-package must be produced on Windows.')
}

if (!buildNumber || !/^\d{12}$/.test(buildNumber)) {
  throw new Error('src/buildInfo.ts does not contain a valid 12-digit build number.')
}

for (const targetPath of [stagingDir, outDir, archivePath]) {
  resetGeneratedPath(targetPath)
}

mkdirSync(path.join(stagingDir, 'dist'), { recursive: true })
copyRequiredPath(path.join(projectRoot, 'electron'), path.join(stagingDir, 'electron'))
copyRequiredPath(path.join(distDir, 'index.html'), path.join(stagingDir, 'dist', 'index.html'))
copyRequiredPath(path.join(distDir, 'assets'), path.join(stagingDir, 'dist', 'assets'))
copyRequiredPath(
  path.join(distDir, `${packageJson.name}-${packageJson.version}.ccx`),
  path.join(stagingDir, 'dist', `${packageJson.name}-${packageJson.version}.ccx`)
)

if (existsSync(path.join(projectRoot, 'favicon.svg'))) {
  copyRequiredPath(path.join(projectRoot, 'favicon.svg'), path.join(stagingDir, 'favicon.svg'))
}

writeFileSync(
  path.join(stagingDir, 'package.json'),
  `${JSON.stringify(
    {
      name: packageJson.name,
      version: packageJson.version,
      type: 'module',
      main: 'electron/main.js'
    },
    null,
    2
  )}\n`
)

writeFileSync(
  path.join(stagingDir, 'CROSS_BUILD_FROM_WINDOWS.json'),
  `${JSON.stringify(
    {
      warning: 'Temporary Windows-to-macOS cross-package. Do not publish as a formal macOS release.',
      version: packageJson.version,
      buildNumber,
      hostPlatform: process.platform,
      targetPlatform: 'darwin',
      targetArch: 'x64'
    },
    null,
    2
  )}\n`
)

console.log(`Cross-packaging macOS Electron v${electronPackage.version} from Windows...`)
const packagedPaths = await packager({
  dir: stagingDir,
  name: appName,
  platform: 'darwin',
  arch: 'x64',
  electronVersion: electronPackage.version,
  out: outDir,
  overwrite: true,
  asar: false,
  appVersion: packageJson.version,
  buildVersion: buildNumber,
  appBundleId: 'com.lightyear.banana.cross-win'
})

if (packagedPaths.length !== 1) {
  throw new Error(`Expected one macOS cross-package, received ${packagedPaths.length}.`)
}

const packagedPath = packagedPaths[0]
const appResourcesDir = path.join(packagedPath, `${appName}.app`, 'Contents', 'Resources', 'app')
const packagedPackage = JSON.parse(readFileSync(path.join(appResourcesDir, 'package.json'), 'utf8'))
if (packagedPackage.version !== packageJson.version) {
  throw new Error(`Cross-package version is ${packagedPackage.version}, expected ${packageJson.version}.`)
}
if (!existsSync(path.join(appResourcesDir, 'dist', `${packageJson.name}-${packageJson.version}.ccx`))) {
  throw new Error('Cross-package is missing the matching embedded CCX.')
}
if (!existsSync(path.join(appResourcesDir, 'CROSS_BUILD_FROM_WINDOWS.json'))) {
  throw new Error('Cross-package marker is missing.')
}

execFileSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    [
      '$ErrorActionPreference = "Stop"',
      `$source = ${quotePowerShellString(packagedPath)}`,
      `$destination = ${quotePowerShellString(archivePath)}`,
      'Compress-Archive -LiteralPath $source -DestinationPath $destination -CompressionLevel Optimal -Force'
    ].join('; ')
  ],
  { cwd: projectRoot, stdio: 'inherit' }
)

console.log(`Temporary macOS cross-package: ${archivePath}`)
console.log('This artifact is marked as cross-built and must not enter a formal release directory.')

import { execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertProductionOrigin, resolveReleaseUrl } from '../../utils/production-origin-policy.mjs'
import { publishReleaseFileSet } from './release-file-set.mjs'
import { resolveReleaseProvenance } from './release-provenance.mjs'
import { createCcxReleaseMetadata } from './ccx-release-metadata.mjs'
import {
  createVerifiedDirectorySnapshot,
  normalizeUdtManifestBytes,
  verifyArchiveMatchesDirectory
} from './package-archive-integrity.mjs'
import { createUdtCompatibleZip } from './udt-compatible-zip.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const provenance = resolveReleaseProvenance(projectRoot)
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
const sourceDir = path.join(projectRoot, 'dist', 'ccx-host')
const builtManifestPath = path.join(sourceDir, 'manifest.json')
const builtBuildPath = path.join(sourceDir, 'ccx-build.json')

if (!existsSync(builtManifestPath)) {
  throw new Error('CCX build not found. Run npm run verify:ccx first.')
}

const builtManifest = JSON.parse(readFileSync(builtManifestPath, 'utf8'))
const builtBuild = JSON.parse(readFileSync(builtBuildPath, 'utf8'))
if (typeof builtManifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(builtManifest.version)) {
  throw new Error('Built CCX manifest must contain a semantic version.')
}
if (
  builtBuild.version !== builtManifest.version
  || typeof builtBuild.buildNumber !== 'string'
  || !/^\d{6}(?!0000)\d{4}$/.test(builtBuild.buildNumber)
  || builtBuild.releaseId !== `${builtManifest.version}+${builtBuild.buildNumber}`
) {
  throw new Error('Built CCX build metadata is invalid or does not match the manifest.')
}

function readKeyEnvironment() {
  const filePath = path.join(projectRoot, 'key.env')
  if (!existsSync(filePath)) return {}
  return Object.fromEntries(
    readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=')
        const key = line.slice(0, separator).trim()
        const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
        return [key, value]
      })
  )
}

const keyEnvironment = readKeyEnvironment()
const hostedWebUiUrl = new URL(process.env.INNER_WEBUI_URL ?? keyEnvironment.INNER_WEBUI_URL ?? 'https://mugen.catrefuse.com/webui/')
if (hostedWebUiUrl.href !== 'https://mugen.catrefuse.com/webui/') {
  throw new Error('Production CCX packaging requires https://mugen.catrefuse.com/webui/.')
}
const webviewOrigin = assertProductionOrigin(hostedWebUiUrl.origin, 'Published WebUI origin')
const webview = builtManifest.requiredPermissions?.webview
if (
  webview?.allow !== 'yes' ||
  !Array.isArray(webview.domains) ||
  JSON.stringify(webview.domains) !== JSON.stringify([webviewOrigin]) ||
  'allowLocalRendering' in webview ||
  webview.enableMessageBridge !== 'localAndRemote'
) {
  throw new Error('Built CCX manifest must use only the hosted WebUI origin and remote message bridge.')
}

const releaseUrl = resolveReleaseUrl({
  processEnvironment: process.env,
  keyEnvironment,
  webviewOrigin,
  production: true
}).href

const archivePath = path.join(projectRoot, 'dist', `${packageJson.name}-${builtManifest.version}-${builtBuild.buildNumber}.ccx`)
const archiveChecksumPath = `${archivePath}.sha256`
const releaseMetadataPath = path.join(projectRoot, 'dist', 'ccx-release.json')
const temporarySuffix = `${process.pid}-${randomBytes(4).toString('hex')}`
const temporaryArchivePath = path.join(
  projectRoot,
  'dist',
  `.${packageJson.name}-${builtManifest.version}-${builtBuild.buildNumber}-${temporarySuffix}.zip`
)
const temporaryMetadataPath = path.join(projectRoot, 'dist', `.ccx-release-${temporarySuffix}.json`)
const temporaryChecksumPath = path.join(projectRoot, 'dist', `.${path.basename(archivePath)}-${temporarySuffix}.sha256`)
const stagingRoot = path.join(projectRoot, 'dist', `.ccx-package-stage-${temporarySuffix}`)
const stagedSourceDir = path.join(stagingRoot, 'ccx-host')
const archiveBackupPath = path.join(projectRoot, 'dist', `.${path.basename(archivePath)}-${temporarySuffix}.backup`)
const checksumBackupPath = path.join(projectRoot, 'dist', `.${path.basename(archiveChecksumPath)}-${temporarySuffix}.backup`)
const metadataBackupPath = path.join(projectRoot, 'dist', `.ccx-release-${temporarySuffix}.backup`)

rmSync(temporaryArchivePath, { force: true })
rmSync(temporaryMetadataPath, { force: true })
rmSync(temporaryChecksumPath, { force: true })
rmSync(stagingRoot, { recursive: true, force: true })

let sha256 = ''

try {
  createVerifiedDirectorySnapshot({
    sourceDirectory: sourceDir,
    stagingDirectory: stagedSourceDir
  })

  createUdtCompatibleZip({
    sourceDirectory: stagedSourceDir,
    archivePath: temporaryArchivePath
  })

  if (!existsSync(temporaryArchivePath)) {
    throw new Error(`Temporary CCX archive was not created: ${temporaryArchivePath}`)
  }

  const entries = execFileSync('tar', ['-tf', temporaryArchivePath], {
    cwd: projectRoot,
    encoding: 'utf8'
  }).split(/\r?\n/).filter(Boolean)
  const normalizedEntries = entries.map((entry) => entry.replace(/^\.\//, ''))
  const manifestIndex = normalizedEntries.indexOf('manifest.json')
  if (manifestIndex < 0 || !normalizedEntries.some((entry) => /^assets\/.+\.js$/.test(entry))) {
    throw new Error('CCX archive must contain manifest.json and a bundled JavaScript asset.')
  }
  const archivedManifest = JSON.parse(execFileSync('tar', ['-xOf', temporaryArchivePath, entries[manifestIndex]], {
    cwd: projectRoot,
    encoding: 'utf8'
  }))
  if (archivedManifest.id !== builtManifest.id || archivedManifest.version !== builtManifest.version) {
    throw new Error('Archived CCX manifest does not match the verified build.')
  }

  sha256 = createHash('sha256').update(readFileSync(temporaryArchivePath)).digest('hex')
  writeFileSync(temporaryChecksumPath, `${sha256}  ${path.basename(archivePath)}\n`, {
    encoding: 'utf8',
    flag: 'wx'
  })
  const releaseMetadata = createCcxReleaseMetadata({
    ccxVersion: builtManifest.version,
    buildNumber: builtBuild.buildNumber,
    filename: path.basename(archivePath),
    sha256,
    webviewOrigin,
    releaseUrl,
    builtAt: new Date().toISOString(),
    sourceCommit: provenance.sourceCommit,
    dirty: provenance.dirty
  })
  writeFileSync(
    temporaryMetadataPath,
    `${JSON.stringify(releaseMetadata, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx' }
  )

  verifyArchiveMatchesDirectory({
    sourceDirectory: stagedSourceDir,
    archiveEntries: entries,
    normalizeFileBytes: (file, bytes) =>
      file === 'manifest.json' ? normalizeUdtManifestBytes(bytes) : bytes,
    readArchiveEntry: (entry) => execFileSync(
      'tar',
      ['-xOf', temporaryArchivePath, entry],
      { cwd: projectRoot, maxBuffer: 256 * 1024 * 1024 }
    )
  })
  const finalProvenance = resolveReleaseProvenance(projectRoot)
  if (finalProvenance.sourceCommit !== provenance.sourceCommit) {
    throw new Error('Git HEAD changed while the CCX archive was being packaged.')
  }

  const cleanupErrors = publishReleaseFileSet([
    {
      temporaryPath: temporaryArchivePath,
      finalPath: archivePath,
      backupPath: archiveBackupPath
    },
    {
      temporaryPath: temporaryChecksumPath,
      finalPath: archiveChecksumPath,
      backupPath: checksumBackupPath
    },
    {
      temporaryPath: temporaryMetadataPath,
      finalPath: releaseMetadataPath,
      backupPath: metadataBackupPath
    }
  ])
  for (const cleanupError of cleanupErrors) {
    const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
    console.warn(`Could not remove a previous CCX release backup: ${message}`)
  }
} finally {
  rmSync(temporaryArchivePath, { force: true })
  rmSync(temporaryMetadataPath, { force: true })
  rmSync(temporaryChecksumPath, { force: true })
  rmSync(stagingRoot, { recursive: true, force: true })
}

console.log(`CCX archive packaged: ${archivePath}`)
console.log(`CCX archive checksum: ${archiveChecksumPath}`)
console.log(`CCX release metadata: ${releaseMetadataPath}`)
console.log(`SHA256: ${sha256}`)

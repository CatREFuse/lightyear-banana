import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { inspectGitProvenance } from './release-provenance.mjs'

export const ACTIVE_INNER_WEBUI_VERSION = '0.2.0'

function listFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return listFiles(absolutePath, relativePath)
    if (!entry.isFile()) {
      throw new Error(`Inner WebUI build contains an unsupported entry: ${relativePath}`)
    }
    return [relativePath]
  })
}

function readJson(filePath, label) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`Cannot read ${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function calculateContentHash(directory, files) {
  const hash = createHash('sha256')
  for (const file of files.filter((entry) => entry !== 'release.json')) {
    hash.update(file)
    hash.update('\0')
    hash.update(readFileSync(path.join(directory, file)))
    hash.update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}

function validateReleaseMetadata(metadata, label, expectedVersion, provenance) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error(`${label} must contain a JSON object.`)
  }
  if (metadata.schemaVersion !== 1) {
    throw new Error(`${label} must use schemaVersion 1.`)
  }
  if (metadata.webVersion !== expectedVersion) {
    throw new Error(`${label} webVersion must be ${expectedVersion}, received ${JSON.stringify(metadata.webVersion)}.`)
  }
  if (
    metadata.protocolVersion !== 1 ||
    JSON.stringify(metadata.compatibleHostProtocolVersions) !== JSON.stringify([1])
  ) {
    throw new Error(`${label} must use inner-host protocol 1.`)
  }
  if (metadata.dirty !== provenance.dirty) {
    throw new Error(
      `${label} dirty must match the current Git worktree state ` +
      `(${provenance.dirty}), received ${JSON.stringify(metadata.dirty)}.`
    )
  }
  if (metadata.commit !== provenance.sourceCommit) {
    throw new Error(`${label} commit must equal the current Git HEAD ${provenance.sourceCommit}, received ${JSON.stringify(metadata.commit)}.`)
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(metadata.contentHash || '')) {
    throw new Error(`${label} has an invalid contentHash.`)
  }
  if (metadata.buildId !== `${expectedVersion}-${metadata.contentHash.slice(7, 19)}`) {
    throw new Error(`${label} has an invalid buildId.`)
  }
  if (typeof metadata.builtAt !== 'string' || Number.isNaN(Date.parse(metadata.builtAt))) {
    throw new Error(`${label} has an invalid builtAt timestamp.`)
  }
  return metadata
}

function validateCompatibility(metadata, label, expectedVersion) {
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata) ||
    metadata.schemaVersion !== 1 ||
    metadata.webVersion !== expectedVersion ||
    metadata.protocolVersion !== 1 ||
    JSON.stringify(metadata.compatibleHostProtocolVersions) !== JSON.stringify([1])
  ) {
    throw new Error(`${label} must describe active Inner WebUI ${expectedVersion} on inner-host protocol 1.`)
  }
}

function assertIdenticalDirectories(sourceDirectory, embeddedDirectory, sourceFiles, embeddedFiles) {
  if (JSON.stringify(sourceFiles) !== JSON.stringify(embeddedFiles)) {
    throw new Error('The CCX embedded WebUI file set does not match apps/inner-webui/dist.')
  }

  for (const file of sourceFiles) {
    const sourceBytes = readFileSync(path.join(sourceDirectory, file))
    const embeddedBytes = readFileSync(path.join(embeddedDirectory, file))
    if (!sourceBytes.equals(embeddedBytes)) {
      throw new Error(`The CCX embedded WebUI differs from apps/inner-webui/dist at ${file}.`)
    }
  }
}

export function verifyEmbeddedInnerWebUiProvenance(options = {}) {
  const { projectRoot, provenance } = options
  if (!projectRoot) throw new Error('projectRoot is required to verify the embedded Inner WebUI.')
  const sourceDirectory = options.sourceDirectory ?? path.join(projectRoot, 'apps', 'inner-webui', 'dist')
  const embeddedDirectory = options.embeddedDirectory ?? path.join(projectRoot, 'dist', 'ps-uxp', 'webui')
  const packagePath = options.packagePath ?? path.join(projectRoot, 'apps', 'inner-webui', 'package.json')
  const expectedVersion = ACTIVE_INNER_WEBUI_VERSION
  const requireClean = options.requireClean ?? false
  if (typeof requireClean !== 'boolean') {
    throw new Error('requireClean must be a boolean.')
  }

  const verifiedProvenance = provenance ?? inspectGitProvenance(projectRoot)
  if (
    typeof verifiedProvenance?.dirty !== 'boolean' ||
    !/^[a-f0-9]{40,64}$/.test(verifiedProvenance?.sourceCommit || '')
  ) {
    throw new Error('Embedded Inner WebUI verification requires a valid Git provenance record.')
  }
  if (requireClean && verifiedProvenance.dirty) {
    throw new Error('CCX packaging requires a clean Git worktree and Inner WebUI metadata with dirty=false.')
  }

  const packageJson = readJson(packagePath, 'apps/inner-webui/package.json')
  if (packageJson.version !== expectedVersion) {
    throw new Error(`Inner WebUI package version must be ${expectedVersion}, received ${JSON.stringify(packageJson.version)}.`)
  }

  const sourceFiles = listFiles(sourceDirectory).sort()
  const embeddedFiles = listFiles(embeddedDirectory).sort()
  const sourceRelease = validateReleaseMetadata(
    readJson(path.join(sourceDirectory, 'release.json'), 'apps/inner-webui/dist/release.json'),
    'apps/inner-webui/dist/release.json',
    expectedVersion,
    verifiedProvenance
  )
  const embeddedRelease = validateReleaseMetadata(
    readJson(path.join(embeddedDirectory, 'release.json'), 'dist/ps-uxp/webui/release.json'),
    'dist/ps-uxp/webui/release.json',
    expectedVersion,
    verifiedProvenance
  )

  validateCompatibility(
    readJson(path.join(sourceDirectory, 'compatibility.json'), 'apps/inner-webui/dist/compatibility.json'),
    'apps/inner-webui/dist/compatibility.json',
    expectedVersion
  )
  validateCompatibility(
    readJson(path.join(embeddedDirectory, 'compatibility.json'), 'dist/ps-uxp/webui/compatibility.json'),
    'dist/ps-uxp/webui/compatibility.json',
    expectedVersion
  )

  assertIdenticalDirectories(sourceDirectory, embeddedDirectory, sourceFiles, embeddedFiles)

  const sourceContentHash = calculateContentHash(sourceDirectory, sourceFiles)
  if (sourceContentHash !== sourceRelease.contentHash) {
    throw new Error('apps/inner-webui/dist files do not match release.json contentHash.')
  }
  const embeddedContentHash = calculateContentHash(embeddedDirectory, embeddedFiles)
  if (embeddedContentHash !== embeddedRelease.contentHash) {
    throw new Error('dist/ps-uxp/webui files do not match release.json contentHash.')
  }

  return {
    version: expectedVersion,
    sourceCommit: verifiedProvenance.sourceCommit,
    dirty: verifiedProvenance.dirty,
    contentHash: sourceRelease.contentHash,
    release: sourceRelease,
    fileCount: sourceFiles.length
  }
}

export function assertUxpReleaseMatchesInnerWebUiProvenance(uxpRelease, innerWebUi) {
  if (uxpRelease?.dirty !== false) {
    throw new Error('UXP release metadata must record dirty=false.')
  }
  if (
    !/^[a-f0-9]{40,64}$/.test(innerWebUi?.sourceCommit || '') ||
    uxpRelease?.sourceCommit !== innerWebUi.sourceCommit
  ) {
    throw new Error('UXP release sourceCommit must match the verified embedded Inner WebUI commit.')
  }
  return uxpRelease
}

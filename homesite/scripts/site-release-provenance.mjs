import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

export const siteReleaseFileName = 'site-release.json'
export const siteManifestFileName = 'site-manifest.json'
const rollbackArtifactPattern = /^site-rollback-[A-Za-z0-9._-]+\.(?:sha256\.txt|latest\.json)$/

function normalizeRelative(value) {
  const normalized = value.split(path.sep).join('/')
  if (
    !normalized ||
    normalized.startsWith('/') ||
    normalized.includes('../') ||
    normalized.endsWith('/..') ||
    !/^[A-Za-z0-9._/-]+$/.test(normalized)
  ) throw new Error(`Unsupported official site file path: ${value}`)
  return normalized
}

function listFiles(directory, prefix = '') {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = normalizeRelative(prefix ? `${prefix}/${entry.name}` : entry.name)
    const fullPath = path.join(directory, entry.name)
    const stat = lstatSync(fullPath)
    if (stat.isSymbolicLink()) throw new Error(`Official site output must not contain symlinks: ${relative}`)
    if (stat.isDirectory()) files.push(...listFiles(fullPath, relative))
    else if (stat.isFile()) files.push(relative)
    else throw new Error(`Unsupported official site filesystem entry: ${relative}`)
  }
  return files.sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
}

export function siteContentRecords(directory, { includeReleaseMetadata = false } = {}) {
  const files = listFiles(directory)
  const legacyReleaseFile = files.find((relative) => relative === 'releases' || relative.startsWith('releases/'))
  if (legacyReleaseFile) {
    throw new Error(`Official site build must use download/ instead of the deprecated releases tree: ${legacyReleaseFile}`)
  }
  const rollbackArtifact = files.find((relative) => rollbackArtifactPattern.test(relative))
  if (rollbackArtifact) {
    throw new Error(`Official site build must not contain runtime rollback artifact: ${rollbackArtifact}`)
  }
  return files
    .filter((relative) => relative !== siteManifestFileName)
    .filter((relative) => includeReleaseMetadata || relative !== siteReleaseFileName)
    .map((relative) => {
      const bytes = readFileSync(path.join(directory, ...relative.split('/')))
      return {
        path: relative,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        size: bytes.byteLength
      }
    })
}

export function calculateSiteContentHash(directory) {
  const hash = createHash('sha256')
  for (const record of siteContentRecords(directory)) {
    hash.update(record.path)
    hash.update('\0')
    hash.update(record.sha256)
    hash.update('\0')
    hash.update(String(record.size))
    hash.update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}

export function readGitSiteProvenance(root) {
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' })
  if (!/^[a-f0-9]{40}$/i.test(commit)) throw new Error('Could not resolve the current Git commit for the official site.')
  return { commit: commit.toLowerCase(), dirty: Boolean(status.trim()) }
}

export function createSiteReleaseMetadata({ builtAt = new Date().toISOString(), commit, directory, dirty }) {
  if (!/^[a-f0-9]{40}$/i.test(commit || '')) throw new Error('Official site commit must be a full Git SHA.')
  if (typeof dirty !== 'boolean') throw new Error('Official site dirty state must be boolean.')
  if (Number.isNaN(Date.parse(builtAt))) throw new Error('Official site builtAt must be an ISO timestamp.')
  const contentHash = calculateSiteContentHash(directory)
  return {
    schemaVersion: 1,
    artifact: 'official-site',
    commit: commit.toLowerCase(),
    dirty,
    builtAt,
    contentHash,
    buildId: `site-${contentHash.slice(7, 19)}`
  }
}

export function createSiteManifest(directory, release) {
  const files = siteContentRecords(directory, { includeReleaseMetadata: true })
  return {
    schemaVersion: 1,
    artifact: 'official-site-manifest',
    buildId: release.buildId,
    contentHash: release.contentHash,
    files
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`)
  return value
}

export function validateSiteReleaseMetadata({ currentGit, directory, requireClean = false }) {
  let release
  let manifest
  try {
    release = JSON.parse(readFileSync(path.join(directory, siteReleaseFileName), 'utf8'))
    manifest = JSON.parse(readFileSync(path.join(directory, siteManifestFileName), 'utf8'))
  } catch (error) {
    throw new Error(`Official site provenance metadata is missing or invalid: ${error instanceof Error ? error.message : String(error)}`)
  }
  requireObject(release, siteReleaseFileName)
  requireObject(manifest, siteManifestFileName)
  if (release.schemaVersion !== 1 || release.artifact !== 'official-site') throw new Error(`${siteReleaseFileName} has an invalid schema.`)
  if (!/^[a-f0-9]{40}$/.test(release.commit || '')) throw new Error(`${siteReleaseFileName} has an invalid commit.`)
  if (typeof release.dirty !== 'boolean') throw new Error(`${siteReleaseFileName} has an invalid dirty state.`)
  if (typeof release.builtAt !== 'string' || Number.isNaN(Date.parse(release.builtAt))) throw new Error(`${siteReleaseFileName} has an invalid builtAt.`)
  if (!/^sha256:[a-f0-9]{64}$/.test(release.contentHash || '')) throw new Error(`${siteReleaseFileName} has an invalid contentHash.`)
  if (release.buildId !== `site-${release.contentHash.slice(7, 19)}`) throw new Error(`${siteReleaseFileName} has an invalid buildId.`)
  const actualContentHash = calculateSiteContentHash(directory)
  if (release.contentHash !== actualContentHash) throw new Error('Official site deployable content does not match site-release.json contentHash.')
  const expectedManifest = createSiteManifest(directory, release)
  if (JSON.stringify(manifest) !== JSON.stringify(expectedManifest)) throw new Error('site-manifest.json does not match every deployable official site file.')
  if (currentGit) {
    if (release.commit !== currentGit.commit) throw new Error('Official site build commit does not match the current Git HEAD.')
    if (release.dirty !== currentGit.dirty) throw new Error('Official site build dirty state does not match the current Git worktree.')
    if (requireClean && (release.dirty || currentGit.dirty)) throw new Error('Official site deployment requires a clean Git worktree and a clean site build.')
  }
  return { manifest, release }
}

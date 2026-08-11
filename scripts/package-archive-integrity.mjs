import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

function listFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return listFiles(absolutePath, relativePath)
    if (!entry.isFile()) {
      throw new Error(`CCX staging directory contains an unsupported entry: ${relativePath}`)
    }
    return [relativePath]
  })
}

function normalizeArchiveEntry(entry) {
  if (typeof entry !== 'string' || !entry || entry.includes('\0')) {
    throw new Error('CCX archive contains an invalid entry name.')
  }
  let normalized = entry.replaceAll('\\', '/')
  const directory = normalized.endsWith('/')
  while (normalized.startsWith('./')) normalized = normalized.slice(2)
  if (directory) normalized = normalized.slice(0, -1)
  if (!normalized && directory) return { directory: true }
  if (
    !normalized ||
    path.posix.isAbsolute(normalized) ||
    /^[A-Za-z]:/.test(normalized) ||
    path.posix.normalize(normalized) !== normalized ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    throw new Error(`CCX archive contains an unsafe or non-normalized entry: ${JSON.stringify(entry)}`)
  }
  return { directory, path: normalized }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function directorySnapshot(directory) {
  const files = listFiles(directory).sort()
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file)
    hash.update('\0')
    hash.update(readFileSync(path.join(directory, file)))
    hash.update('\0')
  }
  return { files, digest: `sha256:${hash.digest('hex')}` }
}

export function createVerifiedDirectorySnapshot({
  sourceDirectory,
  stagingDirectory,
  copyFile = copyFileSync
}) {
  if (existsSync(stagingDirectory)) {
    throw new Error(`CCX staging directory already exists: ${stagingDirectory}`)
  }
  const before = directorySnapshot(sourceDirectory)
  mkdirSync(stagingDirectory, { recursive: true })
  for (const file of before.files) {
    const target = path.join(stagingDirectory, file)
    mkdirSync(path.dirname(target), { recursive: true })
    copyFile(path.join(sourceDirectory, file), target)
  }

  const after = directorySnapshot(sourceDirectory)
  const staged = directorySnapshot(stagingDirectory)
  if (before.digest !== after.digest || before.digest !== staged.digest) {
    throw new Error('CCX source changed while the immutable staging snapshot was being created.')
  }
  return { fileCount: staged.files.length, digest: staged.digest }
}

export function verifyArchiveMatchesDirectory({ sourceDirectory, archiveEntries, readArchiveEntry }) {
  if (typeof sourceDirectory !== 'string' || !sourceDirectory) {
    throw new Error('sourceDirectory is required for CCX archive verification.')
  }
  if (!Array.isArray(archiveEntries) || typeof readArchiveEntry !== 'function') {
    throw new Error('CCX archive entries and reader are required.')
  }

  const sourceFiles = listFiles(sourceDirectory).sort()
  const archivedFiles = new Map()
  for (const entry of archiveEntries) {
    const normalized = normalizeArchiveEntry(entry)
    if (normalized.directory) continue
    if (archivedFiles.has(normalized.path)) {
      throw new Error(`CCX archive contains a duplicate file entry: ${normalized.path}`)
    }
    archivedFiles.set(normalized.path, entry)
  }

  const archiveFileNames = [...archivedFiles.keys()].sort()
  if (JSON.stringify(archiveFileNames) !== JSON.stringify(sourceFiles)) {
    throw new Error('CCX archive file set does not match the final staging directory.')
  }

  for (const file of sourceFiles) {
    const sourceBytes = readFileSync(path.join(sourceDirectory, file))
    const archivedBytes = readArchiveEntry(archivedFiles.get(file))
    if (!Buffer.isBuffer(archivedBytes) && !(archivedBytes instanceof Uint8Array)) {
      throw new Error(`CCX archive reader did not return bytes for ${file}.`)
    }
    if (sha256(sourceBytes) !== sha256(archivedBytes)) {
      throw new Error(`CCX archive bytes do not match the final staging directory at ${file}.`)
    }
  }

  return { fileCount: sourceFiles.length }
}

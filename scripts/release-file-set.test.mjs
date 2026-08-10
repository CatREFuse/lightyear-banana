import assert from 'node:assert/strict'
import test from 'node:test'
import { publishReleaseFileSet } from './release-file-set.mjs'

const entries = ['archive', 'checksum', 'metadata'].map((name) => ({
  temporaryPath: `${name}.new`,
  finalPath: name,
  backupPath: `${name}.backup`
}))

function createFileSystem(initialFiles, failRename) {
  const files = new Map(Object.entries(initialFiles))
  const log = []
  return {
    files,
    log,
    operations: {
      exists: (filePath) => files.has(filePath),
      rename(from, to) {
        log.push(`rename ${from} ${to}`)
        if (failRename?.(from, to)) throw new Error(`rename failed: ${from} -> ${to}`)
        if (!files.has(from)) throw new Error(`missing: ${from}`)
        files.set(to, files.get(from))
        files.delete(from)
      },
      remove(filePath) {
        log.push(`remove ${filePath}`)
        files.delete(filePath)
      }
    }
  }
}

function releaseFiles(prefix) {
  return Object.fromEntries(entries.map((entry) => [entry.finalPath, `${prefix}-${entry.finalPath}`]))
}

function temporaryFiles() {
  return Object.fromEntries(entries.map((entry) => [entry.temporaryPath, `new-${entry.finalPath}`]))
}

test('publishes all files in order and activates metadata last', () => {
  const fileSystem = createFileSystem({ ...releaseFiles('old'), ...temporaryFiles() })
  assert.deepEqual(publishReleaseFileSet(entries, fileSystem.operations), [])
  assert.deepEqual(Object.fromEntries(fileSystem.files), releaseFiles('new'))

  const activationLog = fileSystem.log.filter((line) => line.includes('.new '))
  assert.deepEqual(activationLog, [
    'rename archive.new archive',
    'rename checksum.new checksum',
    'rename metadata.new metadata'
  ])
})

test('restores every previous file when activation fails', () => {
  const fileSystem = createFileSystem(
    { ...releaseFiles('old'), ...temporaryFiles() },
    (from, to) => from === 'checksum.new' && to === 'checksum'
  )

  assert.throws(() => publishReleaseFileSet(entries, fileSystem.operations), /rename failed/)
  assert.deepEqual(
    Object.fromEntries([...fileSystem.files].filter(([filePath]) => !filePath.endsWith('.new'))),
    releaseFiles('old')
  )
})

test('removes newly activated files when no previous release exists', () => {
  const fileSystem = createFileSystem(
    temporaryFiles(),
    (from, to) => from === 'metadata.new' && to === 'metadata'
  )

  assert.throws(() => publishReleaseFileSet(entries, fileSystem.operations), /rename failed/)
  assert.equal(fileSystem.files.has('archive'), false)
  assert.equal(fileSystem.files.has('checksum'), false)
  assert.equal(fileSystem.files.has('metadata'), false)
})

test('restores earlier backups when backup creation fails', () => {
  const fileSystem = createFileSystem(
    { ...releaseFiles('old'), ...temporaryFiles() },
    (from, to) => from === 'checksum' && to === 'checksum.backup'
  )

  assert.throws(() => publishReleaseFileSet(entries, fileSystem.operations), /rename failed/)
  assert.deepEqual(
    Object.fromEntries([...fileSystem.files].filter(([filePath]) => !filePath.endsWith('.new'))),
    releaseFiles('old')
  )
})

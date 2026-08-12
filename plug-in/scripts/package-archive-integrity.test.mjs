import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createVerifiedDirectorySnapshot,
  normalizeUdtManifestBytes,
  verifyArchiveMatchesDirectory
} from './package-archive-integrity.mjs'

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'mugen-ccx-archive-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(path.join(root, 'assets'), { recursive: true })
  writeFileSync(path.join(root, 'manifest.json'), '{"id":"com.tanshow.mugen"}\n')
  writeFileSync(path.join(root, 'assets', 'index.js'), 'console.log("Mugen")\n')
  writeFileSync(path.join(root, 'webui.bin'), Buffer.from([0, 1, 2, 255]))
  const entries = ['./', './assets/', './manifest.json', './assets/index.js', './webui.bin']
  const bytes = new Map([
    ['./manifest.json', readFileSync(path.join(root, 'manifest.json'))],
    ['./assets/index.js', readFileSync(path.join(root, 'assets', 'index.js'))],
    ['./webui.bin', readFileSync(path.join(root, 'webui.bin'))]
  ])
  return { root, entries, bytes }
}

test('accepts an archive whose complete file set and bytes match staging', (t) => {
  const value = fixture(t)
  assert.deepEqual(verifyArchiveMatchesDirectory({
    sourceDirectory: value.root,
    archiveEntries: value.entries,
    readArchiveEntry: (entry) => value.bytes.get(entry)
  }), { fileCount: 3 })
})

test('creates a stable unique staging snapshot before archive creation', (t) => {
  const value = fixture(t)
  const stagingDirectory = `${value.root}-stage`
  t.after(() => rmSync(stagingDirectory, { recursive: true, force: true }))

  const snapshot = createVerifiedDirectorySnapshot({
    sourceDirectory: value.root,
    stagingDirectory
  })
  assert.equal(snapshot.fileCount, 3)
  assert.match(snapshot.digest, /^sha256:[a-f0-9]{64}$/)
  assert.deepEqual(readFileSync(path.join(stagingDirectory, 'webui.bin')), value.bytes.get('./webui.bin'))
})

test('rejects a source mutation during staging snapshot creation', (t) => {
  const value = fixture(t)
  const stagingDirectory = `${value.root}-racing-stage`
  t.after(() => rmSync(stagingDirectory, { recursive: true, force: true }))
  let mutated = false

  assert.throws(
    () => createVerifiedDirectorySnapshot({
      sourceDirectory: value.root,
      stagingDirectory,
      copyFile: (source, target) => {
        copyFileSync(source, target)
        if (!mutated) {
          mutated = true
          writeFileSync(path.join(value.root, 'manifest.json'), '{"id":"changed-during-copy"}\n')
        }
      }
    }),
    /source changed while the immutable staging snapshot/
  )
})

test('rejects a staging mutation that occurred after archive creation', (t) => {
  const value = fixture(t)
  writeFileSync(path.join(value.root, 'assets', 'index.js'), 'console.log("changed after archive")\n')
  assert.throws(
    () => verifyArchiveMatchesDirectory({
      sourceDirectory: value.root,
      archiveEntries: value.entries,
      readArchiveEntry: (entry) => value.bytes.get(entry)
    }),
    /archive bytes do not match.*assets\/index\.js/
  )
})

test('rejects missing, extra, duplicate, and unsafe archive entries', (t) => {
  const value = fixture(t)
  for (const entries of [
    value.entries.filter((entry) => entry !== './webui.bin'),
    [...value.entries, './unexpected.txt'],
    [...value.entries, './manifest.json'],
    [...value.entries, '../outside.txt']
  ]) {
    assert.throws(() => verifyArchiveMatchesDirectory({
      sourceDirectory: value.root,
      archiveEntries: entries,
      readArchiveEntry: (entry) => value.bytes.get(entry) ?? Buffer.alloc(0)
    }))
  }
})

test('accepts only the terminal manifest newline removed by UXP Developer Tools', (t) => {
  const value = fixture(t)
  value.bytes.set('./manifest.json', Buffer.from('{"id":"com.tanshow.mugen"}'))
  const normalizeFileBytes = (file, bytes) =>
    file === 'manifest.json' ? normalizeUdtManifestBytes(bytes) : bytes

  assert.deepEqual(verifyArchiveMatchesDirectory({
    sourceDirectory: value.root,
    archiveEntries: value.entries,
    normalizeFileBytes,
    readArchiveEntry: (entry) => value.bytes.get(entry)
  }), { fileCount: 3 })

  value.bytes.set('./manifest.json', Buffer.from('{"id":"changed"}'))
  assert.throws(() => verifyArchiveMatchesDirectory({
    sourceDirectory: value.root,
    archiveEntries: value.entries,
    normalizeFileBytes,
    readArchiveEntry: (entry) => value.bytes.get(entry)
  }), /archive bytes do not match.*manifest\.json/)
})

test('release packaging consumes the official UXP Developer Tools package without recreating ZIP bytes', () => {
  const source = readFileSync(new URL('./package-ccx.mjs', import.meta.url), 'utf8')
  assert.match(source, /MUGEN_UDT_CCX_PATH/)
  assert.match(source, /UXP Developer Tools > Package/)
  assert.match(source, /copyFileSync\(udtPackagePath, temporaryArchivePath\)/)
  assert.doesNotMatch(source, /Compress-Archive/)
  assert.doesNotMatch(source, /execFileSync\('zip'/)
})

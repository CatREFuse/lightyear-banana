import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  assertCcxReleaseMatchesInnerWebUiProvenance,
  verifyEmbeddedInnerWebUiProvenance
} from './inner-webui-provenance.mjs'

const version = '0.2.0'

function write(root, relativePath, contents) {
  const target = path.join(root, relativePath)
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, contents)
}

function json(root, relativePath, value) {
  write(root, relativePath, `${JSON.stringify(value, null, 2)}\n`)
}

function listFiles(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name
    return entry.isDirectory() ? listFiles(path.join(directory, entry.name), name) : [name]
  })
}

function contentHash(directory) {
  const hash = createHash('sha256')
  for (const file of listFiles(directory).filter((entry) => entry !== 'release.json').sort()) {
    hash.update(file)
    hash.update('\0')
    hash.update(readFileSync(path.join(directory, file)))
    hash.update('\0')
  }
  return `sha256:${hash.digest('hex')}`
}

function fixture(t, { dirty = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'mugen-inner-provenance-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const sourceCommit = 'a'.repeat(40)
  const sourceDirectory = path.join(root, 'apps', 'inner-webui', 'dist')
  const embeddedDirectory = path.join(root, 'dist', 'ccx-host', 'webui')
  const compatibility = {
    schemaVersion: 1,
    webVersion: version,
    protocolVersion: 1,
    compatibleHostProtocolVersions: [1]
  }

  json(root, 'apps/inner-webui/package.json', { name: '@mugen/inner-webui', version })
  json(root, 'apps/inner-webui/dist/compatibility.json', compatibility)
  write(root, 'apps/inner-webui/dist/index.html', '<main>Mugen</main>')
  write(root, 'apps/inner-webui/dist/assets/index.js', 'console.log("Mugen")')
  write(root, 'apps/inner-webui/dist/assets/index.css', ':root{color-scheme:dark}')
  const hash = contentHash(sourceDirectory)
  const release = {
    schemaVersion: 1,
    webVersion: version,
    protocolVersion: 1,
    compatibleHostProtocolVersions: [1],
    buildId: `${version}-${hash.slice(7, 19)}`,
    contentHash: hash,
    commit: sourceCommit,
    dirty,
    builtAt: '2026-08-12T00:00:00.000Z'
  }
  json(root, 'apps/inner-webui/dist/release.json', release)
  for (const file of listFiles(sourceDirectory)) {
    write(root, `dist/ccx-host/webui/${file}`, readFileSync(path.join(sourceDirectory, file)))
  }

  return {
    root,
    sourceCommit,
    sourceDirectory,
    embeddedDirectory,
    release,
    provenance: { sourceCommit, dirty }
  }
}

test('accepts a byte-identical embedded WebUI built from active version and clean HEAD', (t) => {
  const value = fixture(t)
  const verified = verifyEmbeddedInnerWebUiProvenance({
    projectRoot: value.root,
    provenance: value.provenance,
    requireClean: false
  })

  assert.equal(verified.version, version)
  assert.equal(verified.sourceCommit, value.sourceCommit)
  assert.equal(verified.contentHash, value.release.contentHash)
  assert.equal(verified.fileCount, 5)
})

test('allows local verification when dirty metadata matches the actual worktree state', (t) => {
  const value = fixture(t, { dirty: true })
  const verified = verifyEmbeddedInnerWebUiProvenance({
    projectRoot: value.root,
    provenance: value.provenance,
    requireClean: false
  })

  assert.equal(verified.dirty, true)
  assert.equal(verified.release.dirty, true)
})

test('rejects metadata whose dirty state does not match the actual worktree', (t) => {
  const value = fixture(t, { dirty: true })
  const mismatchedRelease = { ...value.release, dirty: false }
  json(value.root, 'apps/inner-webui/dist/release.json', mismatchedRelease)
  json(value.root, 'dist/ccx-host/webui/release.json', mismatchedRelease)
  assert.throws(
    () => verifyEmbeddedInnerWebUiProvenance({
      projectRoot: value.root,
      provenance: value.provenance,
      requireClean: false
    }),
    /dirty must match the current Git worktree state \(true\), received false/
  )
})

test('keeps CCX package verification strict on a dirty worktree', (t) => {
  const value = fixture(t, { dirty: true })
  assert.throws(
    () => verifyEmbeddedInnerWebUiProvenance({
      projectRoot: value.root,
      provenance: value.provenance,
      requireClean: true
    }),
    /CCX packaging requires a clean Git worktree/
  )
})

test('rejects source or embedded metadata from a stale commit', (t) => {
  const sourceFixture = fixture(t)
  json(sourceFixture.root, 'apps/inner-webui/dist/release.json', {
    ...sourceFixture.release,
    commit: 'b'.repeat(40)
  })
  assert.throws(
    () => verifyEmbeddedInnerWebUiProvenance({
      projectRoot: sourceFixture.root,
      provenance: sourceFixture.provenance,
      requireClean: false
    }),
    /commit must equal the current Git HEAD/
  )

  const embeddedFixture = fixture(t)
  json(embeddedFixture.root, 'dist/ccx-host/webui/release.json', {
    ...embeddedFixture.release,
    commit: 'b'.repeat(40)
  })
  assert.throws(
    () => verifyEmbeddedInnerWebUiProvenance({
      projectRoot: embeddedFixture.root,
      provenance: embeddedFixture.provenance,
      requireClean: false
    }),
    /commit must equal the current Git HEAD/
  )
})

test('rejects modified embedded bytes even when release metadata was copied', (t) => {
  const value = fixture(t)
  write(value.root, 'dist/ccx-host/webui/assets/index.js', 'console.log("modified")')
  assert.throws(
    () => verifyEmbeddedInnerWebUiProvenance({
      projectRoot: value.root,
      provenance: value.provenance,
      requireClean: false
    }),
    /embedded WebUI differs.*assets\/index\.js/
  )
})

test('binds ccx-release sourceCommit to the verified embedded WebUI commit', (t) => {
  const value = fixture(t)
  const verified = verifyEmbeddedInnerWebUiProvenance({
    projectRoot: value.root,
    provenance: value.provenance,
    requireClean: true
  })
  const metadata = { sourceCommit: value.sourceCommit, dirty: false }

  assert.equal(assertCcxReleaseMatchesInnerWebUiProvenance(metadata, verified), metadata)
  assert.throws(
    () => assertCcxReleaseMatchesInnerWebUiProvenance(
      { sourceCommit: 'b'.repeat(40), dirty: false },
      verified
    ),
    /CCX release sourceCommit must match/
  )
})

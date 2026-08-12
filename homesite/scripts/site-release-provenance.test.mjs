import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  calculateSiteContentHash,
  createSiteManifest,
  createSiteReleaseMetadata,
  validateSiteReleaseMetadata
} from './site-release-provenance.mjs'

const commit = '1'.repeat(40)

function temporarySite(context) {
  const root = mkdtempSync(path.join(tmpdir(), 'mugen-site-provenance-'))
  context.after(() => rmSync(root, { force: true, recursive: true }))
  return root
}

function write(root, relative, contents) {
  const target = path.join(root, ...relative.split('/'))
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(target, contents)
}

function stamp(root, { dirty = false, sourceCommit = commit } = {}) {
  const release = createSiteReleaseMetadata({
    builtAt: '2026-08-12T03:04:05.000Z',
    commit: sourceCommit,
    directory: root,
    dirty
  })
  write(root, 'site-release.json', `${JSON.stringify(release, null, 2)}\n`)
  const manifest = createSiteManifest(root, release)
  write(root, 'site-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
  return { manifest, release }
}

test('binds every deployable site file to commit, content hash, build ID, and full manifest', (context) => {
  const root = temporarySite(context)
  write(root, 'index.html', '<!doctype html>')
  write(root, 'assets/app.js', 'app')
  write(root, 'download/mugen-1.0.2.ccx', 'ccx')
  const expected = stamp(root)

  assert.deepEqual(validateSiteReleaseMetadata({
    currentGit: { commit, dirty: false },
    directory: root,
    requireClean: true
  }), expected)
  assert.match(expected.release.contentHash, /^sha256:[a-f0-9]{64}$/)
  assert.equal(expected.release.buildId, `site-${expected.release.contentHash.slice(7, 19)}`)
  assert.deepEqual(expected.manifest.files.map((file) => file.path), [
    'assets/app.js',
    'download/mugen-1.0.2.ccx',
    'index.html',
    'site-release.json'
  ])
})

test('detects changed, missing, or unlisted static assets', (context) => {
  const root = temporarySite(context)
  write(root, 'index.html', 'original')
  write(root, 'app.js', 'app')
  stamp(root)
  write(root, 'app.js', 'tampered')
  assert.throws(() => validateSiteReleaseMetadata({ directory: root }), /contentHash/)

  const restamped = stamp(root)
  write(root, 'extra.css', 'new asset')
  assert.throws(() => validateSiteReleaseMetadata({ directory: root }), /contentHash/)
  assert.ok(restamped.manifest.files.some((file) => file.path === 'app.js'))
})

test('download files stay inside the content hash while legacy releases and rollback artifacts are rejected', (context) => {
  const root = temporarySite(context)
  write(root, 'index.html', 'site')
  const before = calculateSiteContentHash(root)
  write(root, 'download/mugen-1.0.0.ccx', 'ccx')
  assert.notEqual(calculateSiteContentHash(root), before)
  write(root, 'releases/latest.json', 'old latest')
  assert.throws(() => calculateSiteContentHash(root), /deprecated releases tree/)
  rmSync(path.join(root, 'releases'), { recursive: true })
  write(root, 'site-rollback-12345678.sha256.txt', 'legacy proof')
  assert.throws(() => calculateSiteContentHash(root), /must not contain runtime rollback artifact/)
  writeFileSync(path.join(root, 'site-rollback-12345678.sha256.txt'), '')
  rmSync(path.join(root, 'site-rollback-12345678.sha256.txt'))
  write(root, 'site-rollback-12345678.latest.json', '{"legacy":true}')
  assert.throws(() => calculateSiteContentHash(root), /must not contain runtime rollback artifact/)
})

test('deployment provenance rejects dirty builds, dirty worktrees, and a different HEAD', (context) => {
  const root = temporarySite(context)
  write(root, 'index.html', 'site')
  stamp(root, { dirty: true })
  assert.throws(() => validateSiteReleaseMetadata({
    currentGit: { commit, dirty: true },
    directory: root,
    requireClean: true
  }), /requires a clean Git worktree/)

  stamp(root, { dirty: false })
  assert.throws(() => validateSiteReleaseMetadata({
    currentGit: { commit: '2'.repeat(40), dirty: false },
    directory: root,
    requireClean: true
  }), /does not match the current Git HEAD/)
  assert.throws(() => validateSiteReleaseMetadata({
    currentGit: { commit, dirty: true },
    directory: root,
    requireClean: true
  }), /dirty state does not match/)
})

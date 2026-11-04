import assert from 'node:assert/strict'
import test from 'node:test'
import { createCcxReleaseMetadata } from './ccx-release-metadata.mjs'

const validInput = {
  ccxVersion: '1.0.0',
  buildNumber: '2608140002',
  filename: 'mugen-1.0.0-2608140002.ccx',
  sha256: 'a'.repeat(64),
  webviewOrigin: 'https://webui.product.dev',
  releaseUrl: 'https://releases.product.dev/releases/',
  builtAt: '2026-08-10T12:00:00.000Z',
  sourceCommit: 'b'.repeat(40),
  dirty: false
}

test('creates a complete CCX release metadata record', () => {
  assert.deepEqual(createCcxReleaseMetadata(validInput), {
    schemaVersion: 2,
    ...validInput
  })
})

test('requires a normalized credential-free release URL', () => {
  for (const releaseUrl of [
    'https://releases.product.dev/releases',
    'https://user:password@releases.product.dev/releases/',
    'https://releases.product.dev/releases/?token=secret',
    'https://cake.catrefuse.com/releases/'
  ]) {
    assert.throws(() => createCcxReleaseMetadata({ ...validInput, releaseUrl }))
  }
})

test('requires clean source provenance', () => {
  assert.throws(
    () => createCcxReleaseMetadata({ ...validInput, dirty: true }),
    /clean Git worktree/
  )
})

test('requires a YYMMDDnnnn build number and matching filename', () => {
  assert.throws(() => createCcxReleaseMetadata({ ...validInput, buildNumber: '202608140002' }))
  assert.throws(() => createCcxReleaseMetadata({ ...validInput, buildNumber: '2608140000' }))
  assert.throws(() => createCcxReleaseMetadata({ ...validInput, filename: 'mugen-1.0.0.ccx' }))
})

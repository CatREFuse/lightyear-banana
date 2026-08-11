import assert from 'node:assert/strict'
import test from 'node:test'
import { findForbiddenSourceModule, forbiddenBundleMarkers, scanBundleText } from '../scripts/bundlePolicy.mjs'

test('allows the browser and Photoshop host contracts', () => {
  assert.deepEqual(
    scanBundleText('browser photoshop-uxp inner-host/v1 diagnostics.export'),
    []
  )
})

test('detects every retired runtime and test-fixture marker', () => {
  const samples = [
    'electron',
    'window.mugenBridge',
    'app.deployWindows',
    'app.checkForUpdates',
    'app.openMacPermissionSettings',
    'crx.logs.export',
    'MockHostClient',
    '0.3.19'
  ]

  assert.equal(samples.length, forbiddenBundleMarkers.length)
  for (const sample of samples) {
    const findings = scanBundleText(sample, 'fixture.js')
    assert.equal(findings.length, 1, `${sample} must be rejected`)
    assert.equal(findings[0].file, 'fixture.js')
  }
})

test('rejects the test-only MockHost fixture from a production module graph', () => {
  assert.equal(
    findForbiddenSourceModule('C:\\workspace\\apps\\inner-webui\\src\\host\\mockHost.fixture.ts?import'),
    '/src/host/mockHost.fixture.ts'
  )
  assert.equal(findForbiddenSourceModule('/workspace/apps/inner-webui/src/host/index.ts'), undefined)
})

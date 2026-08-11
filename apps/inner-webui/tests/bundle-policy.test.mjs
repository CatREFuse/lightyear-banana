import assert from 'node:assert/strict'
import test from 'node:test'
import { forbiddenBundleMarkers, scanBundleText } from '../scripts/bundlePolicy.mjs'

test('allows the browser and Photoshop host contracts', () => {
  assert.deepEqual(
    scanBundleText('browser photoshop-uxp inner-host/v1 diagnostics.export'),
    []
  )
})

test('detects every retired desktop runtime marker', () => {
  const samples = [
    'electron',
    'window.mugenBridge',
    'app.deployWindows',
    'app.checkForUpdates',
    'app.openMacPermissionSettings',
    'crx.logs.export'
  ]

  assert.equal(samples.length, forbiddenBundleMarkers.length)
  for (const sample of samples) {
    const findings = scanBundleText(sample, 'fixture.js')
    assert.equal(findings.length, 1, `${sample} must be rejected`)
    assert.equal(findings[0].file, 'fixture.js')
  }
})

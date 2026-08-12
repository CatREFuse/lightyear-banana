import assert from 'node:assert/strict'
import test from 'node:test'
import { findForbiddenSourceModule, forbiddenBundleMarkers, scanBundleText } from '../scripts/bundlePolicy.mjs'

test('allows browser and embedded protocol contracts without Adobe host implementation', () => {
  assert.deepEqual(
    scanBundleText('browser photoshop-ccx inner-host/v1 diagnostics.export'),
    []
  )
})

test('detects every retired runtime and test-fixture marker', () => {
  const samples = [
    '@fontsource-variable/doto/files/doto-latin-wght-normal.woff2',
    'electron',
    'window.mugenBridge',
    'app.deployWindows',
    'app.checkForUpdates',
    'app.openMacPermissionSettings',
    'crx.logs.export',
    'MockHostClient',
    '0.3.19',
    'globalThis.require',
    'executeAsModal',
    'getPixels',
    'putPixels',
    "require('uxp')",
    'require("photoshop")'
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
  assert.equal(findForbiddenSourceModule('/workspace/webui/src/host/index.ts'), undefined)
})

test('rejects CCX and retired UXP implementation modules from the WebUI module graph', () => {
  assert.equal(findForbiddenSourceModule('C:\\workspace\\plug-in\\src\\ccx\\canvasPrimitives.ts?import'), '/plug-in/src/ccx/')
  assert.equal(findForbiddenSourceModule('/workspace/src/uxp/photoshopHost.ts'), '/src/uxp/')
  assert.equal(findForbiddenSourceModule('/workspace/src/types/canvas.ts'), undefined)
})

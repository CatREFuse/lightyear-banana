import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  assertProductionUxpArtifactsClean,
  forbiddenProductionUxpMarkers,
  scanProductionUxpArtifacts
} from './uxp-production-artifact-policy.mjs'

function artifactFixture(context) {
  const root = mkdtempSync(path.join(tmpdir(), 'mugen-uxp-artifacts-'))
  context.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(path.join(root, 'assets'), { recursive: true })
  mkdirSync(path.join(root, 'webui', 'assets'), { recursive: true })
  writeFileSync(path.join(root, 'manifest.json'), '{"manifestVersion":5}\n')
  writeFileSync(path.join(root, 'assets', 'host.js'), 'const protocol = "inner-host/v1"\n')
  writeFileSync(path.join(root, 'webui', 'assets', 'app.css'), '.app { display: flex; }\n')
  return root
}

test('accepts clean nested production UXP artifacts, including binary files', async (context) => {
  const root = artifactFixture(context)
  writeFileSync(path.join(root, 'icons.png'), Buffer.from([0, 1, 2, 3]))

  const result = await assertProductionUxpArtifactsClean(root)
  assert.equal(result.scannedFileCount, 4)
  assert.deepEqual(result.findings, [])
})

test('finds every forbidden marker anywhere in the embedded UXP tree', async (context) => {
  const root = artifactFixture(context)

  forbiddenProductionUxpMarkers.forEach((marker, index) => {
    writeFileSync(
      path.join(root, 'webui', 'assets', `leak-${index}${index === 0 ? '.bin' : '.js'}`),
      index === 0 ? Buffer.from(`\0${marker}\0`) : `globalThis.leak = ${JSON.stringify(marker)}\n`
    )
  })

  const result = await scanProductionUxpArtifacts(root)
  assert.deepEqual(result.findings.map(({ marker }) => marker), [...forbiddenProductionUxpMarkers])
  await assert.rejects(
    assertProductionUxpArtifactsClean(root),
    /Production UXP artifacts contain forbidden test or development markers/
  )
})

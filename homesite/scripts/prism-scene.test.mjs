import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  defaultPrismParams,
  isPrismPointer,
  normalizePrismParams,
  prismModelConfig
} from '../site/prism-scene.js'

test('homepage uses the vgpu triangular prism with the approved defaults', () => {
  assert.equal(prismModelConfig.renderer, 'vgpu')
  assert.equal(prismModelConfig.shape, 'hollow-triangular-prism')
  assert.equal(prismModelConfig.opticalBoundary, 'wgsl-sdf-refraction')
  assert.equal(prismModelConfig.spectrumBands, 9)
  assert.equal(defaultPrismParams.dispersionOffsetScale, 2.5)
  assert.equal(defaultPrismParams.baseGlassIor, 1.3)
  assert.equal(defaultPrismParams.rotationSpeed, 0.55)
  assert.equal(defaultPrismParams.incidentAngle, 8)
})

test('prism parameters stay within the product ranges', () => {
  assert.deepEqual(normalizePrismParams({
    dispersionOffsetScale: 12,
    baseGlassIor: 0.8,
    rotationSpeed: 4,
    incidentAngle: -40
  }), {
    dispersionOffsetScale: 5,
    baseGlassIor: 1.3,
    rotationSpeed: 2.5,
    incidentAngle: -10
  })
})

test('pointer hit area follows the visible triangular prism', () => {
  assert.equal(isPrismPointer(0, 0), true)
  assert.equal(isPrismPointer(0, 0.9), false)
  assert.equal(isPrismPointer(0.82, 0), false)
})

test('shader owns the hollow glass boundary, refraction and continuous spectrum', async () => {
  const shader = await readFile(new URL('../site/prism.wgsl', import.meta.url), 'utf8')
  assert.match(shader, /@fragment fn fs_main/)
  assert.match(shader, /fn sdTriangularPrism/)
  assert.match(shader, /fn glassColor/)
  assert.match(shader, /fn sdEquilateralTriangle/)
  assert.match(shader, /index < 9u/)
  assert.doesNotMatch(shader, /THREE|WebGLRenderer/)
})

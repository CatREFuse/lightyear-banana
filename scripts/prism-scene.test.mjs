import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createPrismGeometry,
  prismModelConfig
} from '../site/prism-scene.js'

test('prism model uses a multi-segment physical bevel', () => {
  assert.equal(prismModelConfig.bevelEnabled, true)
  assert.ok(prismModelConfig.bevelThickness > 0)
  assert.ok(prismModelConfig.bevelSize > 0)
  assert.ok(prismModelConfig.bevelSegments >= 3)
  assert.equal(prismModelConfig.opticalBoundary, 'nominal-unbeveled-cross-section')
})

test('extruded prism geometry contains chamfer rings and centered volume', () => {
  const geometry = createPrismGeometry()
  const positions = geometry.getAttribute('position')
  const zLevels = new Set()
  for (let index = 0; index < positions.count; index += 1) {
    zLevels.add(positions.getZ(index).toFixed(4))
  }

  geometry.computeBoundingBox()
  const centerZ = (geometry.boundingBox.min.z + geometry.boundingBox.max.z) / 2
  const renderedDepth = geometry.boundingBox.max.z - geometry.boundingBox.min.z
  assert.ok(positions.count > 60)
  assert.ok(zLevels.size >= prismModelConfig.bevelSegments * 2 + 2)
  assert.ok(Math.abs(centerZ) < 1e-6)
  assert.ok(renderedDepth > prismModelConfig.depth)
  geometry.dispose()
})

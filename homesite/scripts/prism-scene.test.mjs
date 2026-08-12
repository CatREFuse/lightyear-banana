import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createPrismGeometry,
  defaultPrismParams,
  prismModelConfig
} from '../site/prism-scene.js'

test('homepage uses the tetrahedral demo prism with maximum default dispersion', () => {
  assert.equal(prismModelConfig.shape, 'tetrahedron')
  assert.equal(prismModelConfig.faces, 4)
  assert.ok(prismModelConfig.radius > 1)
  assert.equal(prismModelConfig.opticalBoundary, 'raycast-tetrahedron-surfaces')
  assert.equal(defaultPrismParams.dispersionOffsetScale, 5)
  assert.equal(defaultPrismParams.rotationSpeed, 1)
})

test('tetrahedral prism geometry contains four outward-facing surfaces', () => {
  const geometry = createPrismGeometry()
  const positions = geometry.getAttribute('position')
  geometry.computeBoundingBox()
  assert.equal(positions.count, 12)
  assert.ok(geometry.boundingBox.max.y > 1.5)
  assert.ok(geometry.boundingBox.min.z < 0)
  assert.ok(geometry.boundingBox.max.z > 0)
  geometry.dispose()
})

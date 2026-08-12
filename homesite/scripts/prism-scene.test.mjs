import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createPrismGeometry,
  defaultPrismParams,
  prismModelConfig,
  resolveIncidentRay
} from '../site/prism-scene.js'
import * as THREE from '../site/vendor/three.module.min.js'

test('homepage uses the tetrahedral demo prism with the approved defaults', () => {
  assert.equal(prismModelConfig.shape, 'tetrahedron')
  assert.equal(prismModelConfig.faces, 4)
  assert.ok(prismModelConfig.radius > 1)
  assert.equal(prismModelConfig.opticalBoundary, 'raycast-tetrahedron-surfaces')
  assert.equal(defaultPrismParams.dispersionOffsetScale, 2.5)
  assert.equal(defaultPrismParams.baseGlassIor, 1.3)
  assert.equal(defaultPrismParams.rotationSpeed, 0.55)
  assert.equal(defaultPrismParams.incidentAngle, 8)
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

test('incident beam always resolves to the rotating tetrahedron surface', () => {
  const prism = new THREE.Mesh(createPrismGeometry(), new THREE.MeshBasicMaterial())
  const origin = new THREE.Vector3(-6.1, 0.04, -0.18)
  const direction = new THREE.Vector3(1, 0, 0)

  for (let index = 0; index < 24; index += 1) {
    prism.rotation.set(index * 0.09, index * 0.17, index * 0.31)
    prism.updateMatrixWorld(true)
    const resolved = resolveIncidentRay(prism, origin, direction)
    assert.ok(Number.isFinite(resolved.hit.point.x))
    assert.ok(resolved.hit.point.x > origin.x)
    assert.ok(Math.abs(resolved.direction.length() - 1) < 1e-6)
  }

  prism.geometry.dispose()
  prism.material.dispose()
})

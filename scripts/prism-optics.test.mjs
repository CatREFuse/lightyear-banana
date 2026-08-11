import test from 'node:test'
import assert from 'node:assert/strict'
import {
  bk7RefractiveIndex,
  intersectRaySegment,
  refract2,
  tracePrismRay
} from '../site/prism-optics.js'

const triangle = [
  { x: -1.8, y: -1.25 },
  { x: 1.8, y: -1.25 },
  { x: 0, y: 1.82 }
]

function rotate(vertices, angle) {
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return vertices.map(({ x, y }) => ({
    x: x * cosine - y * sine,
    y: x * sine + y * cosine
  }))
}

function angle(vector) {
  return Math.atan2(vector.y, vector.x)
}

test('ray-segment intersection returns the nearest geometric point', () => {
  const hit = intersectRaySegment(
    { x: -2, y: 0.25 },
    { x: 1, y: 0 },
    { x: 0, y: -1 },
    { x: 0, y: 1 }
  )
  assert.ok(hit)
  assert.ok(Math.abs(hit.distance - 2) < 1e-9)
  assert.deepEqual(hit.point, { x: 0, y: 0.25 })
})

test('Snell refraction preserves normal incidence and bends toward the normal in glass', () => {
  const straight = refract2({ x: 1, y: 0 }, { x: -1, y: 0 }, 1, 1.5)
  assert.ok(straight)
  assert.ok(Math.abs(straight.x - 1) < 1e-9)
  assert.ok(Math.abs(straight.y) < 1e-9)

  const incidence = Math.PI / 6
  const refracted = refract2(
    { x: Math.cos(incidence), y: Math.sin(incidence) },
    { x: -1, y: 0 },
    1,
    1.5
  )
  assert.ok(refracted)
  const expected = Math.asin(Math.sin(incidence) / 1.5)
  assert.ok(Math.abs(angle(refracted) - expected) < 1e-9)
})

test('Snell refraction reports total internal reflection', () => {
  const incidence = Math.PI * 50 / 180
  const refracted = refract2(
    { x: Math.sin(incidence), y: Math.cos(incidence) },
    { x: 0, y: -1 },
    1.5,
    1
  )
  assert.equal(refracted, null)
})

test('BK7 dispersion increases refractive index toward violet', () => {
  assert.ok(bk7RefractiveIndex(430) > bk7RefractiveIndex(530))
  assert.ok(bk7RefractiveIndex(530) > bk7RefractiveIndex(650))
  assert.ok(Math.abs(bk7RefractiveIndex(587.6) - 1.5168) < 0.0002)
})

test('each wavelength independently intersects and refracts through the rotated prism', () => {
  const vertices = rotate(triangle, -0.09)
  const red = tracePrismRay({
    vertices,
    origin: { x: -9, y: 0 },
    direction: { x: 1, y: 0 },
    refractiveIndex: bk7RefractiveIndex(650)
  })
  const violet = tracePrismRay({
    vertices,
    origin: { x: -9, y: 0 },
    direction: { x: 1, y: 0 },
    refractiveIndex: bk7RefractiveIndex(430)
  })

  assert.equal(red.status, 'ok')
  assert.equal(violet.status, 'ok')
  assert.deepEqual(red.entry, violet.entry)
  assert.notDeepEqual(red.exit, violet.exit)
  assert.ok(angle(violet.exitDirection) < angle(red.exitDirection))
})

test('a prism rotation changes the solved intersections and outgoing direction', () => {
  const solve = (rotation) => tracePrismRay({
    vertices: rotate(triangle, rotation),
    origin: { x: -9, y: 0 },
    direction: { x: 1, y: 0 },
    refractiveIndex: bk7RefractiveIndex(575)
  })
  const first = solve(-0.25)
  const second = solve(-0.09)
  assert.equal(first.status, 'ok')
  assert.equal(second.status, 'ok')
  assert.notDeepEqual(first.entry, second.entry)
  assert.notDeepEqual(first.exit, second.exit)
  assert.ok(Math.abs(angle(first.exitDirection) - angle(second.exitDirection)) > 0.05)
})

test('total internal reflection is traced to the next face before exiting', () => {
  const trace = tracePrismRay({
    vertices: triangle,
    origin: { x: -9, y: 0 },
    direction: { x: 1, y: 0 },
    refractiveIndex: bk7RefractiveIndex(430)
  })
  assert.equal(trace.status, 'exited-after-reflection')
  assert.equal(trace.internalSegments.length, 2)
  assert.ok(trace.exitDirection)
})

test('a ray that misses the prism receives a finite straight-through fallback', () => {
  const trace = tracePrismRay({
    vertices: triangle,
    origin: { x: -9, y: 5 },
    direction: { x: 1, y: 0 },
    refractiveIndex: bk7RefractiveIndex(575),
    farDistance: 14
  })
  assert.equal(trace.status, 'miss')
  assert.deepEqual(trace.fallbackEnd, { x: 5, y: 5 })
})

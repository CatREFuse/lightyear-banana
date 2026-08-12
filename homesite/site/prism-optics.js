const EPSILON = 1e-7

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y }
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y }
}

function scale(vector, scalar) {
  return { x: vector.x * scalar, y: vector.y * scalar }
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y
}

function cross(a, b) {
  return a.x * b.y - a.y * b.x
}

function length(vector) {
  return Math.hypot(vector.x, vector.y)
}

export function normalize2(vector) {
  const magnitude = length(vector)
  if (magnitude <= EPSILON) return null
  return scale(vector, 1 / magnitude)
}

export function intersectRaySegment(origin, direction, start, end, epsilon = EPSILON) {
  const rayDirection = normalize2(direction)
  if (!rayDirection) return null

  const edge = subtract(end, start)
  const denominator = cross(rayDirection, edge)
  if (Math.abs(denominator) <= epsilon) return null

  const offset = subtract(start, origin)
  const distance = cross(offset, edge) / denominator
  const edgePosition = cross(offset, rayDirection) / denominator
  if (distance <= epsilon || edgePosition < -epsilon || edgePosition > 1 + epsilon) return null

  return {
    distance,
    edgePosition,
    point: add(origin, scale(rayDirection, distance))
  }
}

export function refract2(incident, opposingNormal, fromIndex, toIndex) {
  const ray = normalize2(incident)
  let normal = normalize2(opposingNormal)
  if (!ray || !normal || fromIndex <= 0 || toIndex <= 0) return null

  if (dot(ray, normal) > 0) normal = scale(normal, -1)
  const ratio = fromIndex / toIndex
  const cosine = Math.max(0, Math.min(1, -dot(ray, normal)))
  const discriminant = 1 - ratio * ratio * (1 - cosine * cosine)
  if (discriminant < -EPSILON) return null

  return normalize2(add(
    scale(ray, ratio),
    scale(normal, ratio * cosine - Math.sqrt(Math.max(0, discriminant)))
  ))
}

export function reflect2(incident, surfaceNormal) {
  const ray = normalize2(incident)
  const normal = normalize2(surfaceNormal)
  if (!ray || !normal) return null
  return normalize2(subtract(ray, scale(normal, 2 * dot(ray, normal))))
}

export function bk7RefractiveIndex(wavelengthNanometers) {
  const wavelengthMicrometers = wavelengthNanometers / 1000
  const wavelengthSquared = wavelengthMicrometers * wavelengthMicrometers
  const b1 = 1.03961212
  const b2 = 0.231792344
  const b3 = 1.01046945
  const c1 = 0.00600069867
  const c2 = 0.0200179144
  const c3 = 103.560653
  const indexSquared = 1
    + b1 * wavelengthSquared / (wavelengthSquared - c1)
    + b2 * wavelengthSquared / (wavelengthSquared - c2)
    + b3 * wavelengthSquared / (wavelengthSquared - c3)
  return Math.sqrt(indexSquared)
}

function buildEdges(vertices) {
  const centroid = vertices.reduce(
    (sum, vertex) => add(sum, vertex),
    { x: 0, y: 0 }
  )
  centroid.x /= vertices.length
  centroid.y /= vertices.length

  return vertices.map((start, index) => {
    const end = vertices[(index + 1) % vertices.length]
    const edge = subtract(end, start)
    const midpoint = scale(add(start, end), 0.5)
    let normal = normalize2({ x: edge.y, y: -edge.x })
    if (!normal) return null
    if (dot(normal, subtract(centroid, midpoint)) > 0) normal = scale(normal, -1)
    return { index, start, end, outwardNormal: normal }
  }).filter(Boolean)
}

function nearestBoundaryHit(edges, origin, direction, ignoredEdge = -1) {
  let nearest = null
  for (const edge of edges) {
    if (edge.index === ignoredEdge) continue
    const hit = intersectRaySegment(origin, direction, edge.start, edge.end)
    if (!hit || (nearest && hit.distance >= nearest.distance)) continue
    nearest = { ...hit, edge }
  }
  return nearest
}

export function tracePrismRay({
  vertices,
  origin,
  direction,
  refractiveIndex,
  maxInternalBounces = 4,
  farDistance = 12
}) {
  if (!Array.isArray(vertices) || vertices.length < 3) {
    return { status: 'invalid-prism', internalSegments: [] }
  }

  const incidentDirection = normalize2(direction)
  if (!incidentDirection || !Number.isFinite(refractiveIndex) || refractiveIndex <= 1) {
    return { status: 'invalid-ray', internalSegments: [] }
  }

  const edges = buildEdges(vertices)
  const entry = nearestBoundaryHit(edges, origin, incidentDirection)
  if (!entry || dot(incidentDirection, entry.edge.outwardNormal) >= -EPSILON) {
    return {
      status: 'miss',
      internalSegments: [],
      fallbackEnd: add(origin, scale(incidentDirection, farDistance))
    }
  }

  const insideDirection = refract2(
    incidentDirection,
    entry.edge.outwardNormal,
    1,
    refractiveIndex
  )
  if (!insideDirection) {
    return {
      status: 'entry-reflection',
      entry: entry.point,
      internalSegments: [],
      fallbackEnd: entry.point
    }
  }

  const internalSegments = []
  let segmentStart = entry.point
  let rayDirection = insideDirection
  let previousEdge = entry.edge.index
  let reflected = false

  for (let bounce = 0; bounce <= maxInternalBounces; bounce += 1) {
    const shiftedOrigin = add(segmentStart, scale(rayDirection, EPSILON * 100))
    const boundary = nearestBoundaryHit(edges, shiftedOrigin, rayDirection, previousEdge)
    if (!boundary) {
      return {
        status: 'no-exit',
        entry: entry.point,
        internalSegments,
        fallbackEnd: add(segmentStart, scale(rayDirection, farDistance))
      }
    }

    internalSegments.push({ start: segmentStart, end: boundary.point })
    const exitDirection = refract2(
      rayDirection,
      scale(boundary.edge.outwardNormal, -1),
      refractiveIndex,
      1
    )

    if (exitDirection) {
      return {
        status: reflected ? 'exited-after-reflection' : 'ok',
        entry: entry.point,
        exit: boundary.point,
        exitDirection,
        internalSegments,
        outgoingEnd: add(boundary.point, scale(exitDirection, farDistance))
      }
    }

    const reflectedDirection = reflect2(rayDirection, boundary.edge.outwardNormal)
    if (!reflectedDirection) break
    reflected = true
    rayDirection = reflectedDirection
    segmentStart = boundary.point
    previousEdge = boundary.edge.index
  }

  return {
    status: 'total-internal-reflection',
    entry: entry.point,
    internalSegments
  }
}

export function tracePrismSpectrum({ vertices, origin, direction, samples, farDistance }) {
  return samples.map((sample) => ({
    ...sample,
    trace: tracePrismRay({
      vertices,
      origin,
      direction,
      refractiveIndex: sample.refractiveIndex,
      farDistance
    })
  }))
}

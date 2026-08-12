import * as THREE from './vendor/three.module.min.js'
import { RoomEnvironment } from './vendor/RoomEnvironment.js'

export const defaultPrismParams = Object.freeze({
  dispersionOffsetScale: 5,
  baseGlassIor: 1.49,
  rotationSpeed: 1,
  incidentAngle: 2.6
})

const spectrum = [
  { color: '#ff2d2d', endY: 0.98, ior: 1.49 },
  { color: '#ff8a1f', endY: 0.62, ior: 1.512 },
  { color: '#fff152', endY: 0.26, ior: 1.538 },
  { color: '#57ff83', endY: -0.1, ior: 1.57 },
  { color: '#36c9ff', endY: -0.46, ior: 1.606 },
  { color: '#9b6cff', endY: -0.82, ior: 1.648 }
]

const tetrahedronRadius = 1.56
const tetrahedronBaseRadius = (tetrahedronRadius * 2 * Math.sqrt(2)) / 3
const causticCurveSegments = 384
const lightPathUpdateInterval = 1 / 120
const baseSpectrumIor = spectrum[0].ior
const referenceIorOffset = 1.57 - baseSpectrumIor
const incomingAimPoint = new THREE.Vector3(-0.78, 0.04, -0.18)
const incomingBeamDistance = 5.326
const prismFaces = [
  [0, 1, 2],
  [0, 3, 1],
  [0, 2, 3],
  [1, 3, 2]
]
const tetrahedronVertices = [
  new THREE.Vector3(0, tetrahedronRadius, 0),
  new THREE.Vector3(-tetrahedronBaseRadius * 0.866, -tetrahedronRadius / 3, -tetrahedronBaseRadius * 0.5),
  new THREE.Vector3(tetrahedronBaseRadius * 0.866, -tetrahedronRadius / 3, -tetrahedronBaseRadius * 0.5),
  new THREE.Vector3(0, -tetrahedronRadius / 3, tetrahedronBaseRadius)
]
const entryFaceNormal = createOutwardFaceNormal(0, 3, 1)
const exitFaceNormal = createOutwardFaceNormal(0, 2, 3)

export const prismModelConfig = Object.freeze({
  shape: 'tetrahedron',
  radius: tetrahedronRadius,
  faces: prismFaces.length,
  opticalBoundary: 'raycast-tetrahedron-surfaces'
})

function createOutwardFaceNormal(aIndex, bIndex, cIndex) {
  const a = tetrahedronVertices[aIndex]
  const b = tetrahedronVertices[bIndex]
  const c = tetrahedronVertices[cIndex]
  const normal = new THREE.Vector3()
    .crossVectors(new THREE.Vector3().subVectors(b, a), new THREE.Vector3().subVectors(c, a))
    .normalize()
  const faceCenter = new THREE.Vector3().add(a).add(b).add(c).multiplyScalar(1 / 3)
  if (normal.dot(faceCenter) < 0) normal.negate()
  return normal
}

export function createPrismGeometry() {
  const positions = []
  const normals = []
  const indices = []
  prismFaces.forEach(([aIndex, bIndex, cIndex]) => {
    const normal = createOutwardFaceNormal(aIndex, bIndex, cIndex)
    addSurfaceTriangle(
      indices,
      positions,
      addVertex(positions, normals, tetrahedronVertices[aIndex], normal),
      addVertex(positions, normals, tetrahedronVertices[bIndex], normal),
      addVertex(positions, normals, tetrahedronVertices[cIndex], normal)
    )
  })

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

function addVertex(positions, normals, point, normal) {
  const index = positions.length / 3
  positions.push(point.x, point.y, point.z)
  normals.push(normal.x, normal.y, normal.z)
  return index
}

function addSurfaceTriangle(indices, positions, a, b, c) {
  const pointA = readPosition(positions, a)
  const pointB = readPosition(positions, b)
  const pointC = readPosition(positions, c)
  const expectedNormal = new THREE.Vector3().add(pointA).add(pointB).add(pointC).normalize()
  const normal = new THREE.Vector3()
    .crossVectors(new THREE.Vector3().subVectors(pointB, pointA), new THREE.Vector3().subVectors(pointC, pointA))
    .normalize()
  if (normal.dot(expectedNormal) >= 0) indices.push(a, b, c)
  else indices.push(a, c, b)
}

function readPosition(positions, index) {
  const offset = index * 3
  return new THREE.Vector3(positions[offset], positions[offset + 1], positions[offset + 2])
}

function createIncidentDirection(angleDegrees) {
  const angle = THREE.MathUtils.degToRad(angleDegrees)
  return new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0).normalize()
}

function createIncomingStart(direction, z) {
  return new THREE.Vector3(
    incomingAimPoint.x - direction.x * incomingBeamDistance,
    incomingAimPoint.y - direction.y * incomingBeamDistance,
    z
  )
}

function getIorForOffset(iorOffset, params) {
  return params.baseGlassIor + iorOffset * params.dispersionOffsetScale
}

function updateSpectrumBeams(
  beams,
  internalBeams,
  prism,
  entryPoint,
  entryNormal,
  fallbackExitPoint,
  incidentDirection,
  params,
  referenceIor,
  blend
) {
  const referenceInsideDirection =
    refractDirection(incidentDirection, entryNormal, 1, referenceIor)
    || reflectDirection(incidentDirection, entryNormal)
  const referenceExitHit = findSurfaceHit(
    prism,
    new THREE.Vector3().copy(entryPoint).addScaledVector(referenceInsideDirection, 0.035),
    referenceInsideDirection,
    0.001
  )
  const referenceExitPoint = referenceExitHit?.point || fallbackExitPoint
  const referenceExitNormal = referenceExitHit?.normal || new THREE.Vector3().copy(exitFaceNormal)
  const referenceOutgoingDirection =
    refractDirection(referenceInsideDirection, referenceExitNormal, referenceIor, 1)
    || reflectDirection(referenceInsideDirection, referenceExitNormal)
  let visibleExitPoint = referenceExitPoint
  const pathCache = new Map()

  function calculatePath(iorOffset) {
    const ior = getIorForOffset(iorOffset, params)
    const cached = pathCache.get(ior)
    if (cached) return cached
    const insideDirection =
      refractDirection(incidentDirection, entryNormal, 1, ior)
      || reflectDirection(incidentDirection, entryNormal)
    const exitHit = findSurfaceHit(
      prism,
      new THREE.Vector3().copy(entryPoint).addScaledVector(insideDirection, 0.035),
      insideDirection,
      0.001
    )
    const exitPoint = exitHit?.point || referenceExitPoint
    const exitNormal = exitHit?.normal || referenceExitNormal
    const outgoingDirection =
      refractDirection(insideDirection, exitNormal, ior, 1)
      || referenceOutgoingDirection.clone()
    const path = { insideDirection, exitPoint, exitNormal, outgoingDirection }
    pathCache.set(ior, path)
    return path
  }

  internalBeams.forEach((beam) => {
    const { insideDirection, exitPoint } = calculatePath(beam.iorOffset)
    const start = new THREE.Vector3().copy(entryPoint).addScaledVector(insideDirection, 0.012)
    const end = new THREE.Vector3().copy(exitPoint).addScaledVector(insideDirection, -0.012)
    setBeamGeometry(beam.mesh.geometry, {
      start,
      end,
      width: beam.width,
      color: '#ffffff',
      opacity: 1,
      softness: 1
    }, blend)
  })

  beams.forEach((beam) => {
    const { exitPoint, outgoingDirection } = calculatePath(beam.iorOffset)
    visibleExitPoint = exitPoint
    setBeamGeometry(beam.mesh.geometry, {
      start: exitPoint,
      end: new THREE.Vector3(
        exitPoint.x + outgoingDirection.x * beam.length,
        exitPoint.y + outgoingDirection.y * beam.length,
        exitPoint.z + outgoingDirection.z * beam.length
      ),
      width: beam.width,
      color: '#ffffff',
      opacity: 1,
      softness: 1
    }, blend)
  })
  return visibleExitPoint
}

function findSurfaceHit(object, origin, direction, near) {
  const raycaster = new THREE.Raycaster(origin, new THREE.Vector3().copy(direction).normalize(), near, 20)
  const hit = raycaster.intersectObject(object, false).find((item) => item.face)
  if (!hit?.face) return undefined
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(object.matrixWorld)
  const normal = new THREE.Vector3().copy(hit.face.normal).applyNormalMatrix(normalMatrix).normalize()
  const objectCenter = new THREE.Vector3()
  object.getWorldPosition(objectCenter)
  if (normal.dot(new THREE.Vector3().subVectors(hit.point, objectCenter)) < 0) normal.negate()
  return { point: hit.point.clone(), normal }
}

function refractDirection(direction, outwardNormal, fromIor, toIor) {
  const incident = new THREE.Vector3().copy(direction).normalize()
  const normal = new THREE.Vector3().copy(outwardNormal).normalize()
  if (incident.dot(normal) > 0) normal.negate()
  const eta = fromIor / toIor
  const cosTheta = THREE.MathUtils.clamp(-incident.dot(normal), -1, 1)
  const sin2Theta = eta * eta * (1 - cosTheta * cosTheta)
  if (sin2Theta > 1) return null
  const cosThetaT = Math.sqrt(1 - sin2Theta)
  return incident.multiplyScalar(eta).addScaledVector(normal, eta * cosTheta - cosThetaT).normalize()
}

function reflectDirection(direction, outwardNormal) {
  const normal = new THREE.Vector3().copy(outwardNormal).normalize()
  return new THREE.Vector3().copy(direction).sub(normal.multiplyScalar(2 * direction.dot(normal))).normalize()
}

function createBeam(spec) {
  const geometry = new THREE.BufferGeometry()
  setBeamGeometry(geometry, spec)
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1], 2))
  return new THREE.Mesh(geometry, createBeamMaterial(spec))
}

function setBeamGeometry(geometry, spec, blend = 1) {
  const direction = new THREE.Vector3().subVectors(spec.end, spec.start)
  const perpendicular = new THREE.Vector3(-direction.y, direction.x, 0).normalize().multiplyScalar(spec.width / 2)
  const startA = new THREE.Vector3().copy(spec.start).add(perpendicular)
  const startB = new THREE.Vector3().copy(spec.start).sub(perpendicular)
  const endA = new THREE.Vector3().copy(spec.end).add(perpendicular)
  const endB = new THREE.Vector3().copy(spec.end).sub(perpendicular)
  const values = new Float32Array([
    startA.x, startA.y, startA.z,
    startB.x, startB.y, startB.z,
    endB.x, endB.y, endB.z,
    startA.x, startA.y, startA.z,
    endB.x, endB.y, endB.z,
    endA.x, endA.y, endA.z
  ])
  const attribute = geometry.getAttribute('position')
  if (attribute) {
    const current = attribute.array
    if (blend >= 1) current.set(values)
    else {
      for (let index = 0; index < current.length; index += 1) {
        current[index] = THREE.MathUtils.lerp(current[index], values[index], blend)
      }
    }
    attribute.needsUpdate = true
  } else {
    geometry.setAttribute('position', new THREE.BufferAttribute(values, 3))
  }
  geometry.computeBoundingSphere()
}

function createBeamMaterial(spec) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(spec.color) },
      uOpacity: { value: spec.opacity },
      uSoftness: { value: spec.softness },
      uTime: { value: 0 }
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uSoftness;
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float center = max(1.0 - abs(vUv.y - 0.5) * 2.0, 0.0);
        float headFade = smoothstep(0.0, 0.14, vUv.x);
        float tailFade = 1.0 - smoothstep(0.86, 1.0, vUv.x);
        float shimmer = 0.82 + 0.18 * sin(vUv.x * 24.0 - uTime * 2.4);
        float core = pow(center, uSoftness) * headFade * tailFade;
        float halo = pow(center, 0.45) * headFade * tailFade * 0.18;
        float alpha = (core + halo) * uOpacity * shimmer;
        gl_FragColor = vec4(uColor, alpha);
      }
    `
  })
}

function createGlowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = 160
  canvas.height = 160
  const context = canvas.getContext('2d')
  if (!context) return new THREE.CanvasTexture(canvas)
  const gradient = context.createRadialGradient(80, 80, 0, 80, 80, 80)
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
  gradient.addColorStop(0.2, 'rgba(255, 255, 255, 0.66)')
  gradient.addColorStop(0.52, 'rgba(160, 235, 255, 0.18)')
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 160, 160)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function createGlowSprite(texture, color, opacity) {
  return new THREE.Sprite(new THREE.SpriteMaterial({
    map: texture,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending
  }))
}

function createCaustics() {
  const group = new THREE.Group()
  ;['#7be7ff', '#ffffff', '#ff7a3c'].forEach((color, index) => {
    const curve = new THREE.EllipseCurve(0, 0, 1.15 + index * 0.18, 0.32 + index * 0.06, 0, Math.PI * 2)
    const points = curve.getPoints(causticCurveSegments).map((point) => (
      new THREE.Vector3(point.x + 0.08, point.y - 0.16, -0.38 - index * 0.02)
    ))
    const geometry = new THREE.BufferGeometry().setFromPoints(points)
    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
    const line = new THREE.LineLoop(geometry, material)
    line.scale.set(1.18 + index * 0.08, 0.78 + index * 0.05, 1)
    line.rotation.z = index * 0.74
    group.add(line)
  })
  return group
}

function createDust() {
  const count = 180
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const colorA = new THREE.Color('#bdf7ff')
  const colorB = new THREE.Color('#ff8b49')
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3
    positions[offset] = (Math.random() - 0.5) * 12
    positions[offset + 1] = (Math.random() - 0.5) * 5.8
    positions[offset + 2] = -1.7 - Math.random() * 2.6
    const mixed = colorA.clone().lerp(colorB, Math.random() * 0.45)
    colors[offset] = mixed.r
    colors[offset + 1] = mixed.g
    colors[offset + 2] = mixed.b
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return new THREE.Points(geometry, new THREE.PointsMaterial({
    size: 0.024,
    vertexColors: true,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  }))
}

function disposeScene(scene, renderer, resources) {
  resources.geometries.forEach((geometry) => geometry.dispose())
  resources.materials.forEach((material) => material.dispose())
  resources.textures.forEach((texture) => texture.dispose())
  resources.environment?.dispose()
  resources.room?.dispose()
  resources.pmrem?.dispose()
  renderer?.renderLists?.dispose()
  renderer?.dispose()
  renderer?.forceContextLoss()
  scene?.clear()
}

export function createPrismScene(canvas, stage, options = {}) {
  const params = { ...defaultPrismParams, ...options.initialParams }
  const resources = { geometries: [], materials: [], textures: [], environment: null, room: null, pmrem: null }
  let renderer
  let scene
  let disposed = false
  let paused = false
  let failed = false
  let resizeObserver = null

  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.38
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearColor(0x020203, 0)

    scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x020203, 0.038)
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
    camera.position.set(0, 0.08, 8.3)
    camera.lookAt(0, 0, 0)

    const pmrem = new THREE.PMREMGenerator(renderer)
    const room = new RoomEnvironment()
    const environment = pmrem.fromScene(room, 0.04)
    resources.pmrem = pmrem
    resources.room = room
    resources.environment = environment
    scene.environment = environment.texture

    const beamMaterials = []
    const spectrumBeams = []
    const internalBeams = []
    scene.add(new THREE.AmbientLight(0xffffff, 0.72))
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2)
    keyLight.position.set(-2.6, 3.4, 5)
    scene.add(keyLight)
    const rimLight = new THREE.PointLight(0xaadfff, 4.8, 9)
    rimLight.position.set(1.8, 1.7, 2.4)
    scene.add(rimLight)

    const prismGroup = new THREE.Group()
    prismGroup.rotation.set(0.08, -0.1, 0.02)
    prismGroup.scale.setScalar(0.84)
    scene.add(prismGroup)
    const prismGeometry = createPrismGeometry()
    resources.geometries.push(prismGeometry)
    const prismMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#e8ffff'),
      metalness: 0,
      roughness: 0.085,
      transmission: 1,
      thickness: 0.78,
      ior: 1.52,
      dispersion: 0.74,
      attenuationColor: new THREE.Color('#bafcff'),
      attenuationDistance: 4.6,
      clearcoat: 1,
      clearcoatRoughness: 0.14,
      envMapIntensity: 0.28,
      iridescence: 0.2,
      iridescenceIOR: 1.36,
      iridescenceThicknessRange: [120, 540],
      opacity: 0.68,
      transparent: true,
      side: THREE.DoubleSide
    })
    resources.materials.push(prismMaterial)
    const prism = new THREE.Mesh(prismGeometry, prismMaterial)
    prism.renderOrder = 4
    prismGroup.add(prism)

    const innerMaterial = new THREE.MeshBasicMaterial({
      color: '#bdf8ff',
      transparent: true,
      opacity: 0.065,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide
    })
    resources.materials.push(innerMaterial)
    const innerGlow = new THREE.Mesh(prismGeometry, innerMaterial)
    innerGlow.scale.set(0.94, 0.94, 0.94)
    innerGlow.renderOrder = 3
    prismGroup.add(innerGlow)

    const beamGroup = new THREE.Group()
    scene.add(beamGroup)
    const initialIncidentDirection = createIncidentDirection(params.incidentAngle)
    const whiteCore = createBeam({
      start: createIncomingStart(initialIncidentDirection, -0.18),
      end: new THREE.Vector3(-0.78, 0.04, -0.18),
      width: 0.13,
      color: '#ffffff',
      opacity: 1,
      softness: 2.8
    })
    const whiteGlow = createBeam({
      start: createIncomingStart(initialIncidentDirection, -0.19),
      end: new THREE.Vector3(-0.78, 0.04, -0.19),
      width: 0.52,
      color: '#eafcff',
      opacity: 0.34,
      softness: 0.8
    })
    beamMaterials.push(whiteCore.material, whiteGlow.material)
    resources.geometries.push(whiteCore.geometry, whiteGlow.geometry)
    resources.materials.push(whiteCore.material, whiteGlow.material)
    beamGroup.add(whiteGlow, whiteCore)

    const spectrumCoreWidth = 0.075
    const spectrumGlowWidth = 0.28
    spectrum.forEach((band, index) => {
      const core = createBeam({
        start: new THREE.Vector3(0.82, -0.04, -0.2),
        end: new THREE.Vector3(6.08, band.endY, -0.2),
        width: spectrumCoreWidth,
        color: band.color,
        opacity: 0.7,
        softness: 2.55
      })
      const glow = createBeam({
        start: new THREE.Vector3(0.76, -0.05, -0.21),
        end: new THREE.Vector3(6.16, band.endY, -0.21),
        width: spectrumGlowWidth,
        color: band.color,
        opacity: 0.14,
        softness: 0.72
      })
      const internal = createBeam({
        start: new THREE.Vector3(-0.46, 0, -0.12),
        end: new THREE.Vector3(0.46, 0, -0.12),
        width: 0.052,
        color: band.color,
        opacity: 0.46,
        softness: 2.8
      })
      core.renderOrder = 2
      glow.renderOrder = 1
      internal.renderOrder = 7
      beamMaterials.push(core.material, glow.material, internal.material)
      resources.geometries.push(core.geometry, glow.geometry, internal.geometry)
      resources.materials.push(core.material, glow.material, internal.material)
      spectrumBeams.push(
        { mesh: core, iorOffset: band.ior - baseSpectrumIor, width: spectrumCoreWidth, length: 5.15 + index * 0.12 },
        { mesh: glow, iorOffset: band.ior - baseSpectrumIor, width: spectrumGlowWidth, length: 5.28 + index * 0.12 }
      )
      internalBeams.push({ mesh: internal, iorOffset: band.ior - baseSpectrumIor, width: 0.052 })
      beamGroup.add(glow, core, internal)
    })

    const glowTexture = createGlowTexture()
    resources.textures.push(glowTexture)
    const entryGlow = createGlowSprite(glowTexture, '#ffffff', 0.7)
    entryGlow.position.set(-0.8, 0.04, 0.04)
    const exitGlow = createGlowSprite(glowTexture, '#e7fbff', 0.82)
    exitGlow.position.set(0.8, -0.04, 0.05)
    exitGlow.scale.set(1.14, 1.14, 1)
    resources.materials.push(entryGlow.material, exitGlow.material)
    scene.add(entryGlow, exitGlow)

    const causticGroup = createCaustics()
    causticGroup.traverse((object) => {
      if (object.geometry) resources.geometries.push(object.geometry)
      if (object.material) resources.materials.push(object.material)
    })
    scene.add(causticGroup)
    const dust = createDust()
    resources.geometries.push(dust.geometry)
    resources.materials.push(dust.material)
    scene.add(dust)

    let entrySurfacePoint = new THREE.Vector3(-0.8, 0.04, -0.18)
    let entrySurfaceNormal = entryFaceNormal.clone()
    let exitSurfacePoint = new THREE.Vector3(0.8, -0.04, -0.2)
    const smoothedEntryPoint = entrySurfacePoint.clone()
    const smoothedEntryNormal = entrySurfaceNormal.clone()
    const smoothedExitPoint = exitSurfacePoint.clone()
    const startedAt = performance.now()
    let lastFrameTime = startedAt
    let animationTime = 0
    const manualRotation = new THREE.Vector2()
    const drag = { active: false, pointerId: -1, lastX: 0, lastY: 0, travel: 0 }
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

    function resize() {
      const width = Math.max(stage.clientWidth, 1)
      const height = Math.max(stage.clientHeight, 1)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.position.z = width < 720 ? 9.8 : 8.3
      camera.position.y = width < 720 ? 0.16 : 0.08
      camera.updateProjectionMatrix()
    }

    function hitsPrism(event) {
      const rect = canvas.getBoundingClientRect()
      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      )
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(pointer, camera)
      return raycaster.intersectObject(prism, false).length > 0
    }

    function handlePointerDown(event) {
      drag.active = true
      drag.pointerId = event.pointerId
      drag.lastX = event.clientX
      drag.lastY = event.clientY
      drag.travel = 0
      canvas.setPointerCapture?.(event.pointerId)
    }

    function handlePointerMove(event) {
      if (!drag.active || event.pointerId !== drag.pointerId) return
      const deltaX = event.clientX - drag.lastX
      const deltaY = event.clientY - drag.lastY
      drag.lastX = event.clientX
      drag.lastY = event.clientY
      drag.travel += Math.hypot(deltaX, deltaY)
      manualRotation.y += deltaX * 0.0065
      manualRotation.x = THREE.MathUtils.clamp(manualRotation.x + deltaY * 0.0055, -1.1, 1.1)
    }

    function handlePointerUp(event) {
      if (event.pointerId !== drag.pointerId) return
      const isPrismClick = event.type !== 'pointercancel' && drag.travel <= 7 && hitsPrism(event)
      drag.active = false
      drag.pointerId = -1
      if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture?.(event.pointerId)
      if (isPrismClick) options.onPrismClick?.()
    }

    function renderFrame(frameTime) {
      if (disposed || paused || failed || document.hidden) return
      try {
        const elapsed = (frameTime - startedAt) / 1000
        const deltaSeconds = Math.min((frameTime - lastFrameTime) / 1000, 0.05)
        const updateCount = Math.max(1, Math.min(8, Math.ceil(deltaSeconds / lightPathUpdateInterval)))
        const pathBlend = 1 - Math.exp(-(deltaSeconds / updateCount) * 72)
        lastFrameTime = frameTime
        animationTime = elapsed
        const pulse = 0.5 + 0.5 * Math.sin(elapsed * 1.8)
        const rotationTime = elapsed * params.rotationSpeed

        prismGroup.rotation.y = manualRotation.y - 0.1 + Math.sin(rotationTime * 0.58) * 0.16
        prismGroup.rotation.x = manualRotation.x + 0.08 + Math.sin(rotationTime * 0.48) * 0.05
        prismGroup.rotation.z = rotationTime * 0.2
        innerGlow.scale.setScalar(0.92 + pulse * 0.035)
        prismGroup.updateMatrixWorld(true)

        const incidentDirection = createIncidentDirection(params.incidentAngle)
        const incomingBeamStart = createIncomingStart(incidentDirection, -0.18)
        const incomingGlowStart = createIncomingStart(incidentDirection, -0.19)
        const referenceIor = getIorForOffset(referenceIorOffset, params)
        prismMaterial.ior = params.baseGlassIor
        prismMaterial.dispersion = 0.74 * params.dispersionOffsetScale
        const entryHit = findSurfaceHit(prism, incomingBeamStart, incidentDirection, 0.001)
        if (entryHit) {
          entrySurfacePoint = entryHit.point
          entrySurfaceNormal = entryHit.normal
        }
        beamMaterials.forEach((material, index) => {
          material.uniforms.uTime.value = elapsed + index * 0.19
        })
        for (let index = 0; index < updateCount; index += 1) {
          smoothedEntryPoint.lerp(entrySurfacePoint, pathBlend)
          smoothedEntryNormal.lerp(entrySurfaceNormal, pathBlend).normalize()
          setBeamGeometry(whiteCore.geometry, {
            start: incomingBeamStart,
            end: smoothedEntryPoint,
            width: 0.13,
            color: '#ffffff',
            opacity: 1,
            softness: 1
          }, pathBlend)
          setBeamGeometry(whiteGlow.geometry, {
            start: incomingGlowStart,
            end: smoothedEntryPoint,
            width: 0.52,
            color: '#ffffff',
            opacity: 1,
            softness: 1
          }, pathBlend)
          exitSurfacePoint = updateSpectrumBeams(
            spectrumBeams,
            internalBeams,
            prism,
            smoothedEntryPoint,
            smoothedEntryNormal,
            smoothedExitPoint,
            incidentDirection,
            params,
            referenceIor,
            pathBlend
          )
          smoothedExitPoint.lerp(exitSurfacePoint, pathBlend)
        }
        entryGlow.material.opacity = 0.56 + pulse * 0.16
        exitGlow.material.opacity = 0.36 + pulse * 0.08
        entryGlow.position.set(smoothedEntryPoint.x, smoothedEntryPoint.y, smoothedEntryPoint.z + 0.22)
        exitGlow.position.set(smoothedExitPoint.x, smoothedExitPoint.y, smoothedExitPoint.z + 0.22)
        causticGroup.rotation.z = Math.sin(elapsed * 0.34) * 0.035
        causticGroup.children.forEach((child, index) => {
          child.rotation.z = elapsed * (index % 2 === 0 ? 0.06 : -0.045)
        })
        dust.rotation.z = elapsed * 0.012
        dust.rotation.y = Math.sin(elapsed * 0.22) * 0.08
        renderer.render(scene, camera)
      } catch (error) {
        failed = true
        dispose()
        options.onFatal?.(error)
      }
    }

    function renderStatic() {
      lastFrameTime = performance.now()
      renderFrame(lastFrameTime)
    }

    function syncAnimation() {
      if (disposed || failed || paused || document.hidden) {
        renderer.setAnimationLoop(null)
        return
      }
      if (reduceMotion.matches) {
        renderer.setAnimationLoop(null)
        renderStatic()
        return
      }
      lastFrameTime = performance.now()
      renderer.setAnimationLoop(renderFrame)
    }

    function handleVisibility() {
      syncAnimation()
    }

    function handleContextLost(event) {
      event.preventDefault?.()
      if (disposed || failed) return
      failed = true
      dispose()
      options.onFatal?.(new Error('WebGL context lost'))
    }

    function setParams(nextParams) {
      Object.assign(params, nextParams)
      if (reduceMotion.matches && !paused) renderStatic()
      return { ...params }
    }

    function pause() {
      if (disposed || failed) return false
      paused = true
      renderer.setAnimationLoop(null)
      return true
    }

    function resume() {
      if (disposed || failed) return false
      paused = false
      syncAnimation()
      return true
    }

    function dispose() {
      if (disposed) return
      disposed = true
      renderer.setAnimationLoop(null)
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerup', handlePointerUp)
      canvas.removeEventListener('pointercancel', handlePointerUp)
      canvas.removeEventListener('webglcontextlost', handleContextLost)
      document.removeEventListener('visibilitychange', handleVisibility)
      reduceMotion.removeEventListener?.('change', syncAnimation)
      resizeObserver?.disconnect()
      if (!resizeObserver) window.removeEventListener('resize', resize)
      disposeScene(scene, renderer, resources)
    }

    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerup', handlePointerUp)
    canvas.addEventListener('pointercancel', handlePointerUp)
    canvas.addEventListener('webglcontextlost', handleContextLost)
    document.addEventListener('visibilitychange', handleVisibility)
    reduceMotion.addEventListener?.('change', syncAnimation)
    resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null
    resizeObserver?.observe(stage)
    if (!resizeObserver) window.addEventListener('resize', resize)
    resize()
    syncAnimation()
    return { dispose, pause, resume, setParams }
  } catch (error) {
    disposeScene(scene, renderer, resources)
    throw error
  }
}

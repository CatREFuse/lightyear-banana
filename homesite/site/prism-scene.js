import * as THREE from './vendor/three.module.min.js'
import {
  bk7RefractiveIndex,
  tracePrismSpectrum
} from './prism-optics.js'

const prismCrossSection = [
  { x: -1.8, y: -1.25 },
  { x: 1.8, y: -1.25 },
  { x: 0, y: 1.82 }
]

export const prismModelConfig = Object.freeze({
  depth: 1.34,
  bevelEnabled: true,
  bevelThickness: 0.12,
  bevelSize: 0.105,
  bevelSegments: 5,
  opticalBoundary: 'nominal-unbeveled-cross-section'
})

const spectrum = [
  { wavelength: 650, color: 0xff3155 },
  { wavelength: 600, color: 0xff8a2a },
  { wavelength: 575, color: 0xffe95d },
  { wavelength: 530, color: 0x57ed86 },
  { wavelength: 480, color: 0x50b8ff },
  { wavelength: 430, color: 0x7868ff }
].map((sample) => ({
  ...sample,
  refractiveIndex: bk7RefractiveIndex(sample.wavelength)
}))

const glowVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const glowFragmentShader = `
  uniform vec3 beamColor;
  uniform float beamOpacity;
  uniform float beamFalloff;
  varying vec2 vUv;

  void main() {
    float axisDistance = abs(vUv.y - 0.5) * 2.0;
    float lateralGlow = pow(max(1.0 - axisDistance, 0.0), beamFalloff);
    float startCap = smoothstep(0.0, 0.022, vUv.x);
    float endCap = 1.0 - smoothstep(0.978, 1.0, vUv.x);
    gl_FragColor = vec4(beamColor, beamOpacity * lateralGlow * startCap * endCap);
  }
`

const glassVertexShader = `
  varying vec3 vViewNormal;
  varying vec3 vViewDirection;
  varying vec3 vLocalPosition;

  void main() {
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vViewNormal = normalize(normalMatrix * normal);
    vViewDirection = normalize(-viewPosition.xyz);
    vLocalPosition = position;
    gl_Position = projectionMatrix * viewPosition;
  }
`

const fresnelFragmentShader = `
  varying vec3 vViewNormal;
  varying vec3 vViewDirection;

  void main() {
    float facing = abs(dot(normalize(vViewNormal), normalize(vViewDirection)));
    float fresnel = pow(1.0 - clamp(facing, 0.0, 1.0), 2.2);
    vec3 rimColor = mix(vec3(0.23, 0.66, 1.0), vec3(0.92, 0.98, 1.0), fresnel);
    gl_FragColor = vec4(rimColor, fresnel * 0.62);
  }
`

const reflectionFragmentShader = `
  varying vec3 vViewNormal;
  varying vec3 vViewDirection;
  varying vec3 vLocalPosition;

  void main() {
    float facing = pow(abs(dot(normalize(vViewNormal), normalize(vViewDirection))), 2.5);
    float diagonal = vLocalPosition.x * 0.5 + vLocalPosition.y * 0.82;
    float coolBand = exp(-pow((diagonal + 0.28) * 7.5, 2.0));
    float whiteBand = exp(-pow((diagonal - 0.78) * 12.0, 2.0));
    float reflection = (coolBand * 0.38 + whiteBand * 0.7) * (0.24 + facing * 0.76);
    vec3 reflectionColor = mix(vec3(0.2, 0.68, 1.0), vec3(1.0), whiteBand);
    gl_FragColor = vec4(reflectionColor, reflection * 0.52);
  }
`

function prismShape() {
  const shape = new THREE.Shape()
  shape.moveTo(prismCrossSection[0].x, prismCrossSection[0].y)
  shape.lineTo(prismCrossSection[1].x, prismCrossSection[1].y)
  shape.lineTo(prismCrossSection[2].x, prismCrossSection[2].y)
  shape.closePath()
  return shape
}

export function createPrismGeometry() {
  const geometry = new THREE.ExtrudeGeometry(prismShape(), {
    depth: prismModelConfig.depth,
    steps: 1,
    bevelEnabled: prismModelConfig.bevelEnabled,
    bevelThickness: prismModelConfig.bevelThickness,
    bevelSize: prismModelConfig.bevelSize,
    bevelSegments: prismModelConfig.bevelSegments,
    curveSegments: 1
  })
  geometry.translate(0, 0, -prismModelConfig.depth / 2)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

function createBeamLayer(scene, width, color, opacity, falloff, z, renderOrder) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      beamColor: { value: new THREE.Color(color) },
      beamOpacity: { value: opacity },
      beamFalloff: { value: falloff }
    },
    vertexShader: glowVertexShader,
    fragmentShader: glowFragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    toneMapped: false
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material)
  mesh.position.z = z
  mesh.renderOrder = renderOrder
  mesh.visible = false
  scene.add(mesh)
  return { mesh, width }
}

function createGlowBeam(scene, color, layers, z, renderOrder) {
  return layers.map((layer) => createBeamLayer(
    scene,
    layer.width,
    color,
    layer.opacity,
    layer.falloff,
    z,
    renderOrder
  ))
}

function positionBeam(layers, start, end, visible = true) {
  if (!visible || !start || !end) {
    layers.forEach(({ mesh }) => { mesh.visible = false })
    return
  }

  const deltaX = end.x - start.x
  const deltaY = end.y - start.y
  const beamLength = Math.hypot(deltaX, deltaY)
  if (!Number.isFinite(beamLength) || beamLength < 1e-5) {
    layers.forEach(({ mesh }) => { mesh.visible = false })
    return
  }

  const angle = Math.atan2(deltaY, deltaX)
  layers.forEach((layer) => {
    layer.mesh.visible = true
    layer.mesh.position.x = (start.x + end.x) / 2
    layer.mesh.position.y = (start.y + end.y) / 2
    layer.mesh.rotation.z = angle
    layer.mesh.scale.set(beamLength, layer.width, 1)
  })
}

function worldCrossSection(prismGroup) {
  prismGroup.updateMatrixWorld(true)
  return prismCrossSection.map((vertex) => {
    const world = new THREE.Vector3(vertex.x, vertex.y, 0).applyMatrix4(prismGroup.matrixWorld)
    return { x: world.x, y: world.y }
  })
}

function createLightPath(scene, prismGroup, camera) {
  const incoming = createGlowBeam(scene, 0xffffff, [
    { width: 0.032, opacity: 1, falloff: 0.42 },
    { width: 0.16, opacity: 0.62, falloff: 1.05 },
    { width: 0.56, opacity: 0.22, falloff: 1.75 }
  ], 0.68, 1)

  const internal = spectrum.map((sample) => Array.from(
    { length: 5 },
    () => createGlowBeam(scene, sample.color, [
      { width: 0.024, opacity: 0.56, falloff: 0.55 },
      { width: 0.15, opacity: 0.22, falloff: 1.5 },
      { width: 0.38, opacity: 0.08, falloff: 1.9 }
    ], 0.67, 2)
  ))

  const outgoing = spectrum.map((sample) => createGlowBeam(scene, sample.color, [
    { width: 0.038, opacity: 1, falloff: 0.46 },
    { width: 0.19, opacity: 0.58, falloff: 1.08 },
    { width: 0.66, opacity: 0.24, falloff: 1.65 }
  ], 0.68, 1))

  function update() {
    const vertices = worldCrossSection(prismGroup)
    const incomingStart = {
      x: Math.min(-8.8, camera.left - 1.5),
      y: prismGroup.position.y
    }
    const incomingDirection = { x: 1, y: 0 }
    const farDistance = Math.max(14, (camera.right - camera.left) * 1.8)
    const tracedSpectrum = tracePrismSpectrum({
      vertices,
      origin: incomingStart,
      direction: incomingDirection,
      samples: spectrum,
      farDistance
    })

    const enteringTrace = tracedSpectrum.find(({ trace }) => trace.entry)?.trace
    positionBeam(
      incoming,
      incomingStart,
      enteringTrace?.entry || {
        x: incomingStart.x + farDistance,
        y: incomingStart.y
      }
    )

    tracedSpectrum.forEach(({ trace }, spectrumIndex) => {
      const segmentSlots = internal[spectrumIndex]
      segmentSlots.forEach((beam, segmentIndex) => {
        const segment = trace.internalSegments[segmentIndex]
        positionBeam(beam, segment?.start, segment?.end, Boolean(segment))
      })

      const hasExit = trace.status === 'ok' || trace.status === 'exited-after-reflection'
      positionBeam(outgoing[spectrumIndex], trace.exit, trace.outgoingEnd, hasExit)
    })

    return tracedSpectrum
  }

  return { update }
}

function createGlassEnvironment(renderer) {
  const environmentScene = new THREE.Scene()
  environmentScene.background = new THREE.Color(0x02060d)
  const geometries = new Set()
  const materials = new Set()
  let generator = null
  let environmentTarget = null
  const cards = [
    { color: 0xffffff, size: [0.22, 5.8, 0.12], position: [-3.2, 0.6, 2.4], rotation: [0, 0.38, -0.18] },
    { color: 0x8fdcff, size: [4.8, 0.2, 0.12], position: [1.4, 3.1, -1.8], rotation: [0.16, -0.24, 0.12] },
    { color: 0x4c86ff, size: [0.28, 3.2, 0.12], position: [3.3, -1.2, 1.1], rotation: [-0.1, -0.4, 0.24] },
    { color: 0xff9a78, size: [1.9, 0.16, 0.12], position: [-1.2, -3.2, -2.4], rotation: [-0.2, 0.32, -0.18] }
  ]
  cards.forEach((card) => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...card.size),
      new THREE.MeshBasicMaterial({ color: card.color })
    )
    mesh.position.set(...card.position)
    mesh.rotation.set(...card.rotation)
    environmentScene.add(mesh)
  })
  environmentScene.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry)
    if (object.material) materials.add(object.material)
  })

  try {
    generator = new THREE.PMREMGenerator(renderer)
    environmentTarget = generator.fromScene(environmentScene, 0.035, 0.1, 24)
    return environmentTarget
  } catch (error) {
    try { environmentTarget?.dispose?.() } catch { /* Preserve the construction error. */ }
    throw error
  } finally {
    try { generator?.dispose?.() } catch { /* Continue releasing temporary resources. */ }
    geometries.forEach((geometry) => {
      try { geometry.dispose?.() } catch { /* Best-effort cleanup. */ }
    })
    materials.forEach((material) => {
      try { material.dispose?.() } catch { /* Best-effort cleanup. */ }
    })
  }
}

function createGlassSurfaceLayers(prismGroup, geometry) {
  const fresnelMaterial = new THREE.ShaderMaterial({
    vertexShader: glassVertexShader,
    fragmentShader: fresnelFragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    toneMapped: false
  })
  const fresnelShell = new THREE.Mesh(geometry, fresnelMaterial)
  fresnelShell.renderOrder = 4
  prismGroup.add(fresnelShell)

  const reflectionMaterial = new THREE.ShaderMaterial({
    vertexShader: glassVertexShader,
    fragmentShader: reflectionFragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.FrontSide,
    toneMapped: false
  })
  const reflections = new THREE.Mesh(geometry, reflectionMaterial)
  reflections.renderOrder = 4
  prismGroup.add(reflections)
}

function disposeScene(scene, renderer, disposableTargets = []) {
  const geometries = new Set()
  const materials = new Set()
  try {
    scene?.traverse?.((object) => {
      if (object.geometry) geometries.add(object.geometry)
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material]
      objectMaterials.filter(Boolean).forEach((material) => materials.add(material))
    })
  } catch {
    // Continue releasing the renderer even if a partially built scene cannot be traversed.
  }
  geometries.forEach((geometry) => {
    try { geometry.dispose?.() } catch { /* Best-effort cleanup. */ }
  })
  materials.forEach((material) => {
    try { material.dispose?.() } catch { /* Best-effort cleanup. */ }
  })
  disposableTargets.forEach((target) => {
    try { target?.dispose?.() } catch { /* Best-effort cleanup. */ }
  })
  try { renderer?.renderLists?.dispose() } catch { /* Best-effort cleanup. */ }
  try { renderer?.dispose?.() } catch { /* Best-effort cleanup. */ }
  try { renderer?.forceContextLoss?.() } catch { /* Best-effort cleanup. */ }
}

export function createPrismScene(canvas, stage, options = {}) {
  let renderer = null
  let scene = null
  let environmentTarget = null
  let rollback = () => disposeScene(scene, renderer, environmentTarget ? [environmentTarget] : [])

  try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance'
  })
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.24

  scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-8, 8, 4, -4, 0.1, 30)
  camera.position.set(1.35, 0.72, 9)
  camera.lookAt(0, 0, 0)

  environmentTarget = createGlassEnvironment(renderer)
  const geometry = createPrismGeometry()
  const prismGroup = new THREE.Group()
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xd9f1ff,
    metalness: 0,
    roughness: 0.028,
    transmission: 1,
    thickness: prismModelConfig.depth + prismModelConfig.bevelThickness * 2,
    ior: bk7RefractiveIndex(587.6),
    dispersion: 0.055,
    attenuationColor: new THREE.Color(0x72bde9),
    attenuationDistance: 3.2,
    clearcoat: 1,
    clearcoatRoughness: 0.018,
    specularIntensity: 1,
    specularColor: new THREE.Color(0xffffff),
    envMap: environmentTarget.texture,
    envMapIntensity: 2.1,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    side: THREE.DoubleSide
  })
  const prism = new THREE.Mesh(geometry, glassMaterial)
  prism.renderOrder = 3
  prismGroup.add(prism)
  createGlassSurfaceLayers(prismGroup, geometry)

  const edgeGeometry = new THREE.EdgesGeometry(geometry, 16)
  const edgeMaterial = new THREE.LineBasicMaterial({
    color: 0xf5fbff,
    transparent: true,
    opacity: 0.86,
    depthWrite: false
  })
  const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial)
  edges.renderOrder = 4
  prismGroup.add(edges)

  const edgeGlowMaterial = new THREE.LineBasicMaterial({
    color: 0x8ed8ff,
    transparent: true,
    opacity: 0.23,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  })
  const edgeGlow = new THREE.LineSegments(edgeGeometry, edgeGlowMaterial)
  edgeGlow.renderOrder = 4
  prismGroup.add(edgeGlow)

  prismGroup.position.y = -0.02
  prismGroup.rotation.z = -0.023
  scene.add(prismGroup)

  const lightPath = createLightPath(scene, prismGroup, camera)
  scene.add(new THREE.HemisphereLight(0xd9efff, 0x07111f, 2.1))
  const key = new THREE.DirectionalLight(0xffffff, 6.2)
  key.position.set(-3, 5, 8)
  scene.add(key)
  const rim = new THREE.PointLight(0x75c8ff, 24, 16)
  rim.position.set(3.8, -1.1, 4.5)
  scene.add(rim)
  const warmRim = new THREE.PointLight(0xff8a66, 9, 12)
  warmRim.position.set(-3.5, 2.2, 3.2)
  scene.add(warmRim)

  let width = 0
  let height = 0
  let dragging = false
  let lastX = 0
  let lastY = 0
  let userRotation = -0.023
  let animationFrame = 0
  let previousFrame = performance.now()
  let elapsed = 0
  let disposed = false
  let failed = false
  let initialized = false
  let paused = false
  let resizeObserver = null
  let motionListenerMode = ''
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const lowPowerDevice = Number(navigator.hardwareConcurrency || 4) <= 2

  function usesStaticMotion() {
    return reduceMotion.matches || lowPowerDevice
  }

  function resize() {
    const rect = stage.getBoundingClientRect()
    const nextWidth = Math.max(1, Math.round(rect.width))
    const nextHeight = Math.max(1, Math.round(rect.height))
    if (nextWidth === width && nextHeight === height) return false
    width = nextWidth
    height = nextHeight
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(width, height, false)
    const aspect = width / height
    const viewHeight = aspect < 1.35 ? 8.4 : 7.2
    camera.top = viewHeight / 2
    camera.bottom = -viewHeight / 2
    camera.left = -viewHeight * aspect / 2
    camera.right = viewHeight * aspect / 2
    camera.updateProjectionMatrix()
    return true
  }

  function render() {
    resize()
    lightPath.update()
    renderer.render(scene, camera)
  }

  function failScene(error) {
    if (!initialized) throw error
    if (disposed || failed) return
    failed = true
    dispose()
    try { stage.classList.add('webgl-unavailable') } catch { /* The page may already be detached. */ }
    try { options.onFatal?.(error) } catch { /* A fallback callback must not revive the render loop. */ }
  }

  function renderStatic() {
    prismGroup.rotation.z = userRotation
    render()
  }

  function renderStaticSafely() {
    if (disposed || failed || paused || document.hidden) return false
    try {
      renderStatic()
      return true
    } catch (error) {
      failScene(error)
      return false
    }
  }

  function pointerDown(event) {
    if (disposed || failed || paused) return
    dragging = true
    lastX = event.clientX
    lastY = event.clientY
    try { canvas.setPointerCapture?.(event.pointerId) } catch { /* Pointer capture is optional. */ }
  }

  function pointerMove(event) {
    if (!dragging || disposed || failed || paused) return
    const horizontalDelta = event.clientX - lastX
    const verticalDelta = event.clientY - lastY
    userRotation = THREE.MathUtils.clamp(
      userRotation + horizontalDelta * 0.005 + verticalDelta * 0.0015,
      -0.48,
      0.48
    )
    lastX = event.clientX
    lastY = event.clientY
    if (usesStaticMotion()) renderStaticSafely()
  }

  function pointerUp(event) {
    dragging = false
    try {
      if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture?.(event.pointerId)
    } catch { /* Pointer capture may already have been released by the browser. */ }
  }

  function frame(now) {
    animationFrame = 0
    if (disposed || failed || paused || usesStaticMotion() || document.hidden) return
    try {
      const delta = Math.min((now - previousFrame) / 1000, 0.05)
      previousFrame = now
      elapsed += delta
      const idleRotation = dragging ? 0 : Math.sin(elapsed * 0.42) * 0.003
      prismGroup.rotation.z = THREE.MathUtils.damp(
        prismGroup.rotation.z,
        userRotation + idleRotation,
        8,
        delta
      )
      render()
      animationFrame = requestAnimationFrame(frame)
    } catch (error) {
      failScene(error)
    }
  }

  function startAnimation() {
    if (disposed || failed || paused || usesStaticMotion() || animationFrame || document.hidden) return
    previousFrame = performance.now()
    try {
      animationFrame = requestAnimationFrame(frame)
    } catch (error) {
      failScene(error)
    }
  }

  function stopAnimation() {
    try {
      if (animationFrame) cancelAnimationFrame(animationFrame)
    } catch { /* The browsing context may already be shutting down. */ }
    animationFrame = 0
  }

  function handleMotionPreference() {
    if (disposed || failed || paused) return
    if (document.hidden) {
      stopAnimation()
      return
    }
    if (usesStaticMotion()) {
      stopAnimation()
      renderStaticSafely()
      return
    }
    startAnimation()
  }

  function handleResize() {
    if (!disposed && !failed && !paused && !document.hidden && usesStaticMotion()) renderStaticSafely()
  }

  function handleVisibility() {
    if (disposed || failed || paused) return
    if (document.hidden) {
      stopAnimation()
      return
    }
    if (usesStaticMotion()) renderStaticSafely()
    else startAnimation()
  }

  function handleContextLost() {
    if (disposed || failed) return
    failScene(new Error('WebGL context lost'))
  }

  function attachMotionPreferenceListener() {
    if (typeof reduceMotion.addEventListener === 'function') {
      reduceMotion.addEventListener('change', handleMotionPreference)
      motionListenerMode = 'event'
      return
    }
    if (typeof reduceMotion.addListener === 'function') {
      reduceMotion.addListener(handleMotionPreference)
      motionListenerMode = 'legacy'
    }
  }

  function detachMotionPreferenceListener() {
    try {
      if (motionListenerMode === 'event') reduceMotion.removeEventListener('change', handleMotionPreference)
      if (motionListenerMode === 'legacy') reduceMotion.removeListener(handleMotionPreference)
    } catch { /* Continue releasing GPU resources. */ }
    motionListenerMode = ''
  }

  function pause() {
    if (disposed || failed) return false
    paused = true
    dragging = false
    stopAnimation()
    return true
  }

  function resume() {
    if (disposed || failed) return false
    paused = false
    if (document.hidden) return true
    if (usesStaticMotion()) return renderStaticSafely()
    startAnimation()
    return !failed
  }

  function dispose() {
    if (disposed) return
    disposed = true
    paused = true
    dragging = false
    stopAnimation()
    try { canvas.removeEventListener('pointerdown', pointerDown) } catch { /* Best-effort cleanup. */ }
    try { canvas.removeEventListener('pointermove', pointerMove) } catch { /* Best-effort cleanup. */ }
    try { canvas.removeEventListener('pointerup', pointerUp) } catch { /* Best-effort cleanup. */ }
    try { canvas.removeEventListener('pointercancel', pointerUp) } catch { /* Best-effort cleanup. */ }
    try { canvas.removeEventListener('webglcontextlost', handleContextLost) } catch { /* Best-effort cleanup. */ }
    try { document.removeEventListener('visibilitychange', handleVisibility) } catch { /* Best-effort cleanup. */ }
    detachMotionPreferenceListener()
    try { resizeObserver?.disconnect() } catch { /* Best-effort cleanup. */ }
    if (!resizeObserver) {
      try { window.removeEventListener('resize', handleResize) } catch { /* Best-effort cleanup. */ }
    }
    disposeScene(scene, renderer, environmentTarget ? [environmentTarget] : [])
  }

  rollback = dispose
  canvas.addEventListener('pointerdown', pointerDown)
  canvas.addEventListener('pointermove', pointerMove)
  canvas.addEventListener('pointerup', pointerUp)
  canvas.addEventListener('pointercancel', pointerUp)
  canvas.addEventListener('webglcontextlost', handleContextLost)
  document.addEventListener('visibilitychange', handleVisibility)
  attachMotionPreferenceListener()
  resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(handleResize) : null
  resizeObserver?.observe(stage)
  if (!resizeObserver) window.addEventListener('resize', handleResize)

  if (usesStaticMotion()) renderStatic()
  else startAnimation()
  initialized = true

  return { dispose, pause, resume }
  } catch (error) {
    rollback()
    throw error
  }
}

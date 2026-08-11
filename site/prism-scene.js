import * as THREE from './vendor/three.module.min.js'

const spectrum = [0xff3155, 0xff8a2a, 0xffe95d, 0x57ed86, 0x50b8ff, 0x7868ff]

function prismGeometry() {
  const positions = new Float32Array([
    -1.8, -1.25, -0.55,
    1.8, -1.25, -0.55,
    0, 1.82, -0.55,
    -1.8, -1.25, 0.55,
    1.8, -1.25, 0.55,
    0, 1.82, 0.55
  ])
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex([
    0, 2, 1,
    3, 4, 5,
    0, 1, 4, 0, 4, 3,
    1, 2, 5, 1, 5, 4,
    2, 0, 3, 2, 3, 5
  ])
  geometry.computeVertexNormals()
  return geometry
}

function beam(start, end, width, color, opacity) {
  const delta = end.clone().sub(start)
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(delta.length(), width), material)
  mesh.position.copy(start).add(end).multiplyScalar(0.5)
  mesh.position.z = -0.9
  mesh.rotation.z = Math.atan2(delta.y, delta.x)
  mesh.renderOrder = 1
  return mesh
}

function addLightPath(scene) {
  scene.add(beam(new THREE.Vector3(-8.5, -0.06, 0), new THREE.Vector3(-0.48, -0.06, 0), 0.032, 0xffffff, 0.94))
  scene.add(beam(new THREE.Vector3(-8.5, -0.06, 0), new THREE.Vector3(-0.48, -0.06, 0), 0.15, 0xd8e8ff, 0.11))
  scene.add(beam(new THREE.Vector3(-0.52, -0.06, 0), new THREE.Vector3(0.4, -0.05, 0), 0.044, 0xffffff, 0.52))

  const origin = new THREE.Vector3(0.36, -0.05, 0)
  spectrum.forEach((color, index) => {
    const offset = index - (spectrum.length - 1) / 2
    const target = new THREE.Vector3(8.6, offset * -0.125, 0)
    scene.add(beam(origin, target, 0.058, color, 0.9))
    scene.add(beam(origin, target, 0.2, color, 0.075))
  })
}

export function createPrismScene(canvas, stage) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' })
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.15

  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-8, 8, 4, -4, 0.1, 30)
  camera.position.set(0, 0, 9)

  addLightPath(scene)

  const geometry = prismGeometry()
  const group = new THREE.Group()
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xe8f5ff,
    metalness: 0,
    roughness: 0.055,
    transmission: 1,
    thickness: 1.65,
    ior: 1.52,
    attenuationColor: new THREE.Color(0x8dbce5),
    attenuationDistance: 5.2,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    transparent: true,
    opacity: 0.36,
    depthWrite: false,
    side: THREE.DoubleSide
  })
  const prism = new THREE.Mesh(geometry, material)
  prism.renderOrder = 3
  group.add(prism)

  const edgeMaterial = new THREE.LineBasicMaterial({ color: 0xeef8ff, transparent: true, opacity: 0.78 })
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 18), edgeMaterial)
  edges.renderOrder = 4
  group.add(edges)
  group.position.y = -0.02
  scene.add(group)

  scene.add(new THREE.AmbientLight(0x9fc9ff, 1.3))
  const key = new THREE.DirectionalLight(0xffffff, 5.2)
  key.position.set(-3, 5, 7)
  scene.add(key)
  const rim = new THREE.PointLight(0x6db8ff, 16, 14)
  rim.position.set(3.6, -1.2, 4)
  scene.add(rim)

  let width = 0
  let height = 0
  let dragging = false
  let lastX = 0
  let lastY = 0
  let targetX = -0.035
  let targetY = 0
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

  function resize() {
    const rect = stage.getBoundingClientRect()
    const nextWidth = Math.max(1, Math.round(rect.width))
    const nextHeight = Math.max(1, Math.round(rect.height))
    if (nextWidth === width && nextHeight === height) return
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
  }

  function pointerDown(event) {
    dragging = true
    lastX = event.clientX
    lastY = event.clientY
    canvas.setPointerCapture(event.pointerId)
  }

  function pointerMove(event) {
    if (!dragging) return
    targetY += (event.clientX - lastX) * 0.006
    targetX = THREE.MathUtils.clamp(targetX + (event.clientY - lastY) * 0.004, -0.38, 0.38)
    lastX = event.clientX
    lastY = event.clientY
  }

  function pointerUp(event) {
    dragging = false
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
  }

  canvas.addEventListener('pointerdown', pointerDown)
  canvas.addEventListener('pointermove', pointerMove)
  canvas.addEventListener('pointerup', pointerUp)
  canvas.addEventListener('pointercancel', pointerUp)

  let previousFrame = performance.now()
  let elapsed = 0
  function frame(now) {
    resize()
    const delta = Math.min((now - previousFrame) / 1000, 0.05)
    previousFrame = now
    elapsed += delta
    if (!dragging && !reduceMotion.matches) targetY += delta * 0.085
    group.rotation.x += (targetX - group.rotation.x) * 0.075
    group.rotation.y += (targetY - group.rotation.y) * 0.075
    group.rotation.z = Math.sin(elapsed * 0.38) * 0.012
    renderer.render(scene, camera)
    requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

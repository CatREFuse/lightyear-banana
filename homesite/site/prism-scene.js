import { clock, effect, frame, frameLoop, init, surface } from 'vgpu'

export const defaultPrismParams = Object.freeze({
  dispersionOffsetScale: 2.5,
  baseGlassIor: 1.3,
  rotationSpeed: 0.55,
  incidentAngle: 8
})

export const prismModelConfig = Object.freeze({
  renderer: 'vgpu',
  shape: 'hollow-triangular-prism',
  opticalBoundary: 'wgsl-sdf-refraction',
  spectrumBands: 9
})

const shaderUrl = new URL('./prism.wgsl', import.meta.url)
shaderUrl.searchParams.set('v', '20260901-ltr')

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

export function normalizePrismParams(input = {}) {
  return {
    dispersionOffsetScale: clamp(Number(input.dispersionOffsetScale ?? defaultPrismParams.dispersionOffsetScale), 0, 5),
    baseGlassIor: clamp(Number(input.baseGlassIor ?? defaultPrismParams.baseGlassIor), 1.3, 1.8),
    rotationSpeed: clamp(Number(input.rotationSpeed ?? defaultPrismParams.rotationSpeed), 0.1, 2.5),
    incidentAngle: clamp(Number(input.incidentAngle ?? defaultPrismParams.incidentAngle), -10, 10)
  }
}

export function isPrismPointer(x, y) {
  const localX = x / 0.58
  const localY = (y + 0.02) / 0.72
  return localY >= -0.72 && localY <= 0.88 && Math.abs(localX) <= (0.88 - localY) * 0.62
}

async function loadShader(fetchShader = globalThis.fetch) {
  if (typeof fetchShader !== 'function') throw new Error('Fetch is required to load the prism shader.')
  const response = await fetchShader(shaderUrl)
  if (!response.ok) throw new Error(`Prism shader request failed with ${response.status}.`)
  return response.text()
}

export async function createPrismScene(canvas, stage, options = {}) {
  const params = normalizePrismParams(options.initialParams)
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  const shader = await loadShader(options.fetchShader)
  const gpu = await init()
  let canvasSurface
  let prism
  try {
    canvasSurface = surface(gpu, canvas, {
      alphaMode: 'premultiplied',
      clearColor: [0.012, 0.012, 0.014, 1],
      dpr: [1, 1.65],
      label: 'mugen-prism-surface'
    })
    prism = effect(gpu, shader, {
      label: 'mugen-prism-optics',
      set: {
        params: {
          resolution: canvasSurface.size,
          pointer: [0, 0],
          time: 0,
          rotationSpeed: params.rotationSpeed,
          dispersion: params.dispersionOffsetScale,
          baseIor: params.baseGlassIor,
          incidentAngle: params.incidentAngle,
          motion: reduceMotion.matches ? 0 : 1
        }
      }
    })
  } catch (error) {
    canvasSurface?.dispose()
    gpu.dispose()
    throw error
  }
  const sceneClock = clock(gpu)
  const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 }
  const press = { active: false, pointerId: -1, startX: 0, startY: 0, travel: 0 }
  let animation = null
  let resizeFrame = null
  let disposed = false
  let paused = false
  let failed = false

  const removeGpuErrorListener = gpu.onError((error) => fail(error))
  const removeResizeListener = canvasSurface.onResize(({ width, height }) => {
    prism.set({ params: { resolution: [width, height] } })
  })

  function updateDynamicUniforms() {
    const easing = reduceMotion.matches ? 1 : 0.075
    pointer.x += (pointer.targetX - pointer.x) * easing
    pointer.y += (pointer.targetY - pointer.y) * easing
    prism.set({
      params: {
        pointer: [pointer.x, pointer.y],
        time: reduceMotion.matches ? 0 : sceneClock.time
      }
    })
  }

  function drawStatic() {
    if (disposed || failed) return
    updateDynamicUniforms()
    frame(gpu, (currentFrame) => currentFrame.pass({
      target: canvasSurface,
      clear: [0.012, 0.012, 0.014, 1]
    }, prism))
  }

  function startAnimation() {
    animation?.stop()
    animation = null
    if (disposed || failed || paused || document.hidden) return
    if (reduceMotion.matches) {
      drawStatic()
      return
    }
    animation = frameLoop(gpu, (currentFrame) => {
      updateDynamicUniforms()
      currentFrame.pass({ target: canvasSurface, clear: [0.012, 0.012, 0.014, 1] }, prism)
    })
  }

  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1,
      y: 1 - ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2
    }
  }

  function handlePointerDown(event) {
    const position = pointerPosition(event)
    press.active = true
    press.pointerId = event.pointerId
    press.startX = event.clientX
    press.startY = event.clientY
    press.travel = 0
    pointer.targetX = position.x
    pointer.targetY = position.y
    canvas.setPointerCapture?.(event.pointerId)
  }

  function handlePointerMove(event) {
    const position = pointerPosition(event)
    pointer.targetX = position.x
    pointer.targetY = position.y
    if (!press.active || event.pointerId !== press.pointerId) return
    press.travel = Math.hypot(event.clientX - press.startX, event.clientY - press.startY)
  }

  function handlePointerEnd(event) {
    if (event.pointerId !== press.pointerId) return
    const position = pointerPosition(event)
    const activate = event.type !== 'pointercancel' && press.travel <= 7 && isPrismPointer(position.x, position.y)
    press.active = false
    press.pointerId = -1
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture?.(event.pointerId)
    if (activate) options.onPrismClick?.()
  }

  function handlePointerLeave() {
    if (press.active) return
    pointer.targetX = 0
    pointer.targetY = 0
  }

  function handleVisibility() {
    startAnimation()
  }

  function handleResize() {
    if (!reduceMotion.matches || paused || document.hidden) return
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = null
      if (!paused && !document.hidden) drawStatic()
    })
  }

  function handleMotionPreference() {
    prism.set({ params: { motion: reduceMotion.matches ? 0 : 1 } })
    startAnimation()
  }

  function fail(error) {
    if (disposed || failed) return
    failed = true
    dispose()
    options.onFatal?.(error)
  }

  function setParams(nextParams) {
    Object.assign(params, normalizePrismParams({ ...params, ...nextParams }))
    prism.set({
      params: {
        rotationSpeed: params.rotationSpeed,
        dispersion: params.dispersionOffsetScale,
        baseIor: params.baseGlassIor,
        incidentAngle: params.incidentAngle
      }
    })
    if (reduceMotion.matches && !paused) drawStatic()
    return { ...params }
  }

  function pause() {
    if (disposed || failed) return false
    paused = true
    animation?.stop()
    animation = null
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
    resizeFrame = null
    return true
  }

  function resume() {
    if (disposed || failed) return false
    paused = false
    startAnimation()
    return true
  }

  function dispose() {
    if (disposed) return
    disposed = true
    animation?.stop()
    animation = null
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
    resizeFrame = null
    canvas.removeEventListener('pointerdown', handlePointerDown)
    canvas.removeEventListener('pointermove', handlePointerMove)
    canvas.removeEventListener('pointerup', handlePointerEnd)
    canvas.removeEventListener('pointercancel', handlePointerEnd)
    canvas.removeEventListener('pointerleave', handlePointerLeave)
    document.removeEventListener('visibilitychange', handleVisibility)
    window.removeEventListener('resize', handleResize)
    reduceMotion.removeEventListener?.('change', handleMotionPreference)
    removeResizeListener()
    removeGpuErrorListener()
    canvasSurface.dispose()
    gpu.dispose()
  }

  canvas.addEventListener('pointerdown', handlePointerDown)
  canvas.addEventListener('pointermove', handlePointerMove)
  canvas.addEventListener('pointerup', handlePointerEnd)
  canvas.addEventListener('pointercancel', handlePointerEnd)
  canvas.addEventListener('pointerleave', handlePointerLeave)
  document.addEventListener('visibilitychange', handleVisibility)
  window.addEventListener('resize', handleResize)
  reduceMotion.addEventListener?.('change', handleMotionPreference)
  startAnimation()

  return { dispose, pause, resume, setParams }
}

const releaseUrl = './releases/latest.json'

export function installWordmarkFallback(image, brand) {
  if (!image?.addEventListener || !brand?.classList) return () => {}

  const showFallback = () => brand.classList.add('wordmark-unavailable')
  image.addEventListener('error', showFallback, { once: true })
  if (image.complete && image.naturalWidth === 0) showFallback()

  return () => image.removeEventListener?.('error', showFallback)
}

export function resolveCcxReleaseUpdate(release, baseHref) {
  const ccx = release?.downloads?.ccx
  const filenameMatch = /^mugen-(\d+\.\d+\.\d+)\.ccx$/.exec(ccx?.filename || '')
  const version = typeof release?.ccxVersion === 'string'
    ? release.ccxVersion.trim()
    : filenameMatch?.[1]

  if (!/^\d+\.\d+\.\d+$/.test(version || '') || filenameMatch?.[1] !== version) return null
  if (typeof ccx?.url !== 'string' || !ccx.url.trim() || ccx.url.includes('__MUGEN_RELEASE_ORIGIN__')) return null

  let baseUrl
  let url
  try {
    baseUrl = new URL(baseHref)
    url = new URL(ccx.url, baseHref)
    if (decodeURIComponent(url.pathname.split('/').pop() || '') !== ccx.filename) return null
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.origin !== baseUrl.origin) return null

  return { href: url.href, version }
}

function updateRelease(release) {
  const download = document.querySelector('[data-download="ccx"]')
  const version = document.querySelector('[data-ccx-version]')
  const update = resolveCcxReleaseUpdate(release, window.location.href)
  if (!update || !(download instanceof HTMLAnchorElement) || !version) return

  download.href = update.href
  version.textContent = update.version
}

async function loadRelease() {
  try {
    const response = await fetch(releaseUrl, { cache: 'no-store' })
    if (!response.ok) return
    updateRelease(await response.json())
  } catch {
    // Keep the static CCX fallback available when release metadata cannot be loaded.
  }
}

export function createPrismLifecycle({ stage, loadScene }) {
  let scene = null
  let initialization = null
  let generation = 0
  let suspended = false
  let terminal = false
  let unavailable = false

  function showFallback() {
    stage.classList.add('webgl-unavailable')
  }

  function hideFallback() {
    stage.classList.remove('webgl-unavailable')
  }

  function handleSceneFatal(token) {
    if (token !== generation || terminal) return
    unavailable = true
    scene = null
    showFallback()
  }

  async function initialize() {
    if (terminal || unavailable || scene) return scene
    if (initialization) return initialization

    const token = ++generation
    const task = (async () => {
      try {
        const candidate = await loadScene((error) => handleSceneFatal(token, error))
        if (terminal || unavailable || token !== generation) {
          candidate?.dispose?.()
          return null
        }
        scene = candidate
        if (suspended) scene?.pause?.()
        hideFallback()
        return scene
      } catch {
        if (!terminal && token === generation) {
          unavailable = true
          showFallback()
        }
        return null
      }
    })()
    initialization = task
    try {
      return await task
    } finally {
      if (initialization === task) initialization = null
    }
  }

  function handlePageHide(event) {
    suspended = true
    if (event?.persisted) {
      scene?.pause?.()
      return
    }

    terminal = true
    generation += 1
    scene?.dispose?.()
    scene = null
  }

  function handlePageShow(event) {
    if (!event?.persisted || terminal) return
    suspended = false
    if (unavailable) return
    if (scene) {
      scene.resume?.()
      return
    }
    void initialize()
  }

  function dispose() {
    if (terminal) return
    terminal = true
    generation += 1
    scene?.dispose?.()
    scene = null
  }

  return { dispose, handlePageHide, handlePageShow, initialize }
}

export function createConsecutiveActivation({ required = 5, maxGapMs = 800, onActivate, now = () => performance.now() }) {
  let count = 0
  let previous = -Infinity

  function reset() {
    count = 0
    previous = -Infinity
  }

  function trigger() {
    const current = now()
    count = current - previous <= maxGapMs ? count + 1 : 1
    previous = current
    if (count < required) return false
    reset()
    onActivate?.()
    return true
  }

  return { reset, trigger }
}

export function installPrismPanel(panel, closeButton, onChange) {
  if (!panel?.querySelectorAll) return null

  const inputs = Array.from(panel.querySelectorAll('[data-prism-param]'))
  const outputs = new Map(Array.from(panel.querySelectorAll('[data-prism-output]')).map((output) => [
    output.getAttribute('data-prism-output'),
    output
  ]))
  const params = {}

  function format(name, value) {
    if (name === 'baseGlassIor') return value.toFixed(3)
    if (name === 'incidentAngle') return `${value.toFixed(1)}°`
    return `${value.toFixed(2)}x`
  }

  function update(input) {
    const name = input.getAttribute('data-prism-param')
    const value = Number(input.value)
    if (!name || !Number.isFinite(value)) return
    params[name] = value
    const output = outputs.get(name)
    if (output) output.textContent = format(name, value)
    onChange?.({ ...params })
  }

  inputs.forEach((input) => {
    update(input)
    input.addEventListener('input', () => update(input))
  })

  function show() {
    panel.hidden = false
    panel.setAttribute('aria-hidden', 'false')
    inputs[0]?.focus?.()
  }

  function hide() {
    panel.hidden = true
    panel.setAttribute('aria-hidden', 'true')
  }

  closeButton?.addEventListener?.('click', hide)
  document.addEventListener('pointerdown', (event) => {
    if (!panel.hidden && !panel.contains(event.target)) hide()
  })

  return { hide, params: { ...params }, show }
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  const wordmark = document.querySelector('[data-wordmark]')
  const brand = document.querySelector('[data-wordmark-brand]')
  const canvas = document.querySelector('[data-prism-canvas]')
  const stage = document.querySelector('[data-optical-stage]')
  const panel = document.querySelector('[data-prism-panel]')
  const panelClose = document.querySelector('[data-prism-panel-close]')
  let prismScene = null
  const panelController = installPrismPanel(panel, panelClose, (params) => prismScene?.setParams?.(params))
  const panelUnlock = createConsecutiveActivation({ onActivate: () => panelController?.show() })

  installWordmarkFallback(wordmark, brand)

  if (canvas instanceof HTMLCanvasElement && stage instanceof HTMLElement) {
    const lifecycle = createPrismLifecycle({
      stage,
      loadScene: async (onFatal) => {
        const { createPrismScene } = await import('./prism-scene.js')
        prismScene = createPrismScene(canvas, stage, {
          initialParams: panelController?.params,
          onFatal,
          onPrismClick: panelUnlock.trigger
        })
        return prismScene
      }
    })
    window.addEventListener('pagehide', lifecycle.handlePageHide)
    window.addEventListener('pageshow', lifecycle.handlePageShow)
    void lifecycle.initialize()
  }

  void loadRelease()
}

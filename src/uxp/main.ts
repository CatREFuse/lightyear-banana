import { canvasPrimitiveService, type CanvasInsertTarget } from './canvasPrimitiveService'
import type { CapturedCanvasImage } from './canvasPrimitives'
import { createNamedLayer, readActiveDocumentLabel } from './photoshopHost'

type UxpRequire = (name: string) => any

type BridgeMessage<T = unknown> = {
  id: string
  type: string
  payload?: T
}

type SerializedCanvasImage = Omit<CapturedCanvasImage, 'rgba'> & {
  rgba: number[] | Record<string, number>
}

const LOG_PREFIX = '[Lightyear Banana UXP Bridge]'
const BRIDGE_ORIGIN = 'http://127.0.0.1:38321'
const BRIDGE_TOKEN = 'lightyear-dev-token'

const uxpGlobal = globalThis as typeof globalThis & {
  require?: UxpRequire
}

let reconnectTimer: ReturnType<typeof setTimeout> | undefined
let polling = false
let pollLoopId = 0
let currentTone: 'ready' | 'waiting' | 'error' = 'waiting'
let currentStatus = '正在启动'
let panelMountNode: HTMLElement | null = null
const PANEL_STYLE_ID = 'lightyear-banana-uxp-panel-style'
const PANEL_ROOT_ID = 'lightyear-banana-uxp-panel-root'

function getUxpRequire(): UxpRequire {
  if (typeof uxpGlobal.require !== 'function') {
    throw new Error('UXP runtime is unavailable.')
  }

  return uxpGlobal.require
}

function readToneLabel() {
  if (currentTone === 'ready') {
    return '桌面 App 已连接'
  }

  if (currentTone === 'error') {
    return '连接失败'
  }

  return '等待桌面 App'
}

function isMountElement(value: unknown): value is HTMLElement {
  const candidate = value as HTMLElement | undefined
  return Boolean(
    candidate &&
      typeof candidate.appendChild === 'function' &&
      typeof candidate.removeChild === 'function' &&
      typeof candidate.querySelector === 'function' &&
      candidate.style
  )
}

function resolvePanelMount(rootNode?: unknown) {
  if (isMountElement(rootNode)) {
    const rootAppNode = rootNode.querySelector('#app') as HTMLElement | null
    panelMountNode = rootAppNode ?? rootNode
    return panelMountNode
  }

  const appNode = document.getElementById('app')
  panelMountNode = appNode ?? document.body
  return panelMountNode
}

function ensurePanelStyles() {
  if (document.getElementById(PANEL_STYLE_ID)) {
    return
  }

  const style = document.createElement('style')
  style.id = PANEL_STYLE_ID
  style.textContent = `
    html,
    body,
    #app {
      width: 100%;
      min-width: 100%;
      height: 100%;
      min-height: 100%;
      margin: 0;
      padding: 0;
      overflow: hidden;
      background: var(--uxp-host-background-color, #11161f);
      color: var(--uxp-host-text-color, #f5f7fb);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      box-sizing: border-box;
    }

    #${PANEL_ROOT_ID} {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      min-width: 260px;
      min-height: 220px;
      overflow: auto;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0) 92px),
        var(--uxp-host-background-color, #11161f);
      box-sizing: border-box;
    }

    #${PANEL_ROOT_ID} * {
      box-sizing: border-box;
    }

    .lb-uxp-shell {
      display: flex;
      flex-direction: column;
      gap: 10px;
      width: 100%;
      min-height: 100%;
      padding: 14px;
    }

    .lb-uxp-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      min-width: 0;
    }

    .lb-uxp-title {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .lb-uxp-status {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .lb-uxp-status-line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-width: 0;
    }

    .lb-uxp-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      flex: 0 0 auto;
    }

    .lb-uxp-dot-ready {
      background: #2d9d54;
      box-shadow: 0 0 0 2px rgba(45, 157, 84, 0.18), 0 0 12px rgba(45, 157, 84, 0.72);
    }

    .lb-uxp-dot-waiting {
      background: #8f99a8;
      box-shadow: 0 0 0 2px rgba(143, 153, 168, 0.14);
    }

    .lb-uxp-dot-error {
      background: #d7373f;
      box-shadow: 0 0 0 2px rgba(215, 55, 63, 0.18);
    }

    .lb-uxp-panel {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
    }

    .lb-uxp-card {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px;
      border: 1px solid rgba(180, 190, 205, 0.16);
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.055);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.055);
      overflow: hidden;
    }

    .lb-uxp-card-ready {
      border-color: rgba(45, 157, 84, 0.34);
      background: linear-gradient(180deg, rgba(45, 157, 84, 0.12), rgba(255, 255, 255, 0.045));
    }

    .lb-uxp-card-error {
      border-color: rgba(215, 55, 63, 0.32);
      background: linear-gradient(180deg, rgba(215, 55, 63, 0.12), rgba(255, 255, 255, 0.045));
    }

    .lb-uxp-card-waiting {
      border-color: rgba(143, 153, 168, 0.24);
    }

    .lb-uxp-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 2px;
    }

    .lb-uxp-chip {
      display: inline-flex;
      align-items: center;
      min-width: 0;
      max-width: 100%;
      min-height: 20px;
      padding: 1px 7px;
      border-radius: 5px;
      background: rgba(255, 255, 255, 0.075);
      color: var(--uxp-host-text-color, #f5f7fb);
      border: 1px solid rgba(180, 190, 205, 0.13);
    }

    .lb-uxp-chip sp-detail {
      line-height: 16px;
      white-space: nowrap;
    }

    .lb-uxp-footer {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: auto;
    }
  `
  document.head.appendChild(style)
}

function ensurePanelRoot(mountNode: HTMLElement) {
  ensurePanelStyles()

  let panelRoot = document.getElementById(PANEL_ROOT_ID) as HTMLElement | null
  if (!panelRoot) {
    while (mountNode.firstChild) {
      mountNode.removeChild(mountNode.firstChild)
    }

    panelRoot = document.createElement('div')
    panelRoot.id = PANEL_ROOT_ID
    mountNode.appendChild(panelRoot)
  }

  return panelRoot
}

function createSpectrumElement(tagName: string, text?: string, attributes: Record<string, string> = {}) {
  const element = document.createElement(tagName)
  if (text) {
    element.textContent = text
  }

  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value)
  }

  return element
}

function renderPanel() {
  const mountNode = panelMountNode ?? resolvePanelMount()
  if (!mountNode) {
    return
  }

  const panelRoot = ensurePanelRoot(mountNode)
  while (panelRoot.firstChild) {
    panelRoot.removeChild(panelRoot.firstChild)
  }

  const shell = document.createElement('div')
  shell.className = 'lb-uxp-shell'

  const header = document.createElement('div')
  header.className = 'lb-uxp-header'

  const titleBlock = document.createElement('div')
  titleBlock.className = 'lb-uxp-title'

  const title = createSpectrumElement('sp-heading', 'Lightyear Banana', { size: 'XS' })
  const subtitle = createSpectrumElement('sp-detail', 'Photoshop 中转面板', { size: 'S' })
  titleBlock.append(title, subtitle)

  const reconnectTop = createSpectrumElement('sp-action-button', '重连', { quiet: 'true' })
  reconnectTop.setAttribute('title', '重新连接桌面 App')
  reconnectTop.addEventListener('click', () => {
    connectBridge(true)
  })

  header.append(titleBlock, reconnectTop)

  const statusRow = document.createElement('div')
  statusRow.className =
    currentTone === 'ready'
      ? 'lb-uxp-card lb-uxp-card-ready'
      : currentTone === 'error'
        ? 'lb-uxp-card lb-uxp-card-error'
        : 'lb-uxp-card lb-uxp-card-waiting'

  const statusLine = document.createElement('div')
  statusLine.className = 'lb-uxp-status-line'

  const badge = document.createElement('div')
  badge.className = 'lb-uxp-status'

  const dotClass =
    currentTone === 'ready'
      ? 'lb-uxp-dot lb-uxp-dot-ready'
      : currentTone === 'error'
        ? 'lb-uxp-dot lb-uxp-dot-error'
        : 'lb-uxp-dot lb-uxp-dot-waiting'
  const dot = document.createElement('span')
  dot.className = dotClass

  const badgeText = createSpectrumElement('sp-label', readToneLabel())
  badge.append(dot, badgeText)
  statusLine.append(badge)

  const body = createSpectrumElement('sp-body', currentStatus, { size: 'S' })
  const meta = document.createElement('div')
  meta.className = 'lb-uxp-meta'

  const bridgeChip = document.createElement('span')
  bridgeChip.className = 'lb-uxp-chip'
  bridgeChip.append(createSpectrumElement('sp-detail', `本地桥接 ${BRIDGE_ORIGIN}`, { size: 'S' }))

  const roleChip = document.createElement('span')
  roleChip.className = 'lb-uxp-chip'
  roleChip.append(createSpectrumElement('sp-detail', 'Photoshop 写入通道', { size: 'S' }))

  meta.append(bridgeChip, roleChip)
  statusRow.append(statusLine, body, meta)

  const footer = document.createElement('div')
  footer.className = 'lb-uxp-footer'
  const reconnect = createSpectrumElement('sp-button', '重新连接', { variant: 'primary' })
  reconnect.addEventListener('click', () => {
    connectBridge(true)
  })
  footer.append(reconnect)

  shell.append(header, statusRow, footer)
  panelRoot.appendChild(shell)
}

function writePanel(status: string, tone: 'ready' | 'waiting' | 'error' = 'waiting') {
  currentStatus = status
  currentTone = tone
  renderPanel()
}

async function requestBridge(path: string, init: RequestInit = {}) {
  const separator = path.includes('?') ? '&' : '?'
  const response = await fetch(`${BRIDGE_ORIGIN}${path}${separator}token=${encodeURIComponent(BRIDGE_TOKEN)}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {})
    }
  })

  if (!response.ok) {
    throw new Error(`Bridge HTTP ${response.status}`)
  }

  return response.json()
}

function readRgba(value: SerializedCanvasImage['rgba']) {
  if (Array.isArray(value)) {
    return new Uint8Array(value)
  }

  const keys = Object.keys(value)
    .map(Number)
    .filter((key) => Number.isFinite(key))
    .sort((a, b) => a - b)

  return new Uint8Array(keys.map((key) => value[String(key)] ?? 0))
}

function serializeCanvasImage(image: CapturedCanvasImage) {
  return {
    ...image,
    rgba: Array.from(image.rgba)
  }
}

function deserializeCanvasImage(image: SerializedCanvasImage): CapturedCanvasImage {
  return {
    ...image,
    rgba: readRgba(image.rgba)
  }
}

function readDocumentStatus() {
  return {
    connected: true,
    documentLabel: readActiveDocumentLabel()
  }
}

async function placeImage(payload: any) {
  const image = deserializeCanvasImage(payload.image)
  const target = payload.target

  if (target?.type === 'currentSelection') {
    return canvasPrimitiveService.insertImageToSelection(image)
  }

  if (target?.type === 'bounds') {
    return canvasPrimitiveService.insertImage(image, target.bounds as CanvasInsertTarget)
  }

  return canvasPrimitiveService.insertImageToFullCanvas(image)
}

async function buildCommandResponse(message: BridgeMessage) {
  try {
    let payload: unknown

    if (message.type === 'photoshop.status') {
      payload = readDocumentStatus()
    } else if (message.type === 'canvas.captureVisible') {
      payload = serializeCanvasImage(await canvasPrimitiveService.captureVisibleImage())
    } else if (message.type === 'canvas.captureSelection') {
      payload = serializeCanvasImage(await canvasPrimitiveService.captureSelectionImage())
    } else if (message.type === 'canvas.captureLayer') {
      payload = serializeCanvasImage(await canvasPrimitiveService.captureSelectedLayerImage())
    } else if (message.type === 'canvas.placeImage') {
      payload = await placeImage(message.payload)
    } else if (message.type === 'canvas.createLayer') {
      await createNamedLayer()
      payload = { ok: true }
    } else {
      throw new Error('未知操作')
    }

    return {
      id: message.id,
      ok: true,
      payload
    }
  } catch (error) {
    return {
      id: message.id,
      ok: false,
      error: {
        code: 'PHOTOSHOP_ACTION_FAILED',
        message: error instanceof Error ? error.message : 'Photoshop 操作失败',
        recoverable: true
      }
    }
  }
}

function connectBridge(force = false) {
  if (!force && polling) {
    return
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = undefined
  }

  writePanel('正在连接 Lightyear Banana 桌面 App...', 'waiting')
  polling = true
  pollLoopId += 1
  void runPollLoop(pollLoopId)
}

async function runPollLoop(loopId: number) {
  try {
    await requestBridge('/uxp/hello', {
      method: 'POST',
      body: JSON.stringify({
        id: `uxp-hello-${Date.now()}`,
        type: 'uxp.hello',
        role: 'uxp',
        payload: readDocumentStatus(),
        createdAt: Date.now()
      })
    })
    console.log(`${LOG_PREFIX} bridge connected`)
    writePanel('连接正常。请在桌面 App 中操作生图和 Photoshop 写入。', 'ready')

    while (loopId === pollLoopId) {
      const message = (await requestBridge('/uxp/poll')) as BridgeMessage
      if (message.type === 'bridge.noop') {
        continue
      }

      const response = await buildCommandResponse(message)
      await requestBridge('/uxp/respond', {
        method: 'POST',
        body: JSON.stringify(response)
      })
    }
  } catch (error) {
    console.error(LOG_PREFIX, error)
    writePanel('未连接到桌面 App。请启动 App，或点击重新连接。', 'waiting')
    polling = false
    reconnectTimer = setTimeout(() => connectBridge(true), 2000)
  }
}

function mountPanel(rootNode?: unknown) {
  const mountNode = resolvePanelMount(rootNode)
  console.log(`${LOG_PREFIX} mount target`, mountNode?.tagName, mountNode?.id, mountNode?.childNodes.length)

  if (polling) {
    writePanel('连接正常。请在桌面 App 中操作生图和 Photoshop 写入。', 'ready')
    return
  }

  writePanel('正在连接 Lightyear Banana 桌面 App...', 'waiting')
  connectBridge()
}

console.log(`${LOG_PREFIX} script loaded`, Boolean(document.getElementById('app')))
const { entrypoints } = getUxpRequire()('uxp')

entrypoints.setup({
  commands: {
    async createLayer() {
      console.log(`${LOG_PREFIX} command createLayer`)
      await createNamedLayer()
    }
  },
  panels: {
    panel: {
      create(rootNode: unknown) {
        console.log(`${LOG_PREFIX} panel create`)
        mountPanel(rootNode)
      },
      show(rootNode: unknown) {
        console.log(`${LOG_PREFIX} panel show`)
        mountPanel(rootNode)
      }
    }
  }
})

connectBridge()

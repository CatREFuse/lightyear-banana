import '../styles/fonts.css'
import { canvasPrimitiveService, type CanvasInsertTarget } from './canvasPrimitiveService'
import { readCanvasDiagnosticContext, type CapturedCanvasImage } from './canvasPrimitives'
import {
  createUxpDiagnosticTrace,
  normalizeUxpDiagnosticError,
  type UxpDiagnosticEvent,
  type UxpDiagnosticTrace
} from './diagnosticTrace'
import { createNamedLayer, readActiveDocumentLabel } from './photoshopHost'

type UxpRequire = (name: string) => any

type BridgeMessage<T = unknown> = {
  id: string
  type: string
  payload?: T
}

type FailedBridgeInteraction = {
  timestamp: string
  eventId: string
  method: string
  path: string
  durationMs: number
  error: Record<string, unknown>
}

type SerializedCanvasImage = Omit<CapturedCanvasImage, 'rgba'> & {
  rgba: string | number[] | Record<string, number>
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
let bridgeFailureSequence = 0
const failedBridgeInteractions: FailedBridgeInteraction[] = []
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
    return '[CONNECTED]'
  }

  if (currentTone === 'error') {
    return '[ERROR]'
  }

  return '[WAITING]'
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
    :root {
      --lb-background: #000000;
      --lb-border: #333333;
      --lb-text: #e8e8e8;
      --lb-text-secondary: #999999;
      --lb-font-display: "Doto Variable", "Space Mono", monospace;
      --lb-font-body: "Space Grotesk Variable", "Space Grotesk", -apple-system, BlinkMacSystemFont, sans-serif;
      --lb-font-label: "Space Mono", "SF Mono", monospace;
    }

    @media (prefers-color-scheme: light) {
      :root {
        --lb-background: #f5f5f5;
        --lb-border: #cccccc;
        --lb-text: #1a1a1a;
        --lb-text-secondary: #666666;
      }
    }

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
      background-color: var(--uxp-host-background-color, var(--lb-background));
      color: var(--uxp-host-text-color, var(--lb-text));
      font-family: var(--lb-font-body);
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
      background-color: var(--uxp-host-background-color, var(--lb-background));
      box-sizing: border-box;
    }

    #${PANEL_ROOT_ID} * {
      box-sizing: border-box;
    }

    .lb-uxp-shell {
      display: flex;
      flex-direction: column;
      gap: 24px;
      width: 100%;
      min-height: 100%;
      padding: 16px;
    }

    .lb-uxp-header {
      display: flex;
      align-items: flex-start;
      justify-content: flex-start;
      min-width: 0;
    }

    .lb-uxp-title {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    .lb-uxp-brand {
      margin: 0;
      color: var(--uxp-host-text-color, var(--lb-text));
      font-family: var(--lb-font-body);
      font-size: 14px;
      font-weight: 500;
      line-height: 1.5;
    }

    .lb-uxp-kicker,
    .lb-uxp-section-label,
    .lb-uxp-meta-label,
    .lb-uxp-meta-value {
      margin: 0;
      font-family: var(--lb-font-label);
      font-size: 11px;
      font-weight: 400;
      line-height: 1.4;
      letter-spacing: 0.08em;
    }

    .lb-uxp-kicker,
    .lb-uxp-section-label,
    .lb-uxp-meta-label {
      color: var(--uxp-host-text-color, var(--lb-text-secondary));
      opacity: 0.62;
    }

    .lb-uxp-divider {
      width: 100%;
      margin: 0;
      color: var(--uxp-host-border-color, var(--lb-border));
      opacity: 0.7;
    }

    .lb-uxp-main {
      display: flex;
      flex-direction: column;
      gap: 24px;
      min-width: 0;
    }

    .lb-uxp-status-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
    }

    .lb-uxp-status-value {
      width: 100%;
      margin: 0;
      color: var(--uxp-host-text-color, var(--lb-text));
      font-family: var(--lb-font-display);
      font-size: 36px;
      font-weight: 500;
      line-height: 1;
      letter-spacing: -0.03em;
      white-space: nowrap;
    }

    .lb-uxp-status-copy {
      max-width: 360px;
      margin: 0;
      color: var(--uxp-host-text-color, var(--lb-text));
      font-family: var(--lb-font-body);
      font-size: 14px;
      font-weight: 400;
      line-height: 1.5;
      opacity: 0.74;
    }

    .lb-uxp-meta {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .lb-uxp-meta-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      min-width: 0;
      padding: 12px 0;
    }

    .lb-uxp-meta-value {
      min-width: 0;
      color: var(--uxp-host-text-color, var(--lb-text));
      letter-spacing: 0;
      text-align: right;
      white-space: nowrap;
    }

    .lb-uxp-footer {
      display: flex;
      flex-direction: column;
      gap: 16px;
      margin-top: auto;
    }

    .lb-uxp-reconnect {
      width: 100%;
      min-height: 44px;
      margin: 0;
      border-radius: 4px;
      font-family: var(--lb-font-label);
      font-size: 11px;
      letter-spacing: 0.08em;
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
  title.className = 'lb-uxp-brand'
  const subtitle = createSpectrumElement('sp-label', 'PHOTOSHOP LINK')
  subtitle.className = 'lb-uxp-kicker'
  titleBlock.append(title, subtitle)

  header.append(titleBlock)

  const topDivider = createSpectrumElement('sp-divider')
  topDivider.className = 'lb-uxp-divider'

  const main = document.createElement('div')
  main.className = 'lb-uxp-main'

  const statusGroup = document.createElement('div')
  statusGroup.className = 'lb-uxp-status-group'
  const statusLabel = createSpectrumElement('sp-label', '连接状态')
  statusLabel.className = 'lb-uxp-section-label'
  const statusValue = createSpectrumElement('sp-heading', readToneLabel(), { size: 'M' })
  statusValue.className = 'lb-uxp-status-value'
  const body = createSpectrumElement('sp-body', currentStatus, { size: 'S' })
  body.className = 'lb-uxp-status-copy'
  statusGroup.append(statusLabel, statusValue, body)

  const meta = document.createElement('div')
  meta.className = 'lb-uxp-meta'

  const bridgeRow = document.createElement('div')
  bridgeRow.className = 'lb-uxp-meta-row'
  const bridgeLabel = createSpectrumElement('sp-detail', '本地连接', { size: 'S' })
  bridgeLabel.className = 'lb-uxp-meta-label'
  const bridgeValue = createSpectrumElement('sp-detail', BRIDGE_ORIGIN, { size: 'S' })
  bridgeValue.className = 'lb-uxp-meta-value'
  bridgeRow.append(bridgeLabel, bridgeValue)

  const metaDivider = createSpectrumElement('sp-divider')
  metaDivider.className = 'lb-uxp-divider'

  const roleRow = document.createElement('div')
  roleRow.className = 'lb-uxp-meta-row'
  const roleLabel = createSpectrumElement('sp-detail', '通道', { size: 'S' })
  roleLabel.className = 'lb-uxp-meta-label'
  const roleValue = createSpectrumElement('sp-detail', 'PHOTOSHOP 写入', { size: 'S' })
  roleValue.className = 'lb-uxp-meta-value'
  roleRow.append(roleLabel, roleValue)

  meta.append(bridgeRow, metaDivider, roleRow)
  main.append(statusGroup, meta)

  const footer = document.createElement('div')
  footer.className = 'lb-uxp-footer'
  const footerDivider = createSpectrumElement('sp-divider')
  footerDivider.className = 'lb-uxp-divider'
  const reconnect = createSpectrumElement('sp-button', '重新连接', { variant: 'secondary' })
  reconnect.className = 'lb-uxp-reconnect'
  reconnect.setAttribute('title', '重新连接桌面 App')
  reconnect.addEventListener('click', () => {
    connectBridge(true)
  })
  footer.append(footerDivider, reconnect)

  shell.append(header, topDivider, main, footer)
  panelRoot.appendChild(shell)
}

function writePanel(status: string, tone: 'ready' | 'waiting' | 'error' = 'waiting') {
  currentStatus = status
  currentTone = tone
  renderPanel()
}

function rememberBridgeFailure(path: string, method: string, startedAt: number, error: unknown) {
  bridgeFailureSequence += 1
  failedBridgeInteractions.push({
    timestamp: new Date().toISOString(),
    eventId: `uxp-bridge-${Date.now()}-${bridgeFailureSequence}`,
    method,
    path: path.split('?')[0],
    durationMs: Date.now() - startedAt,
    error: normalizeUxpDiagnosticError(error)
  })
  if (failedBridgeInteractions.length > 200) {
    failedBridgeInteractions.splice(0, failedBridgeInteractions.length - 200)
  }
}

async function requestBridge(
  path: string,
  init: RequestInit = {},
  options: { recordFailure?: boolean } = {}
) {
  const startedAt = Date.now()
  const method = init.method || 'GET'
  const separator = path.includes('?') ? '&' : '?'
  try {
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
  } catch (error) {
    if (options.recordFailure !== false) {
      rememberBridgeFailure(path, method, startedAt, error)
    }
    throw error
  }
}

async function flushBridgeFailures() {
  if (!failedBridgeInteractions.length) {
    return
  }

  const records = failedBridgeInteractions.splice(0, failedBridgeInteractions.length)
  try {
    await requestBridge('/uxp/logs', {
      method: 'POST',
      body: JSON.stringify({ records })
    }, { recordFailure: false })
  } catch {
    failedBridgeInteractions.unshift(...records)
    if (failedBridgeInteractions.length > 200) {
      failedBridgeInteractions.splice(200)
    }
  }
}

function readRgba(value: SerializedCanvasImage['rgba']) {
  if (typeof value === 'string') {
    return base64ToBytes(value)
  }

  if (Array.isArray(value)) {
    return new Uint8Array(value)
  }

  const keys = Object.keys(value)
    .map(Number)
    .filter((key) => Number.isFinite(key))
    .sort((a, b) => a - b)

  return new Uint8Array(keys.map((key) => value[String(key)] ?? 0))
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function serializeReferenceImage(image: CapturedCanvasImage) {
  return {
    ...image,
    rgba: ''
  }
}

function deserializeCanvasImage(image: SerializedCanvasImage): CapturedCanvasImage {
  return {
    ...image,
    rgba: readRgba(image.rgba)
  }
}

function readSafeCanvasDiagnosticContext() {
  try {
    return readCanvasDiagnosticContext()
  } catch (error) {
    return {
      contextError: normalizeUxpDiagnosticError(error)
    }
  }
}

function readDocumentStatus() {
  const context = readSafeCanvasDiagnosticContext()
  const uxp = getUxpRequire()('uxp')
  return {
    connected: true,
    documentLabel: readActiveDocumentLabel(),
    photoshopVersion: 'photoshopVersion' in context ? context.photoshopVersion : '',
    uxpVersion: uxp?.versions?.uxp ?? uxp?.version ?? '',
    document: 'document' in context ? context.document : undefined,
    contextError: 'contextError' in context ? context.contextError : undefined
  }
}

async function placeImage(payload: any, trace?: UxpDiagnosticTrace) {
  const image = deserializeCanvasImage(payload.image)
  const target = payload.target

  if (target?.type === 'currentSelection') {
    return canvasPrimitiveService.insertImageFromPreviewToSelection(image, trace)
  }

  if (target?.type === 'bounds') {
    return canvasPrimitiveService.insertImageFromPreview(image, target.bounds as CanvasInsertTarget)
  }

  return canvasPrimitiveService.insertImageFromPreviewToFullCanvas(image)
}

async function postUxpDiagnostic(requestId: string, event: UxpDiagnosticEvent) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      requestBridge('/uxp/diagnostics', {
        method: 'POST',
        body: JSON.stringify({ requestId, event })
      }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Diagnostic progress timeout')), 1500)
      })
    ])
  } finally {
    if (timer) {
      clearTimeout(timer)
    }
  }
}

async function buildCommandResponse(message: BridgeMessage) {
  const trace = createUxpDiagnosticTrace({
    requestId: message.id,
    reporter: postUxpDiagnostic
  })
  const commandStartedAt = Date.now()
  await trace.emit('uxp.command', 'start', {
    command: message.type,
    ...readSafeCanvasDiagnosticContext()
  })

  try {
    let payload: unknown

    if (message.type === 'photoshop.status') {
      payload = readDocumentStatus()
    } else if (message.type === 'canvas.captureVisible') {
      payload = serializeReferenceImage(await canvasPrimitiveService.captureVisibleReferenceImage(trace))
    } else if (message.type === 'canvas.captureSelection') {
      const image = await canvasPrimitiveService.captureSelectionReferenceImage(trace)
      await trace.emit('uxp.payload.serialize', 'start', {
        command: message.type,
        imageId: image.id,
        width: image.width,
        height: image.height
      })
      payload = serializeReferenceImage(image)
      await trace.emit('uxp.payload.serialize', 'success', {
        command: message.type,
        imageId: image.id,
        width: image.width,
        height: image.height,
        previewLength: image.previewUrl.length
      })
    } else if (message.type === 'canvas.captureLayer') {
      payload = serializeReferenceImage(await canvasPrimitiveService.captureSelectedLayerReferenceImage())
    } else if (message.type === 'canvas.placeImage') {
      payload = await placeImage(message.payload, trace)
    } else if (message.type === 'canvas.readSize') {
      payload = canvasPrimitiveService.readCanvasSize()
    } else if (message.type === 'canvas.createLayer') {
      await createNamedLayer()
      payload = { ok: true }
    } else {
      throw new Error('未知操作')
    }

    await trace.emit('uxp.command', 'success', {
      command: message.type,
      durationMs: Date.now() - commandStartedAt
    })
    return {
      trace,
      response: {
        id: message.id,
        ok: true,
        payload,
        diagnostics: trace.snapshot()
      }
    }
  } catch (error) {
    const normalizedError = normalizeUxpDiagnosticError(error)
    await trace.emit('uxp.command', 'error', {
      command: message.type,
      durationMs: Date.now() - commandStartedAt
    }, error)
    const messageText = error instanceof Error ? error.message : 'Photoshop 操作失败'
    const code = messageText === '当前没有可读取的选区'
      ? 'NO_SELECTION'
      : typeof normalizedError.code === 'string'
        ? normalizedError.code
        : 'PHOTOSHOP_ACTION_FAILED'

    return {
      trace,
      response: {
        id: message.id,
        ok: false,
        error: {
          ...normalizedError,
          code,
          message: messageText,
          recoverable: true
        },
        diagnostics: trace.snapshot()
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
    await flushBridgeFailures()
    console.log(`${LOG_PREFIX} bridge connected`)
    writePanel('连接正常。请在桌面 App 中操作生图和 Photoshop 写入。', 'ready')

    while (loopId === pollLoopId) {
      const message = (await requestBridge('/uxp/poll')) as BridgeMessage
      if (message.type === 'bridge.noop') {
        continue
      }

      const command = await buildCommandResponse(message)
      await command.trace.emit('bridge.response.post', 'start', { command: message.type })
      command.response.diagnostics = command.trace.snapshot()
      const responseStartedAt = Date.now()
      try {
        await requestBridge('/uxp/respond', {
          method: 'POST',
          body: JSON.stringify(command.response)
        })
        await command.trace.emit('bridge.response.post', 'success', {
          command: message.type,
          durationMs: Date.now() - responseStartedAt
        })
      } catch (error) {
        await command.trace.emit('bridge.response.post', 'error', {
          command: message.type,
          durationMs: Date.now() - responseStartedAt
        }, error)
        throw error
      }
    }
  } catch (error) {
    console.error(LOG_PREFIX, error)
    writePanel('未连接到桌面 App。请启动 App，或点击重新连接。', 'error')
    polling = false
    reconnectTimer = setTimeout(() => connectBridge(true), 2000)
  }
}

function mountPanel(rootNode?: unknown) {
  const mountNode = resolvePanelMount(rootNode)
  console.log(`${LOG_PREFIX} mount target`, mountNode?.tagName, mountNode?.id, mountNode?.childNodes.length)

  if (polling) {
    renderPanel()
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

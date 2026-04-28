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

function getUxpRequire(): UxpRequire {
  if (typeof uxpGlobal.require !== 'function') {
    throw new Error('UXP runtime is unavailable.')
  }

  return uxpGlobal.require
}

function writePanel(status: string, tone: 'ready' | 'waiting' | 'error' = 'waiting') {
  const mountNode = document.getElementById('app')
  if (!mountNode) {
    return
  }

  mountNode.replaceChildren()

  const shell = document.createElement('main')
  shell.style.display = 'grid'
  shell.style.gap = '12px'
  shell.style.padding = '14px'
  shell.style.minWidth = '260px'
  shell.style.color = 'var(--uxp-host-text-color)'
  shell.style.fontFamily = 'var(--uxp-host-font-family)'

  const title = document.createElement('sp-heading')
  title.setAttribute('size', 'S')
  title.textContent = 'Lightyear Banana'

  const badge = document.createElement('sp-detail')
  badge.textContent = tone === 'ready' ? 'Electron App 已连接' : tone === 'error' ? '连接失败' : '等待 Electron App'

  const body = document.createElement('sp-body')
  body.textContent = status

  const instruction = document.createElement('sp-detail')
  instruction.textContent = '请先启动 Lightyear Banana 桌面 App。启动后本面板会自动连接，并作为 Photoshop 画板中转。'

  const reconnect = document.createElement('sp-action-button')
  reconnect.textContent = '重新连接'
  reconnect.addEventListener('click', () => {
    connectBridge(true)
  })

  shell.append(title, badge, body, instruction, reconnect)
  mountNode.append(shell)
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

function mountPanel() {
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
      create() {
        console.log(`${LOG_PREFIX} panel create`)
        mountPanel()
      },
      show() {
        console.log(`${LOG_PREFIX} panel show`)
        mountPanel()
      }
    }
  }
})

connectBridge()

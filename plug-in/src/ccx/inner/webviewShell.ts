import { INNER_HOST_PROTOCOL, PROTOCOL_VERSION, type BridgeEnvelope } from '@mugen/inner-protocol'
import { sanitizeStartupLog, type StartupLog, toStartupErrorDetails } from './startupLog'

export const INNER_WEBUI_URL = __INNER_WEBUI_URL__

type WebViewElement = HTMLElement & {
  postMessage?: (message: unknown, targetOrigin?: string) => void
}

type WebViewLoadEvent = Event & {
  url?: string
  error?: unknown
  message?: unknown
  description?: unknown
  status?: unknown
  code?: number
}

export type WebViewMessageEvent = Event & {
  data?: unknown
  origin?: string
  source?: unknown
}

export type WebViewShell = {
  postMessage: (message: BridgeEnvelope) => void
  isTrustedMessage: (event: WebViewMessageEvent) => boolean
  markReady: () => void
  destroy: () => void
}

function isTrustedMessageOrigin(candidate: string | undefined, expectedOrigin: string) {
  if (!candidate) return false
  try {
    return new URL(candidate).origin === expectedOrigin
  } catch {
    return false
  }
}

function readableLoadError(event?: Event) {
  const loadEvent = event as WebViewLoadEvent | undefined
  const candidate = [loadEvent?.message, loadEvent?.description, loadEvent?.error, loadEvent?.status]
    .find((value) => typeof value === 'string' || typeof value === 'number')
  const safeCandidate = candidate === undefined ? undefined : sanitizeStartupLog(String(candidate))
  return candidate === undefined
    ? '工作台资源加载失败'
    : `工作台资源加载失败（${String(safeCandidate)}）`
}

function createStatus(message: string, retry: () => void, download: () => Promise<{ saved: boolean }>) {
  const status = document.createElement('div')
  status.style.cssText = 'display:flex;flex:1 1 auto;width:100%;height:100%;min-width:0;min-height:0;padding:16px;box-sizing:border-box;flex-direction:column;justify-content:center;gap:12px;background:var(--uxp-host-background-color,#11161f);color:var(--uxp-host-text-color,#f5f7fb);font-family:Segoe UI,sans-serif;'
  const title = document.createElement('strong')
  title.textContent = '工作台启动失败'
  const body = document.createElement('span')
  body.textContent = message
  const actions = document.createElement('div')
  actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;'
  const retryButton = document.createElement('button')
  retryButton.textContent = '重试'
  retryButton.addEventListener('click', retry)
  const downloadButton = document.createElement('button')
  downloadButton.textContent = '下载启动日志'
  const result = document.createElement('span')
  result.setAttribute('role', 'status')
  result.style.cssText = 'min-height:18px;font-size:12px;opacity:.8;'
  downloadButton.addEventListener('click', async () => {
    downloadButton.setAttribute('disabled', 'true')
    result.textContent = '正在保存日志…'
    try {
      const exported = await download()
      result.textContent = exported.saved ? '启动日志已保存' : '已取消保存'
    } catch (error) {
      const details = toStartupErrorDetails(error) as { message?: string }
      result.textContent = `日志保存失败：${details.message ?? '未知错误'}`
    } finally {
      downloadButton.removeAttribute('disabled')
    }
  })
  actions.append(retryButton, downloadButton)
  status.append(title, body, actions, result)
  return status
}

export function createWebViewShell(options: {
  mountNode: HTMLElement
  sessionId: string
  hostNonce: string
  hostVersion: string
  startupLog: StartupLog
  onMessage: (event: WebViewMessageEvent) => void
}): WebViewShell {
  const webUiUrl = new URL(INNER_WEBUI_URL)
  const expectedOrigin = webUiUrl.origin
  const root = options.mountNode
  let webview = document.createElement('webview') as WebViewElement
  let destroyed = false
  let attempt = 0
  let waitingForLoad = false
  let phase: 'navigation' | 'handshake' | 'ready' | 'failed' = 'navigation'
  let lastNavigationUrl: string | undefined
  let removeWebViewListeners: (() => void) | undefined
  let loadTimer: ReturnType<typeof setTimeout> | undefined
  let handshakeTimer: ReturnType<typeof setTimeout> | undefined

  root.style.position = 'relative'
  root.style.display = 'flex'
  root.style.flex = '1 1 auto'
  root.style.width = '100%'
  root.style.height = '100vh'
  root.style.minWidth = '0'
  root.style.minHeight = '0'
  root.style.overflow = 'hidden'

  const replaceRoot = (node?: Node) => {
    while (root.firstChild) root.removeChild(root.firstChild)
    if (node) root.appendChild(node)
  }

  const clearLoadTimer = () => {
    if (loadTimer) clearTimeout(loadTimer)
    loadTimer = undefined
  }

  const clearHandshakeTimer = () => {
    if (handshakeTimer) clearTimeout(handshakeTimer)
    handshakeTimer = undefined
  }

  const showFailure = (message: string, event: string, details?: unknown) => {
    if (destroyed) return
    const failedPhase = phase
    waitingForLoad = false
    phase = 'failed'
    clearLoadTimer()
    clearHandshakeTimer()
    removeWebViewListeners?.()
    options.startupLog.record('ccx', 'ccx', event, { attempt, phase: failedPhase, lastNavigationUrl, message, details })
    replaceRoot(createStatus(message, load, () => options.startupLog.export()))
  }

  const syncWebViewSize = () => {
    const width = Math.max(1, Math.floor(root.clientWidth || window.innerWidth || 1))
    const height = Math.max(1, Math.floor(root.clientHeight || window.innerHeight || 1))
    const cssWidth = `${width}px`
    const cssHeight = `${height}px`
    webview.setAttribute('width', cssWidth)
    webview.setAttribute('height', cssHeight)
    webview.style.width = cssWidth
    webview.style.height = cssHeight
  }

  const postMessage = (message: BridgeEnvelope) => {
    if (destroyed || phase === 'failed') return
    options.startupLog.record('ccx', 'webui', 'bridge.send', {
      attempt, phase, protocol: message.protocol, kind: message.kind,
      command: message.command, messageId: message.messageId,
      bridgeAvailable: typeof webview.postMessage === 'function'
    })
    try {
      if (!webview.postMessage) throw new Error('WebView postMessage is unavailable')
      webview.postMessage(message, expectedOrigin)
    } catch (error) {
      if (phase === 'ready') throw error
      showFailure('无法连接工作台', 'bridge.send.error', toStartupErrorDetails(error))
    }
  }
  const postReady = () => {
    postMessage({
      protocol: INNER_HOST_PROTOCOL,
      kind: 'event',
      messageId: `host-ready-${Date.now()}`,
      sessionId: options.sessionId,
      command: 'host.ready',
      timestamp: new Date().toISOString(),
      payload: {
        hostNonce: options.hostNonce,
        hostVersion: options.hostVersion,
        protocolVersion: PROTOCOL_VERSION
      }
    })
  }
  const load = () => {
    if (destroyed) return
    clearLoadTimer()
    clearHandshakeTimer()
    if (attempt > 0) {
      removeWebViewListeners?.()
      options.startupLog.record('ccx', 'ccx', 'webview.retry.cleanup', { attempt, timersCleared: true, listenersRemoved: true })
      webview = document.createElement('webview') as WebViewElement
    }
    attempt += 1
    waitingForLoad = true
    phase = 'navigation'
    lastNavigationUrl = undefined
    webview.setAttribute('data-mugen-fill-panel', 'true')
    webview.style.cssText = 'display:block;flex:1 1 auto;min-width:0;min-height:0;border:0;background:var(--uxp-host-background-color,#11161f);'
    const instance = webview
    const onLoadStart = (event: Event) => {
      if (destroyed || instance !== webview || phase === 'failed') return
      lastNavigationUrl = (event as WebViewLoadEvent).url
      options.startupLog.record('webui', 'ccx', 'webview.load.navigation', { attempt, phase, url: lastNavigationUrl })
    }
    const onLoadStop = (event: Event) => {
      if (!destroyed && instance === webview) handleLoadStop(event)
    }
    const onLoadError = (event: Event) => {
      if (!destroyed && instance === webview) handleLoadError(event)
    }
    webview.addEventListener('loadstart', onLoadStart)
    webview.addEventListener('loadstop', onLoadStop)
    webview.addEventListener('loaderror', onLoadError)
    removeWebViewListeners = () => {
      instance.removeEventListener('loadstart', onLoadStart)
      instance.removeEventListener('loadstop', onLoadStop)
      instance.removeEventListener('loaderror', onLoadError)
    }
    options.startupLog.record('ccx', 'ccx', 'webview.listeners.registered', { attempt, events: ['loadstart', 'loadstop', 'loaderror', 'message'] })
    options.startupLog.record('ccx', 'webui', 'webview.load.start', {
      attempt,
      url: webUiUrl.href,
      expectedOrigin,
      hostVersion: options.hostVersion,
      protocolVersion: PROTOCOL_VERSION,
      configurationSource: 'build-time INNER_WEBUI_URL'
    })
    syncWebViewSize()
    replaceRoot(webview)
    loadTimer = setTimeout(() => {
      showFailure('工作台加载超时（20 秒）', 'webview.load.timeout')
    }, 20_000)
    try {
      webview.setAttribute('src', webUiUrl.href)
    } catch (error) {
      showFailure('工作台地址无法打开', 'webview.load.exception', toStartupErrorDetails(error))
      return
    }
  }
  const handleLoadStop = (event: Event) => {
    if (!waitingForLoad) {
      options.startupLog.record('webui', 'ccx', 'webview.load.stop.ignored', { attempt, phase })
      return
    }
    const loadedUrl = (event as WebViewLoadEvent).url
    if (loadedUrl) {
      try {
        const trusted = new URL(loadedUrl).origin === expectedOrigin
        if (!trusted) {
          showFailure('工作台加载地址未获授权', 'webview.load.untrusted', { loadedUrl })
          return
        }
      } catch {
        showFailure('工作台加载地址无效', 'webview.load.invalid-url', { loadedUrl })
        return
      }
    }
    waitingForLoad = false
    phase = 'handshake'
    lastNavigationUrl = loadedUrl ?? lastNavigationUrl
    clearLoadTimer()
    options.startupLog.record('webui', 'ccx', 'webview.load.stop', { attempt, loadedUrl })
    if (!root.contains(webview)) replaceRoot(webview)
    clearHandshakeTimer()
    handshakeTimer = setTimeout(() => {
      showFailure('工作台与 Photoshop 连接超时（15 秒）', 'bridge.handshake.timeout')
    }, 15_000)
    postReady()
  }
  const handleLoadError = (event: Event) => {
    if (phase === 'failed' || phase === 'ready') return
    const loadEvent = event as WebViewLoadEvent
    showFailure(readableLoadError(event), 'webview.load.error', {
      url: loadEvent.url,
      error: loadEvent.error,
      message: loadEvent.message,
      description: loadEvent.description,
      status: loadEvent.status,
      code: loadEvent.code
    })
  }
  const handleWindowMessage = (event: Event) => {
    const messageEvent = event as WebViewMessageEvent
    const trustedOrigin = isTrustedMessageOrigin(messageEvent.origin, expectedOrigin)
    const sourceMatches = messageEvent.source === webview
    const rejectedReason = !trustedOrigin ? 'origin-mismatch'
      : !sourceMatches ? 'source-mismatch'
        : phase === 'failed' || destroyed ? 'inactive-attempt' : undefined
    const envelope = messageEvent.data as Partial<BridgeEnvelope> | null | undefined
    options.startupLog.record('webui', 'ccx', 'bridge.receive', {
      attempt, phase, trusted: !rejectedReason, rejectedReason,
      origin: messageEvent.origin, sourceMatches,
      dataType: typeof messageEvent.data,
      protocol: envelope?.protocol, kind: envelope?.kind, command: envelope?.command, messageId: envelope?.messageId
    })
    if (rejectedReason) return
    options.onMessage(messageEvent)
  }

  window.addEventListener('resize', syncWebViewSize)
  window.addEventListener('message', handleWindowMessage)
  load()

  return {
    postMessage,
    isTrustedMessage(event) {
      const trustedOrigin = isTrustedMessageOrigin(event.origin, expectedOrigin)
      return !destroyed && phase !== 'failed' && trustedOrigin && event.source === webview
    },
    markReady() {
      if (destroyed || phase === 'failed' || phase === 'ready') return
      phase = 'ready'
      waitingForLoad = false
      clearLoadTimer()
      clearHandshakeTimer()
      options.startupLog.finish({ attempt })
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      clearLoadTimer()
      clearHandshakeTimer()
      options.startupLog.record('ccx', 'ccx', 'startup.destroy', { attempt })
      window.removeEventListener('resize', syncWebViewSize)
      window.removeEventListener('message', handleWindowMessage)
      removeWebViewListeners?.()
      replaceRoot()
    }
  }
}

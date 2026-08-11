import { CLIENT_READY_SIGNAL, INNER_HOST_PROTOCOL, PROTOCOL_VERSION, createLocationBridgeUrl, type BridgeEnvelope } from '../../../packages/inner-protocol/src/index'
import { matchesWebViewMessageOrigin } from './messageOrigin'

export const INNER_WEBUI_URL = __INNER_WEBUI_URL__

type WebViewElement = HTMLElement & {
  postMessage?: (message: unknown, targetOrigin?: string) => void
  uxpallowinspector?: boolean
}

type WebViewLoadEvent = Event & {
  url?: string
  code?: number
  message?: string
}

export type WebViewMessageEvent = Event & {
  data?: unknown
  origin?: string
  source?: unknown
}

export type WebViewShell = {
  postMessage: (message: BridgeEnvelope) => void
  isTrustedMessage: (event: WebViewMessageEvent) => boolean
  destroy: () => void
}

function createStatus(message: string, retry: () => void) {
  const status = document.createElement('div')
  status.style.cssText = 'display:flex;min-height:100%;padding:16px;box-sizing:border-box;flex-direction:column;gap:10px;background:var(--uxp-host-background-color,#11161f);color:var(--uxp-host-text-color,#f5f7fb);font-family:Segoe UI,sans-serif;'
  const title = document.createElement('strong')
  title.textContent = 'Lightyear Banana'
  const body = document.createElement('span')
  body.textContent = message
  const button = document.createElement('button')
  button.textContent = '重试'
  button.addEventListener('click', retry)
  status.append(title, body, button)
  return status
}

export function createWebViewShell(options: {
  mountNode: HTMLElement
  sessionId: string
  hostNonce: string
  hostVersion: string
  onMessage: (event: WebViewMessageEvent) => void
}): WebViewShell {
  const expectedOrigin = new URL(INNER_WEBUI_URL).origin
  const embeddedWebUiUrl = new URL(INNER_WEBUI_URL)
  embeddedWebUiUrl.searchParams.set('host', 'uxp')
  const root = options.mountNode
  const webview = document.createElement('webview') as WebViewElement
  let destroyed = false
  let loadTimer: ReturnType<typeof setTimeout> | undefined
  let messageTargetUrl = embeddedWebUiUrl.href
  let readySignalCount = 0
  let useLocationBridge = false

  const replaceRoot = (node?: Node) => {
    while (root.firstChild) root.removeChild(root.firstChild)
    if (node) root.appendChild(node)
  }

  const clearLoadTimer = () => {
    if (loadTimer) clearTimeout(loadTimer)
    loadTimer = undefined
  }

  webview.setAttribute('width', '100%')
  webview.setAttribute('height', '100%')
  if (__LIGHTYEAR_APP_ENV__ !== 'production') {
    webview.setAttribute('uxpallowinspector', 'true')
    webview.uxpallowinspector = true
  }
  webview.style.cssText = 'display:block;width:100%;height:100%;border:0;background:var(--uxp-host-background-color,#11161f);'

  const postMessage = (message: BridgeEnvelope) => {
    if (destroyed) return
    if (useLocationBridge) {
      try {
        const locationUrl = createLocationBridgeUrl(messageTargetUrl, message)
        messageTargetUrl = locationUrl
        console.info('[Lightyear Banana] WebView location message sent', JSON.stringify({ command: message.command }))
        webview.setAttribute('src', locationUrl)
      } catch (error) {
        console.error('[Lightyear Banana] WebView location bridge failed', String(error))
      }
      return
    }
    if (typeof webview.postMessage !== 'function') {
      console.error('[Lightyear Banana] WebView message bridge unavailable')
      return
    }
    webview.postMessage(JSON.stringify(message))
  }
  const postReady = () => {
    console.info('[Lightyear Banana] WebView bridge ready', JSON.stringify({ origin: expectedOrigin }))
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
    replaceRoot(webview)
    console.info('[Lightyear Banana] Loading WebView', JSON.stringify({ url: embeddedWebUiUrl.href }))
    webview.setAttribute('src', embeddedWebUiUrl.href)
    loadTimer = setTimeout(() => {
      if (!destroyed) replaceRoot(createStatus('工作台加载超时，请重试', load))
    }, 20_000)
  }
  const handleLoadStart = (event: Event) => {
    console.info('[Lightyear Banana] WebView load started', JSON.stringify({
      url: (event as WebViewLoadEvent).url ?? embeddedWebUiUrl.href
    }))
  }
  const handleLoadStop = (event: Event) => {
    const loadedUrl = (event as WebViewLoadEvent).url
    if (loadedUrl) {
      try {
        if (new URL(loadedUrl).origin !== expectedOrigin) {
          handleLoadError(event)
          return
        }
      } catch {
        handleLoadError(event)
        return
      }
    }
    console.info('[Lightyear Banana] WebView load completed', JSON.stringify({
      url: loadedUrl ?? embeddedWebUiUrl.href
    }))
    clearLoadTimer()
    if (!root.contains(webview)) replaceRoot(webview)
    postReady()
  }
  const handleLoadError = (event?: Event) => {
    if (destroyed) return
    const loadEvent = event as WebViewLoadEvent | undefined
    console.error('[Lightyear Banana] WebView load failed', JSON.stringify({
      url: loadEvent?.url ?? embeddedWebUiUrl.href,
      code: loadEvent?.code,
      message: loadEvent?.message
    }))
    clearLoadTimer()
    replaceRoot(createStatus('工作台暂时不可用，请稍后重试', load))
  }
  const handleWindowMessage = (event: Event) => {
    const messageEvent = event as WebViewMessageEvent
    console.info('[Lightyear Banana] WebView message observed', JSON.stringify({
      origin: messageEvent.origin,
      expectedOrigin,
      sourceMatches: messageEvent.source === webview,
      clientReady: messageEvent.data === CLIENT_READY_SIGNAL
    }))
    if (!matchesWebViewMessageOrigin(messageEvent.origin, expectedOrigin) || messageEvent.source !== webview) return
    messageTargetUrl = messageEvent.origin ?? embeddedWebUiUrl.href
    if (messageEvent.data === CLIENT_READY_SIGNAL) {
      readySignalCount += 1
      if (readySignalCount >= 2) {
        useLocationBridge = true
        console.warn('[Lightyear Banana] Falling back to WebView location bridge')
      }
      postReady()
      return
    }
    const envelope = messageEvent.data as Partial<BridgeEnvelope> | undefined
    console.info('[Lightyear Banana] WebView message received', JSON.stringify({ command: envelope?.command }))
    options.onMessage(messageEvent)
  }

  webview.addEventListener('loadstart', handleLoadStart)
  webview.addEventListener('loadstop', handleLoadStop)
  webview.addEventListener('loaderror', handleLoadError)
  window.addEventListener('message', handleWindowMessage)
  load()

  return {
    postMessage,
    isTrustedMessage(event) {
      return matchesWebViewMessageOrigin(event.origin, expectedOrigin) && event.source === webview
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      clearLoadTimer()
      window.removeEventListener('message', handleWindowMessage)
      webview.removeEventListener('loadstart', handleLoadStart)
      webview.removeEventListener('loadstop', handleLoadStop)
      webview.removeEventListener('loaderror', handleLoadError)
      if (root.contains(webview)) replaceRoot()
    }
  }
}

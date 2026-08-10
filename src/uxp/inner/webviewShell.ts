import { INNER_HOST_PROTOCOL, PROTOCOL_VERSION, type BridgeEnvelope } from '../../../packages/inner-protocol/src/index'

export const INNER_WEBUI_URL = __INNER_WEBUI_URL__

type WebViewElement = HTMLElement & {
  postMessage?: (message: unknown, targetOrigin?: string) => void
}

type WebViewLoadEvent = Event & {
  url?: string
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
  webview.style.cssText = 'display:block;width:100%;height:100%;border:0;background:var(--uxp-host-background-color,#11161f);'

  const postMessage = (message: BridgeEnvelope) => {
    if (destroyed) return
    webview.postMessage?.(message, expectedOrigin)
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
    replaceRoot(webview)
    webview.setAttribute('src', embeddedWebUiUrl.href)
    loadTimer = setTimeout(() => {
      if (!destroyed) replaceRoot(createStatus('工作台加载超时，请重试', load))
    }, 20_000)
  }
  const handleLoadStop = (event: Event) => {
    const loadedUrl = (event as WebViewLoadEvent).url
    if (loadedUrl) {
      try {
        if (new URL(loadedUrl).origin !== expectedOrigin) {
          handleLoadError()
          return
        }
      } catch {
        handleLoadError()
        return
      }
    }
    clearLoadTimer()
    if (!root.contains(webview)) replaceRoot(webview)
    postReady()
  }
  const handleLoadError = () => {
    if (destroyed) return
    clearLoadTimer()
    replaceRoot(createStatus('工作台暂时不可用，请稍后重试', load))
  }
  const handleWindowMessage = (event: Event) => {
    const messageEvent = event as WebViewMessageEvent
    if (messageEvent.origin !== expectedOrigin || messageEvent.source !== webview) return
    options.onMessage(messageEvent)
  }

  webview.addEventListener('loadstop', handleLoadStop)
  webview.addEventListener('loaderror', handleLoadError)
  window.addEventListener('message', handleWindowMessage)
  load()

  return {
    postMessage,
    isTrustedMessage(event) {
      return event.origin === expectedOrigin && event.source === webview
    },
    destroy() {
      if (destroyed) return
      destroyed = true
      clearLoadTimer()
      window.removeEventListener('message', handleWindowMessage)
      webview.removeEventListener('loadstop', handleLoadStop)
      webview.removeEventListener('loaderror', handleLoadError)
      if (root.contains(webview)) replaceRoot()
    }
  }
}

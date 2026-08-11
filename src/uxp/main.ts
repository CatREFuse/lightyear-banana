import { CommandRegistry, publicHostError } from './inner/commandRegistry'
import { createErrorResponse, createEvent, createResponse, BridgeValidationError, INNER_HOST_PROTOCOL, parseRequest } from './inner/protocol'
import { SessionManager } from './inner/sessionManager'
import { createWebViewShell, type WebViewShell } from './inner/webviewShell'
import { createNamedLayer } from './photoshopHost'

const CCX_VERSION = __CCX_VERSION__

type UxpRequire = (name: string) => any
type PanelRuntime = {
  mountNode: HTMLElement
  session: SessionManager
  registry: CommandRegistry
  shell: WebViewShell
}
type DevelopmentSmokeEvent = { command: string; payload: unknown }
type DevelopmentSmokeHarness = {
  invoke: (command: string, payload?: Record<string, unknown>) => Promise<unknown>
  events: () => DevelopmentSmokeEvent[]
  clearEvents: () => void
}

const uxpGlobal = globalThis as typeof globalThis & {
  require?: UxpRequire
  __MUGEN_SMOKE__?: DevelopmentSmokeHarness
}
let panelRuntime: PanelRuntime | undefined

function getUxpRequire(): UxpRequire {
  if (typeof uxpGlobal.require !== 'function') throw new Error('UXP runtime is unavailable.')
  return uxpGlobal.require
}

function isMountElement(value: unknown): value is HTMLElement {
  const candidate = value as HTMLElement | undefined
  return Boolean(
    candidate
      && typeof candidate.appendChild === 'function'
      && typeof candidate.querySelector === 'function'
  )
}

function resolveMount(rootNode?: unknown) {
  if (isMountElement(rootNode)) return (rootNode.querySelector('#app') as HTMLElement | null) ?? rootNode
  return document.getElementById('app') ?? document.body
}

function destroyPanel() {
  panelRuntime?.shell.destroy()
  panelRuntime?.registry.destroy()
  panelRuntime = undefined
  if (__MUGEN_APP_ENV__ !== 'production') {
    delete uxpGlobal.__MUGEN_SMOKE__
  }
}

function mountPanel(rootNode?: unknown) {
  const mountNode = resolveMount(rootNode)
  if (panelRuntime?.mountNode === mountNode) return
  destroyPanel()

  const session = new SessionManager()
  const smokeEvents: DevelopmentSmokeEvent[] = []
  let shell: WebViewShell
  const registry = new CommandRegistry(CCX_VERSION, session, (command, payload) => {
    if (__MUGEN_APP_ENV__ !== 'production') {
      smokeEvents.push({ command, payload })
      if (smokeEvents.length > 100) smokeEvents.splice(0, smokeEvents.length - 100)
    }
    shell.postMessage(createEvent(session.sessionId, command, payload))
  })

  shell = createWebViewShell({
    mountNode,
    sessionId: session.sessionId,
    hostNonce: session.hostNonce,
    hostVersion: CCX_VERSION,
    onMessage: async (event) => {
      const raw = event.data
      let request: ReturnType<typeof parseRequest> | undefined
      try {
        if (!shell.isTrustedMessage(event)) throw new BridgeValidationError('UNTRUSTED_ORIGIN', '消息来源未获授权')
        request = parseRequest(raw)
        session.validate(request)
        const result = await registry.invoke(request)
        shell.postMessage(createResponse(request, session.sessionId, result))
      } catch (error) {
        if (error instanceof BridgeValidationError) {
          registry.recordBridgeValidationFailure(error, request?.command)
        }
        const bridgeError = error instanceof BridgeValidationError
          ? { code: error.code, message: error.message, recoverable: error.recoverable }
          : publicHostError(error)
        try {
          shell.postMessage(createErrorResponse(request, session.sessionId, bridgeError))
        } catch {
          shell.postMessage(createErrorResponse(undefined, session.sessionId, {
            code: 'INVALID_MESSAGE',
            message: '请求格式无效',
            recoverable: false
          }))
        }
      }
    }
  })
  panelRuntime = { mountNode, session, registry, shell }
  if (__MUGEN_APP_ENV__ !== 'production') {
    uxpGlobal.__MUGEN_SMOKE__ = {
      invoke(command, payload) {
        return registry.invoke({
          protocol: INNER_HOST_PROTOCOL,
          kind: 'request',
          messageId: `smoke-${Date.now()}`,
          sessionId: session.sessionId,
          command,
          timestamp: new Date().toISOString(),
          ...(payload === undefined ? {} : { payload })
        })
      },
      events: () => smokeEvents.map((event) => ({ ...event })),
      clearEvents: () => { smokeEvents.length = 0 }
    }
  }
}

const { entrypoints } = getUxpRequire()('uxp')
entrypoints.setup({
  commands: {
    async createLayer() {
      await createNamedLayer()
    }
  },
  panels: {
    panel: {
      create(rootNode: unknown) { mountPanel(rootNode) },
      show(rootNode: unknown) { mountPanel(rootNode) },
      destroy() { destroyPanel() }
    }
  }
})

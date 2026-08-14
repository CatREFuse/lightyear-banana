import { CommandRegistry, publicHostError } from './inner/commandRegistry'
import { createErrorResponse, createEvent, createResponse, BridgeValidationError, INNER_HOST_PROTOCOL, parseRequest } from './inner/protocol'
import { SessionManager } from './inner/sessionManager'
import { StartupLog, toStartupErrorDetails } from './inner/startupLog'
import { createWebViewShell, type WebViewShell } from './inner/webviewShell'
import { createPanelLifecycle } from './panelLifecycle'
import { createNamedLayer } from './photoshopHost'

const CCX_VERSION = __CCX_VERSION__
const CCX_RELEASE_ID = `${CCX_VERSION}+${__CCX_BUILD_NUMBER__}`

type AdobeUxpRequire = (name: string) => any
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

const adobeUxpGlobal = globalThis as typeof globalThis & {
  require?: AdobeUxpRequire
  __MUGEN_SMOKE__?: DevelopmentSmokeHarness
}
let panelRuntime: PanelRuntime | undefined

function getAdobeUxpRequire(): AdobeUxpRequire {
  if (typeof adobeUxpGlobal.require !== 'function') throw new Error('UXP runtime is unavailable.')
  return adobeUxpGlobal.require
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
    delete adobeUxpGlobal.__MUGEN_SMOKE__
  }
}

function mountPanel(rootNode?: unknown) {
  const mountNode = resolveMount(rootNode)
  if (panelRuntime?.mountNode === mountNode) return
  destroyPanel()

  const session = new SessionManager()
  const startupLog = new StartupLog(CCX_RELEASE_ID, session.sessionId)
  startupLog.record('photoshop', 'ccx', 'panel.mount')
  const smokeEvents: DevelopmentSmokeEvent[] = []
  let shell: WebViewShell
  const registry = new CommandRegistry(CCX_RELEASE_ID, session, (command, payload) => {
    if (__MUGEN_APP_ENV__ !== 'production') {
      smokeEvents.push({ command, payload })
      if (smokeEvents.length > 100) smokeEvents.splice(0, smokeEvents.length - 100)
    }
    startupLog.record('photoshop', 'ccx', 'host.event', { command, payload })
    shell.postMessage(createEvent(session.sessionId, command, payload))
  })

  shell = createWebViewShell({
    mountNode,
    sessionId: session.sessionId,
    hostNonce: session.hostNonce,
    hostVersion: CCX_RELEASE_ID,
    startupLog,
    onMessage: async (event) => {
      const raw = event.data
      let request: ReturnType<typeof parseRequest> | undefined
      try {
        if (!shell.isTrustedMessage(event)) throw new BridgeValidationError('UNTRUSTED_ORIGIN', '消息来源未获授权')
        request = parseRequest(raw)
        session.validate(request)
        startupLog.record('ccx', 'photoshop', 'host.command.start', {
          command: request.command,
          messageId: request.messageId,
          payload: request.payload
        })
        const result = await registry.invoke(request)
        startupLog.record('photoshop', 'ccx', 'host.command.success', {
          command: request.command,
          messageId: request.messageId,
          result
        })
        shell.postMessage(createResponse(request, session.sessionId, result))
        if (request.command === 'host.handshake') shell.markReady()
      } catch (error) {
        startupLog.record('photoshop', 'ccx', 'host.command.error', {
          command: request?.command,
          messageId: request?.messageId,
          error: toStartupErrorDetails(error)
        })
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
    adobeUxpGlobal.__MUGEN_SMOKE__ = {
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

const { entrypoints } = getAdobeUxpRequire()('uxp')
const panelLifecycle = createPanelLifecycle({ mount: mountPanel, destroy: destroyPanel })
entrypoints.setup({
  commands: {
    async createLayer() {
      await createNamedLayer()
    }
  },
  panels: {
    panel: panelLifecycle
  }
})

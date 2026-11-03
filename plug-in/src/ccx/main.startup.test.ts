import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INNER_HOST_PROTOCOL } from '@mugen/inner-protocol'

const runtime = vi.hoisted(() => ({
  setup: vi.fn(),
  invoke: vi.fn(),
  trusted: true,
  shell: { isTrustedMessage: vi.fn(), postMessage: vi.fn(), markReady: vi.fn(), destroy: vi.fn() },
  onMessage: undefined as undefined | ((event: { data: unknown }) => Promise<void>),
  record: vi.fn()
}))

vi.mock('./inner/commandRegistry', () => ({
  CommandRegistry: class {
    invoke = runtime.invoke
    destroy = vi.fn()
    recordBridgeValidationFailure = vi.fn()
  },
  publicHostError: () => ({ code: 'HOST_ERROR', message: 'failed', recoverable: true })
}))
vi.mock('./inner/sessionManager', () => ({
  SessionManager: class { sessionId = 'session-1'; hostNonce = 'host-1'; validate = vi.fn() }
}))
vi.mock('./inner/startupLog', () => ({
  StartupLog: class { record = runtime.record },
  toStartupErrorDetails: (error: Error) => ({ message: error.message })
}))
vi.mock('./inner/webviewShell', () => ({
  createWebViewShell: (options: { onMessage: typeof runtime.onMessage }) => {
    runtime.onMessage = options.onMessage
    return runtime.shell
  }
}))
vi.mock('./photoshopHost', () => ({ createNamedLayer: vi.fn() }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  runtime.trusted = true
  runtime.shell.isTrustedMessage.mockImplementation(() => runtime.trusted)
  vi.stubGlobal('__CCX_VERSION__', '1.1.7')
  vi.stubGlobal('__CCX_BUILD_NUMBER__', '2608140002')
  vi.stubGlobal('__MUGEN_APP_ENV__', 'production')
  vi.stubGlobal('require', () => ({ entrypoints: { setup: runtime.setup } }))
})

afterEach(() => vi.unstubAllGlobals())

describe('CCX asynchronous startup commands', () => {
  it('does not deliver an old handshake result or mark a replacement WebView ready', async () => {
    let resolve!: (value: unknown) => void
    runtime.invoke.mockReturnValue(new Promise(value => { resolve = value }))
    await import('./main')
    const lifecycle = runtime.setup.mock.calls[0][0].panels.panel
    await lifecycle.create({ appendChild() {}, querySelector() { return null } })
    const pending = runtime.onMessage!({ data: {
      protocol: INNER_HOST_PROTOCOL, kind: 'request', command: 'host.handshake',
      messageId: 'handshake-1', sessionId: 'session-1', timestamp: new Date().toISOString(),
      payload: { protocolVersion: 1, webVersion: '0.2.6', hostNonce: 'host-1', clientNonce: 'client-nonce-1' }
    } })
    expect(runtime.invoke).toHaveBeenCalledOnce()
    runtime.trusted = false
    resolve({ sessionId: 'session-1' })
    await pending
    expect(runtime.shell.postMessage).not.toHaveBeenCalled()
    expect(runtime.shell.markReady).not.toHaveBeenCalled()
    expect(runtime.record).toHaveBeenCalledWith('ccx', 'ccx', 'host.command.discarded', expect.objectContaining({ reason: 'inactive-webview' }))
    await lifecycle.destroy()
  })
})

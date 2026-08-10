import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BridgeEnvelope, HostContext } from '@lightyear-banana/inner-protocol'
import { INNER_HOST_PROTOCOL, PROTOCOL_VERSION } from '@lightyear-banana/inner-protocol'
import { WebViewHostClient, type UxpHostBridge } from './webviewHost'

const context: HostContext = {
  ready: true,
  hostVersion: '1.0.0',
  photoshopVersion: '27.0.0',
  platform: 'win32',
  theme: 'dark',
  capabilities: ['host.getContext']
}

function envelope(value: Partial<BridgeEnvelope> & Pick<BridgeEnvelope, 'kind' | 'command'>): BridgeEnvelope {
  return {
    protocol: INNER_HOST_PROTOCOL,
    messageId: `test-${Math.random()}`,
    sessionId: 'session-1',
    timestamp: new Date().toISOString(),
    ...value
  }
}

function createHarness() {
  const eventTarget = new EventTarget()
  const sent: BridgeEnvelope[] = []
  const host: UxpHostBridge = { postMessage(message) { sent.push(message as BridgeEnvelope) } }
  const fakeWindow = Object.assign(eventTarget, { uxpHost: host, location: { search: '' } }) as unknown as Window
  vi.stubGlobal('window', fakeWindow)
  const dispatch = (message: BridgeEnvelope, source: unknown = host) => {
    const event = new MessageEvent('message', { data: message })
    Object.defineProperty(event, 'source', { value: source })
    return fakeWindow.dispatchEvent(event)
  }
  const client = new WebViewHostClient(host)
  return { client, dispatch, sent }
}

async function connect(harness: ReturnType<typeof createHarness>) {
  const pending = harness.client.handshake({ protocolVersion: PROTOCOL_VERSION, webVersion: '0.1.0', clientNonce: 'client-1' })
  expect(harness.sent).toHaveLength(0)
  harness.dispatch(envelope({ kind: 'event', command: 'host.ready', payload: { protocolVersion: PROTOCOL_VERSION, hostNonce: 'host-1' } }))
  await vi.waitFor(() => expect(harness.sent).toHaveLength(1))
  const request = harness.sent[0]
  expect(request).toMatchObject({ kind: 'request', command: 'host.handshake', sessionId: 'session-1', payload: { clientNonce: 'client-1', hostNonce: 'host-1' } })
  harness.dispatch(envelope({ kind: 'response', command: 'host.handshake', messageId: request.messageId, payload: { sessionId: 'session-1', protocolVersion: PROTOCOL_VERSION, clientNonce: 'client-1', hostNonce: 'host-1', context } }))
  return pending
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('WebViewHostClient', () => {
  it('waits for host.ready and confirms both nonces and the session', async () => {
    const harness = createHarness()
    await expect(connect(harness)).resolves.toMatchObject({ sessionId: 'session-1', clientNonce: 'client-1', hostNonce: 'host-1' })
    harness.client.dispose()
  })

  it('accepts messages only from the exact UXP bridge object', async () => {
    const harness = createHarness()
    const pending = harness.client.handshake({ protocolVersion: PROTOCOL_VERSION, webVersion: '0.1.0', clientNonce: 'client-1' })
    const ready = envelope({ kind: 'event', command: 'host.ready', payload: { protocolVersion: PROTOCOL_VERSION, hostNonce: 'host-1' } })
    harness.dispatch(ready, null)
    harness.dispatch(ready, { postMessage() {} })
    expect(harness.sent).toHaveLength(0)
    harness.dispatch(ready)
    await vi.waitFor(() => expect(harness.sent).toHaveLength(1))
    const request = harness.sent[0]
    harness.dispatch(envelope({ kind: 'response', command: 'host.handshake', messageId: request.messageId, payload: { sessionId: 'session-1', protocolVersion: PROTOCOL_VERSION, clientNonce: 'client-1', hostNonce: 'host-1', context } }))
    await expect(pending).resolves.toMatchObject({ sessionId: 'session-1' })
    harness.client.dispose()
  })

  it('maps protocol errors and ignores responses after cancellation', async () => {
    const harness = createHarness()
    await connect(harness)
    const failed = harness.client.getContext()
    const request = harness.sent.at(-1)!
    harness.dispatch(envelope({ kind: 'response', command: request.command, messageId: request.messageId, error: { code: 'NO_DOCUMENT', message: '请先打开文档', recoverable: true } }))
    await expect(failed).rejects.toMatchObject({ code: 'NO_DOCUMENT', recoverable: true })

    const controller = new AbortController()
    const cancelled = harness.client.invoke('host.getContext', undefined, { signal: controller.signal })
    const cancelledRequest = harness.sent.at(-1)!
    controller.abort()
    await expect(cancelled).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
    harness.dispatch(envelope({ kind: 'response', command: cancelledRequest.command, messageId: cancelledRequest.messageId, payload: context }))
    harness.client.dispose()
  })

  it('times out a request and drops its late response', async () => {
    const harness = createHarness()
    await connect(harness)
    vi.useFakeTimers()
    const pending = harness.client.invoke('host.getContext', undefined, { timeoutMs: 10 })
    const assertion = expect(pending).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' })
    const request = harness.sent.at(-1)!
    await vi.advanceTimersByTimeAsync(11)
    await assertion
    harness.dispatch(envelope({ kind: 'response', command: request.command, messageId: request.messageId, payload: context }))
    harness.client.dispose()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BridgeEnvelope, HostContext } from '@mugen/inner-protocol'
import { CLIENT_READY_SIGNAL, INNER_HOST_PROTOCOL, LOCATION_BRIDGE_QUERY, PROTOCOL_VERSION } from '@mugen/inner-protocol'
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
  const hostEventTarget = new EventTarget()
  const sent: BridgeEnvelope[] = []
  const signals: unknown[] = []
  const host = Object.assign(hostEventTarget, {
    postMessage(message: unknown) {
      if (message === CLIENT_READY_SIGNAL) signals.push(message)
      else sent.push(message as BridgeEnvelope)
    }
  }) as UxpHostBridge
  const location = { search: '', hash: '' }
  const fakeWindow = Object.assign(eventTarget, { uxpHost: host, location }) as unknown as Window
  vi.stubGlobal('window', fakeWindow)
  const dispatch = (message: BridgeEnvelope, source: unknown = host, origin = '') => {
    const event = new MessageEvent('message', { data: message, origin })
    Object.defineProperty(event, 'source', { value: source })
    return fakeWindow.dispatchEvent(event)
  }
  const dispatchHost = (message: BridgeEnvelope, origin = '') => {
    const event = new MessageEvent('message', { data: message, origin })
    return hostEventTarget.dispatchEvent(event)
  }
  const dispatchLocation = (message: BridgeEnvelope) => {
    location.hash = `#/workspace?${LOCATION_BRIDGE_QUERY}=${encodeURIComponent(JSON.stringify(message))}`
    return fakeWindow.dispatchEvent(new Event('hashchange'))
  }
  const client = new WebViewHostClient(host)
  return { client, dispatch, dispatchHost, dispatchLocation, sent, signals }
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
  it('announces readiness after attaching the message listener', () => {
    const harness = createHarness()
    expect(harness.signals).toEqual([CLIENT_READY_SIGNAL])
    harness.client.dispose()
  })

  it('waits for host.ready and confirms both nonces and the session', async () => {
    const harness = createHarness()
    await expect(connect(harness)).resolves.toMatchObject({ sessionId: 'session-1', clientNonce: 'client-1', hostNonce: 'host-1' })
    harness.client.dispose()
  })

  it('authenticates a wrapped UXP source through the protocol handshake', async () => {
    const harness = createHarness()
    const pending = harness.client.handshake({ protocolVersion: PROTOCOL_VERSION, webVersion: '0.1.0', clientNonce: 'client-1' })
    const ready = envelope({ kind: 'event', command: 'host.ready', payload: { protocolVersion: PROTOCOL_VERSION, hostNonce: 'host-1' } })
    harness.dispatch({ unexpected: true } as unknown as BridgeEnvelope, null)
    expect(harness.sent).toHaveLength(0)
    harness.dispatch(ready, { postMessage() {} })
    await vi.waitFor(() => expect(harness.sent).toHaveLength(1))
    const request = harness.sent[0]
    harness.dispatch(envelope({ kind: 'response', command: 'host.handshake', messageId: request.messageId, payload: { sessionId: 'session-1', protocolVersion: PROTOCOL_VERSION, clientNonce: 'client-1', hostNonce: 'host-1', context } }), { postMessage() {} })
    await expect(pending).resolves.toMatchObject({ sessionId: 'session-1' })
    harness.client.dispose()
  })

  it('accepts host messages dispatched directly on the UXP bridge', async () => {
    const harness = createHarness()
    const pending = harness.client.handshake({ protocolVersion: PROTOCOL_VERSION, webVersion: '0.1.0', clientNonce: 'client-1' })
    harness.dispatchHost(envelope({ kind: 'event', command: 'host.ready', payload: { protocolVersion: PROTOCOL_VERSION, hostNonce: 'host-1' } }))
    await vi.waitFor(() => expect(harness.sent).toHaveLength(1))
    const request = harness.sent[0]
    harness.dispatchHost(envelope({ kind: 'response', command: 'host.handshake', messageId: request.messageId, payload: { sessionId: 'session-1', protocolVersion: PROTOCOL_VERSION, clientNonce: 'client-1', hostNonce: 'host-1', context } }))
    await expect(pending).resolves.toMatchObject({ sessionId: 'session-1' })
    harness.client.dispose()
  })

  it('accepts host messages delivered through the same-document location bridge', async () => {
    const harness = createHarness()
    const pending = harness.client.handshake({ protocolVersion: PROTOCOL_VERSION, webVersion: '0.1.0', clientNonce: 'client-1' })
    harness.dispatchLocation(envelope({ kind: 'event', command: 'host.ready', payload: { protocolVersion: PROTOCOL_VERSION, hostNonce: 'host-1' } }))
    await vi.waitFor(() => expect(harness.sent).toHaveLength(1))
    const request = harness.sent[0]
    harness.dispatchLocation(envelope({ kind: 'response', command: 'host.handshake', messageId: request.messageId, payload: { sessionId: 'session-1', protocolVersion: PROTOCOL_VERSION, clientNonce: 'client-1', hostNonce: 'host-1', context } }))
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

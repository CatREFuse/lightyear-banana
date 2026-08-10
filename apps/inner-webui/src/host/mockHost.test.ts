import { afterEach, describe, expect, it, vi } from 'vitest'
import { PROTOCOL_VERSION } from '@lightyear-banana/inner-protocol'
import type { GenerationSnapshot } from '@lightyear-banana/inner-protocol'
import { MockHostClient } from './mockHost'

const snapshot: GenerationSnapshot = {
  configId: 'openai-default',
  prompt: '一张海报',
  references: [],
  size: '1024×1024',
  quality: '高',
  count: 1,
  ratio: '1:1',
  submittedAt: new Date().toISOString()
}

afterEach(() => vi.useRealTimers())

describe('MockHostClient', () => {
  it('supports handshake, settings, credentials and reference capture', async () => {
    const host = new MockHostClient()
    const handshake = await host.handshake({ protocolVersion: PROTOCOL_VERSION, webVersion: '0.1.0', clientNonce: 'client-1' })
    expect(handshake).toMatchObject({ protocolVersion: PROTOCOL_VERSION, clientNonce: 'client-1', context: { ready: true } })
    expect(handshake.hostNonce).toBeTruthy()
    expect((await host.getConfigs())[0]).toMatchObject({ id: 'openai-default', enabled: true })
    expect(await host.captureReference('visible')).toMatchObject({ source: 'visible', status: 'available' })

    const config = { ...(await host.getConfigs())[0], id: 'second', name: '第二个配置', hasCredential: false }
    expect(await host.saveConfig(config, 'secret')).toMatchObject({ id: 'second', hasCredential: true })
    await host.deleteConfig('second')
    expect((await host.getConfigs()).some(item => item.id === 'second')).toBe(false)
  })

  it('runs the full generation event flow and supports cancellation', async () => {
    vi.useFakeTimers()
    const host = new MockHostClient()
    const completed = vi.fn()
    const progress = vi.fn()
    host.on('generation.completed', completed)
    host.on('generation.progress', progress)
    const { taskId } = await host.startGeneration(snapshot)
    await vi.advanceTimersByTimeAsync(900)
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ taskId, phase: 'completed' }))
    expect(completed).toHaveBeenCalledWith(expect.objectContaining({ taskId, assets: [expect.objectContaining({ source: 'generated' })] }))

    const next = await host.startGeneration(snapshot)
    await host.cancelGeneration(next.taskId)
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ taskId: next.taskId, phase: 'cancelled' }))
    host.dispose()
  })

  it('covers no selection, provider failure, invalidation and protocol incompatibility', async () => {
    vi.useFakeTimers()
    expect(await new MockHostClient({ scenario: 'no-selection' }).captureReference('selection')).toBeNull()

    const failedHost = new MockHostClient({ scenario: 'provider-failure' })
    const failed = vi.fn()
    failedHost.on('generation.failed', failed)
    await failedHost.startGeneration(snapshot)
    await vi.advanceTimersByTimeAsync(900)
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ code: 'PROVIDER_FAILED' }) }))

    const invalidHost = new MockHostClient({ scenario: 'asset-invalidated' })
    const invalidated = vi.fn()
    invalidHost.on('asset.invalidated', invalidated)
    await invalidHost.captureReference('visible')
    await vi.advanceTimersByTimeAsync(150)
    expect(invalidated).toHaveBeenCalled()

    const incompatible = await new MockHostClient({ scenario: 'incompatible' }).handshake({ protocolVersion: PROTOCOL_VERSION, webVersion: '0.1.0', clientNonce: 'client-2' })
    expect(incompatible.protocolVersion).toBe(PROTOCOL_VERSION + 1)
  })

  it('implements request timeout and abort handling', async () => {
    vi.useFakeTimers()
    const timeoutHost = new MockHostClient({ scenario: 'timeout' })
    const timedOut = timeoutHost.invoke('generation.start', snapshot, { timeoutMs: 20 })
    const timeoutAssertion = expect(timedOut).rejects.toMatchObject({ code: 'REQUEST_TIMEOUT' })
    await vi.advanceTimersByTimeAsync(25)
    await timeoutAssertion

    const controller = new AbortController()
    controller.abort()
    await expect(new MockHostClient().invoke('host.getContext', undefined, { signal: controller.signal })).rejects.toMatchObject({ code: 'REQUEST_CANCELLED' })
  })

  it('clears every local-data category through the whitelisted command', async () => {
    const host = new MockHostClient()
    await host.captureReference('visible')

    await expect(host.clearLocalData()).resolves.toEqual({
      cleared: true,
      deleted: ['credentials', 'settings', 'history', 'assets', 'diagnostics']
    })
    await expect(host.getConfigs()).resolves.toEqual([])
  })
})

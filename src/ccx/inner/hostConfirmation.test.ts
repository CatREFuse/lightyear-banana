import { describe, expect, it, vi } from 'vitest'
import {
  HostConfirmationGate,
  type HostConfirmationDescriptor,
  type HostConfirmationDialogAdapter,
  type HostConfirmationOutcome
} from './hostConfirmation'

class ManualDialogAdapter implements HostConfirmationDialogAdapter {
  readonly descriptors: HostConfirmationDescriptor[] = []
  readonly destroy = vi.fn(() => {
    for (const resolve of this.resolvers.splice(0)) resolve('cancelled')
  })
  private readonly resolvers: Array<(outcome: HostConfirmationOutcome) => void> = []

  show(descriptor: HostConfirmationDescriptor) {
    this.descriptors.push(descriptor)
    return new Promise<HostConfirmationOutcome>((resolve) => {
      this.resolvers.push(resolve)
    })
  }

  respond(outcome: HostConfirmationOutcome) {
    const resolve = this.resolvers.shift()
    if (!resolve) throw new Error('No confirmation is active.')
    resolve(outcome)
    resolve(outcome)
  }
}

describe('HostConfirmationGate', () => {
  it('does not execute an automatic request before a host click and executes once after confirmation', async () => {
    const adapter = new ManualDialogAdapter()
    const gate = new HostConfirmationGate(adapter)
    const operation = vi.fn(async () => ({ placed: true }))

    const result = gate.run('canvas.placeAsset', operation)

    expect(adapter.descriptors).toHaveLength(1)
    expect(adapter.descriptors[0]?.confirmLabel).toBe('置入')
    expect(operation).not.toHaveBeenCalled()

    adapter.respond('confirmed')

    await expect(result).resolves.toEqual({ placed: true })
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('cancels safely without executing the operation', async () => {
    const adapter = new ManualDialogAdapter()
    const gate = new HostConfirmationGate(adapter)
    const operation = vi.fn()

    const result = gate.run('asset.save', operation)
    adapter.respond('cancelled')

    await expect(result).rejects.toMatchObject({ code: 'HOST_CONFIRMATION_CANCELLED' })
    expect(operation).not.toHaveBeenCalled()
  })

  it('requires a native high-risk confirmation before clearing local data', async () => {
    const adapter = new ManualDialogAdapter()
    const gate = new HostConfirmationGate(adapter)
    const operation = vi.fn(async () => ({ cleared: true }))

    const result = gate.run('storage.clearAll', operation)

    expect(adapter.descriptors[0]).toMatchObject({
      command: 'storage.clearAll',
      confirmLabel: '全部清除'
    })
    expect(adapter.descriptors[0]?.message).toContain('API Key')
    expect(operation).not.toHaveBeenCalled()

    adapter.respond('confirmed')
    await expect(result).resolves.toEqual({ cleared: true })
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('serializes concurrent requests and requires a separate confirmation for each operation', async () => {
    const adapter = new ManualDialogAdapter()
    const gate = new HostConfirmationGate(adapter)
    const firstOperation = vi.fn(async () => 'first')
    const secondOperation = vi.fn(async () => 'second')

    const first = gate.run('canvas.placeAsset', firstOperation)
    const second = gate.run('diagnostics.export', secondOperation)

    expect(adapter.descriptors.map(({ command }) => command)).toEqual(['canvas.placeAsset'])
    expect(secondOperation).not.toHaveBeenCalled()

    adapter.respond('confirmed')
    await expect(first).resolves.toBe('first')
    expect(adapter.descriptors.map(({ command }) => command)).toEqual(['canvas.placeAsset', 'diagnostics.export'])
    expect(secondOperation).not.toHaveBeenCalled()

    adapter.respond('confirmed')
    await expect(second).resolves.toBe('second')
    expect(secondOperation).toHaveBeenCalledTimes(1)
  })

  it('rejects active, queued, and future requests when destroyed', async () => {
    const adapter = new ManualDialogAdapter()
    const gate = new HostConfirmationGate(adapter)
    const firstOperation = vi.fn()
    const secondOperation = vi.fn()
    const first = gate.run('asset.save', firstOperation)
    const second = gate.run('diagnostics.export', secondOperation)

    gate.destroy()

    await expect(first).rejects.toMatchObject({ code: 'HOST_CONFIRMATION_DESTROYED' })
    await expect(second).rejects.toMatchObject({ code: 'HOST_CONFIRMATION_DESTROYED' })
    await expect(gate.run('canvas.placeAsset', vi.fn())).rejects.toMatchObject({ code: 'HOST_CONFIRMATION_DESTROYED' })
    expect(firstOperation).not.toHaveBeenCalled()
    expect(secondOperation).not.toHaveBeenCalled()
    expect(adapter.destroy).toHaveBeenCalledTimes(1)
  })
})

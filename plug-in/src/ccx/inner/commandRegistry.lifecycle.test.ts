import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPanelLifecycle } from '../panelLifecycle'

const runtime = vi.hoisted(() => ({
  action: undefined as {
    addNotificationListener: ReturnType<typeof vi.fn>
    removeNotificationListener: ReturnType<typeof vi.fn>
  } | undefined
}))

vi.mock('../canvasPrimitiveService', () => ({
  canvasPrimitiveService: {}
}))

vi.mock('../canvasPrimitives', () => ({
  readCanvasDiagnosticContext: vi.fn()
}))

vi.mock('../photoshopHost', () => ({
  readActiveDocumentLabel: vi.fn()
}))

vi.mock('./assetStore', () => ({
  AssetStore: class {
    destroy() {}
    resetWorkspace() {}
  }
}))

vi.mock('./fileAssets', () => ({
  FileAssetService: class {}
}))

vi.mock('./hostData', () => ({
  DiagnosticStore: class {
    record() { return Promise.resolve() }
  },
  HistoryStore: class {}
}))

vi.mock('./hostConfirmation', () => ({
  createHostConfirmationController: () => ({
    run: vi.fn(),
    destroy: vi.fn()
  })
}))

vi.mock('./providerRuntime', () => ({
  createProviderRuntime: () => ({
    destroy: vi.fn()
  })
}))

vi.mock('./referenceSelectionPlacement', () => ({
  resolveReferenceSelectionPlacement: vi.fn()
}))

vi.mock('./storage', () => ({
  clearAllSettingsAndCredentials: vi.fn(),
  getSettings: vi.fn(),
  removeCredential: vi.fn(),
  saveSettings: vi.fn(),
  setCredential: vi.fn()
}))

let CommandRegistry: typeof import('./commandRegistry').CommandRegistry

async function flushNotificationAttach() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('Photoshop panel lifecycle', () => {
  it('returns awaitable results from create, show, and destroy', async () => {
    const mount = vi.fn()
    const destroy = vi.fn()
    const lifecycle = createPanelLifecycle({ mount, destroy })
    const rootNode = {}

    const createResult = lifecycle.create(rootNode)
    const showResult = lifecycle.show(rootNode)
    const destroyResult = lifecycle.destroy()

    expect(createResult).toBeInstanceOf(Promise)
    expect(showResult).toBeInstanceOf(Promise)
    expect(destroyResult).toBeInstanceOf(Promise)
    await expect(createResult).resolves.toBeUndefined()
    await expect(showResult).resolves.toBeUndefined()
    await expect(destroyResult).resolves.toBeUndefined()
    expect(mount).toHaveBeenNthCalledWith(1, rootNode)
    expect(mount).toHaveBeenNthCalledWith(2, rootNode)
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('turns a synchronous lifecycle failure into a rejected Promise', async () => {
    const lifecycle = createPanelLifecycle({
      mount: () => { throw new Error('mount failed') },
      destroy: () => { throw new Error('destroy failed') }
    })

    let createResult: Promise<void> | undefined
    let destroyResult: Promise<void> | undefined
    expect(() => { createResult = lifecycle.create({}) }).not.toThrow()
    await expect(createResult).rejects.toThrow('mount failed')
    expect(() => { destroyResult = lifecycle.destroy() }).not.toThrow()
    await expect(destroyResult).rejects.toThrow('destroy failed')
  })
})

describe('CommandRegistry notification cleanup', () => {
  beforeAll(async () => {
    vi.stubGlobal('__INNER_RELEASE_URL__', 'https://mugen.example/releases/')
    ;({ CommandRegistry } = await import('./commandRegistry'))
  })

  beforeEach(() => {
    runtime.action = {
      addNotificationListener: vi.fn(async () => undefined),
      removeNotificationListener: vi.fn()
    }
    vi.stubGlobal('require', (name: string) => {
      if (name === 'photoshop') return { action: runtime.action }
      throw new Error(`Unexpected UXP module: ${name}`)
    })
  })

  async function createAttachedRegistry() {
    const registry = new CommandRegistry(
      '1.0.0',
      { sessionId: 'session', hostNonce: 'nonce' } as never,
      vi.fn()
    )
    await flushNotificationAttach()
    expect(runtime.action?.addNotificationListener).toHaveBeenCalledTimes(1)
    return registry
  }

  it('accepts a synchronous void notification removal', async () => {
    runtime.action!.removeNotificationListener.mockImplementation(() => undefined)
    const registry = await createAttachedRegistry()

    expect(() => registry.destroy()).not.toThrow()
    expect(runtime.action?.removeNotificationListener).toHaveBeenCalledTimes(1)
  })

  it('contains a synchronous notification removal failure', async () => {
    runtime.action!.removeNotificationListener.mockImplementation(() => {
      throw new Error('sync removal failed')
    })
    const registry = await createAttachedRegistry()

    expect(() => registry.destroy()).not.toThrow()
    expect(runtime.action?.removeNotificationListener).toHaveBeenCalledTimes(1)
  })

  it('contains a rejected notification removal Promise', async () => {
    runtime.action!.removeNotificationListener.mockImplementation(() => Promise.reject(new Error('async removal failed')))
    const registry = await createAttachedRegistry()

    expect(() => registry.destroy()).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
    expect(runtime.action?.removeNotificationListener).toHaveBeenCalledTimes(1)
  })
})

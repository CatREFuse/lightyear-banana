import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createPanelLifecycle } from '../panelLifecycle'

const diagnosticsRecord = vi.hoisted(() => vi.fn(async () => undefined))

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
    record = diagnosticsRecord
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

describe('CommandRegistry PS interaction boundary', () => {
  beforeAll(async () => {
    vi.stubGlobal('__INNER_RELEASE_URL__', 'https://mugen.example/releases/')
    ;({ CommandRegistry } = await import('./commandRegistry'))
  })
  it('mounts, handshakes, reads cached context and destroys without accessing Photoshop', async () => {
    const requireModule = vi.fn((name: string) => {
      if (name === 'uxp') return { versions: { uxp: '8' } }
      if (name === 'os') return { platform: () => 'darwin' }
      throw new Error(`Unexpected module: ${name}`)
    })
    vi.stubGlobal('require', requireModule)
    const registry = new CommandRegistry('1.2.0', { sessionId: 'session', hostNonce: 'nonce' } as never, vi.fn())
    const invoke = (command: string, payload?: Record<string, unknown>) => registry.invoke({ command, payload } as never)
    await invoke('host.handshake', { clientNonce: 'client' })
    expect(await invoke('host.getContext')).not.toHaveProperty('document')
    await expect(invoke('canvas.readSize')).rejects.toThrow('请读取图片')
    registry.destroy()
    expect(requireModule.mock.calls.map(([name]) => name)).not.toContain('photoshop')
  })
})


it('retains the sanitized original Photoshop error instead of only code 1000', async () => {
  const { readCanvasDiagnosticContext } = await import('../canvasPrimitives')
  const error = Object.assign(new Error('Only allowed inside a modal scope. token=private-value'), { code: '1000', number: 1000 })
  vi.mocked(readCanvasDiagnosticContext).mockImplementationOnce(() => { throw error })
  const registry = new CommandRegistry('1.2.2', { sessionId: 'session', hostNonce: 'nonce' } as never, vi.fn())
  await expect(registry.invoke({ command: 'canvas.captureVisible', messageId: 'test-error' } as never)).rejects.toBe(error)
  expect(diagnosticsRecord).toHaveBeenCalledWith(expect.objectContaining({
    phase: 'error', details: expect.objectContaining({ errorCode: '1000', errorNumber: 1000, errorMessage: 'Only allowed inside a modal scope. token=[REDACTED]' })
  }))
  registry.destroy()
})

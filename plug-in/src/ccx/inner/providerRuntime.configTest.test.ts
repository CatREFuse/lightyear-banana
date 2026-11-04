import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicModelConfig } from '@mugen/inner-protocol'
import { testImageConfig } from '@mugen/core'
import type { AssetStore } from './assetStore'
import { ProviderRuntime } from './providerRuntime'
import { getCredential, getSettings, saveSettings, setCredential } from './storage'

vi.mock('@mugen/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@mugen/core')>(),
  testImageConfig: vi.fn(async () => undefined)
}))

vi.mock('./storage', async (importOriginal) => ({
  ...await importOriginal<typeof import('./storage')>(),
  getCredential: vi.fn(async () => 'saved-key'),
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  setCredential: vi.fn()
}))

describe('Provider configuration draft tests', () => {
  const draftConfig: PublicModelConfig = {
    id: 'config-1', name: '测试配置', provider: 'custom-openai', model: 'draft-model',
    models: ['draft-model'], baseUrl: 'https://api.vendor.dev/v1', enabled: true,
    credentialState: 'stored'
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(testImageConfig).mockResolvedValue(undefined)
    vi.mocked(getCredential).mockResolvedValue('saved-key')
    vi.mocked(getSettings).mockResolvedValue({ configs: [{ ...draftConfig, model: 'saved-model' }] })
  })

  function createRuntime() {
    return new ProviderRuntime({ assets: {} as AssetStore, emit: vi.fn(), persistHistory: vi.fn() })
  }

  it('tests an unsaved model and key without saving either', async () => {
    const result = await createRuntime().testConfig({ draftConfig, apiKey: 'draft-key' })

    expect(result).toEqual({ ok: true, message: '连接成功' })
    expect(testImageConfig).toHaveBeenCalledWith(expect.objectContaining({ model: 'draft-model', apiKey: 'draft-key' }))
    expect(getCredential).not.toHaveBeenCalled()
    expect(getSettings).not.toHaveBeenCalled()
    expect(saveSettings).not.toHaveBeenCalled()
    expect(setCredential).not.toHaveBeenCalled()
  })

  it('reads a bound saved credential without invalidating it for draft testing', async () => {
    await createRuntime().testConfig({ draftConfig })

    expect(getCredential).toHaveBeenCalledWith(expect.objectContaining({
      id: draftConfig.id, provider: draftConfig.provider, baseUrl: draftConfig.baseUrl
    }), true)
    expect(testImageConfig).toHaveBeenCalledWith(expect.objectContaining({ model: 'draft-model', apiKey: 'saved-key' }))
    expect(saveSettings).not.toHaveBeenCalled()
    expect(setCredential).not.toHaveBeenCalled()
  })

  it('redacts a failed draft test and leaves saved settings and credentials untouched', async () => {
    vi.mocked(testImageConfig).mockRejectedValue(new Error('Rejected draft-key'))

    const result = await createRuntime().testConfig({ draftConfig, apiKey: 'draft-key' })

    expect(result).toEqual({ ok: false, message: 'Rejected [redacted]' })
    expect(saveSettings).not.toHaveBeenCalled()
    expect(setCredential).not.toHaveBeenCalled()
  })

  it('rejects embedded URL credentials before entering the Provider', async () => {
    const result = await createRuntime().testConfig({
      draftConfig: { ...draftConfig, baseUrl: 'https://user:password@api.vendor.dev/v1' },
      apiKey: 'draft-key'
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('不能包含登录凭据')
    expect(testImageConfig).not.toHaveBeenCalled()
    expect(saveSettings).not.toHaveBeenCalled()
    expect(setCredential).not.toHaveBeenCalled()
  })

  it('continues to test saved configurations through the existing configId payload', async () => {
    await expect(createRuntime().testConfig({ configId: draftConfig.id })).resolves.toEqual({ ok: true, message: '连接成功' })

    expect(getSettings).toHaveBeenCalledOnce()
    expect(testImageConfig).toHaveBeenCalledWith(expect.objectContaining({ model: 'saved-model', apiKey: 'saved-key' }))
  })
})

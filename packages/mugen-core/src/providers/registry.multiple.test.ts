import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateImagesWithProvider } from './registry'
import { generateImagesWithLegacyRuntime, ImageApiError } from './legacyRuntime'
import { resolveProviderCapabilityData } from '../../../inner-protocol/src/providerCapabilityData'
import type { ImageGenerationParams } from './contracts'
vi.mock('./legacyRuntime', async importOriginal => ({ ...await importOriginal<typeof import('./legacyRuntime')>(), generateImagesWithLegacyRuntime: vi.fn() }))
const generate = vi.mocked(generateImagesWithLegacyRuntime)
const params: ImageGenerationParams = {
  config: { id: 'custom', name: 'Custom', provider: 'custom-openai', model: 'my-model', models: ['my-model'], apiKey: 'test', baseUrl: 'https://example.test', enabled: true },
  count: 3, prompt: 'cat', size: '1024x1024', quality: 'auto', ratio: '1:1', references: []
}
const image = { previewUrl: 'data:image/png;base64,AA==', label: 'result' }
afterEach(() => vi.resetAllMocks())
describe('custom model multiple images', () => {
  it.each(['gemini', 'openai-chat'] as const)('unlocks custom %s quantities', format => {
    expect(resolveProviderCapabilityData({ provider: 'custom-openai', model: 'my-model', customFormat: format }).countOptions).toContain(3)
  })
  it('unlocks manually added model IDs in single-image providers', () => {
    expect(resolveProviderCapabilityData({ provider: 'flux', model: 'my-model' }).countOptions).toContain(3)
  })
  it('uses a successful native batch once', async () => {
    generate.mockResolvedValue([image, image, image])
    expect(await generateImagesWithProvider(params)).toHaveLength(3)
    expect(generate).toHaveBeenCalledTimes(1)
  })
  it('falls back to individual requests on an explicit unsupported count', async () => {
    generate.mockRejectedValueOnce(new ImageApiError('n must be 1', 400)).mockResolvedValue([image])
    expect(await generateImagesWithProvider(params)).toHaveLength(3)
    expect(generate.mock.calls.map(([p]) => p.count)).toEqual([3, 1, 1, 1])
  })
  it('keeps returned images and fills only a short batch', async () => {
    generate.mockResolvedValue([image])
    expect(await generateImagesWithProvider(params)).toHaveLength(3)
    expect(generate.mock.calls.map(([p]) => p.count)).toEqual([3, 1, 1])
  })
  it.each([401, 429, 500])('does not multiply unrelated failures (%s)', async status => {
    const error = new ImageApiError('request failed', status)
    generate.mockRejectedValue(error)
    await expect(generateImagesWithProvider(params)).rejects.toBe(error)
    expect(generate).toHaveBeenCalledTimes(1)
  })
  it('stops fallback when cancelled', async () => {
    const controller = new AbortController()
    generate.mockImplementationOnce(async () => { controller.abort(); return [image] })
    await expect(generateImagesWithProvider({ ...params, signal: controller.signal })).rejects.toMatchObject({ status: 499 })
    expect(generate).toHaveBeenCalledTimes(1)
  })
  it('does not restart a partially generated batch after a later failure', async () => {
    generate.mockResolvedValueOnce([image]).mockRejectedValueOnce(new ImageApiError('temporary error', 503, true))
    await expect(generateImagesWithProvider(params)).rejects.toMatchObject({ status: 503, retryable: false })
    expect(generate).toHaveBeenCalledTimes(2)
  })
})

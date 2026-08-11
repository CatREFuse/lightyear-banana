import { describe, expect, it } from 'vitest'
import {
  providerCapabilities as webUiCapabilities,
  readProviderCapability as readWebUiCapability
} from '../../packages/inner-protocol/src/providerCapabilities'
import {
  CAPABILITY_PROVIDER_IDS,
  providerCapabilityData,
  validateProviderGenerationParameters
} from '../../packages/inner-protocol/src/providerCapabilityData'
import type { ModelConfig as WebUiModelConfig, ProviderCapability as WebUiProviderCapability } from '../../packages/inner-protocol/src/index'
import type { ModelConfig, ProviderCapability } from '../types/mugen'
import {
  adaptProviderCapabilityForRuntime,
  providerCapabilities as adapterCapabilities,
  providerSupportsQuality,
  readProviderCapabilitiesForRuntime,
  readProviderCapability as readAdapterCapability,
  readProviderCapabilityForRuntime,
  resolveProviderRatioForRuntime
} from './providerCapabilities'

type CapabilityConfig = Pick<ModelConfig, 'provider' | 'model' | 'customFormat'>

function toWebUiCapability(capability: ProviderCapability): WebUiProviderCapability {
  return {
    id: capability.id,
    name: capability.name,
    models: capability.modelOptions,
    referenceLimit: capability.referenceLimit,
    sizes: capability.supportsCustomSize
      ? [...capability.sizeOptions, '自定义']
      : capability.sizeOptions,
    qualities: capability.qualityOptions,
    counts: capability.countOptions,
    ratios: capability.ratioOptions,
    supportsCustomSize: capability.supportsCustomSize,
    customSize: capability.customSize
  }
}

const representativeConfigs: CapabilityConfig[] = [
  { provider: 'openai', model: 'gpt-image-2' },
  { provider: 'iMini', model: 'google/nano-banana-pro' },
  { provider: 'gemini', model: 'gemini-3-pro-image-preview' },
  { provider: 'apimart', model: 'gemini-3.1-flash-image-preview' },
  { provider: 'seedream', model: 'seedream-4-0-250828' },
  { provider: 'qwen', model: 'qwen-image-2.0-pro' },
  { provider: 'kling', model: 'kling/kling-v3-omni-image-generation' },
  { provider: 'flux', model: 'flux-2-pro' },
  { provider: 'comfyui', model: 'workflow-api-json' },
  { provider: 'codex-image-server', model: 'gpt-image-2' },
  { provider: 'custom-openai', model: 'custom-image-model', customFormat: 'openai-images' }
]

const modelBoundaries: CapabilityConfig[] = [
  { provider: 'openai', model: 'dall-e-2' },
  { provider: 'openai', model: 'dall-e-3' },
  { provider: 'iMini', model: 'google/nano-banana' },
  { provider: 'iMini', model: 'google/nano-banana-2' },
  { provider: 'iMini', model: 'openai/gpt-image-2' },
  { provider: 'gemini', model: 'gemini-2.5-flash-image' },
  { provider: 'apimart', model: 'gpt-image-1-official' },
  { provider: 'apimart', model: 'gpt-image-1.5-official' },
  { provider: 'apimart', model: 'gpt-image-2' },
  { provider: 'apimart', model: 'gpt-image-2-official' },
  { provider: 'apimart', model: 'gemini-3-pro-image-preview-official' },
  { provider: 'apimart', model: 'nano-banana-2-ext' },
  { provider: 'apimart', model: 'doubao-seedream-5-0-lite' },
  { provider: 'kling', model: 'kling/kling-v3-image-generation' },
  { provider: 'flux', model: 'flux-2-klein-4b' },
  { provider: 'flux', model: 'flux-2-klein-9b-preview' },
  { provider: 'custom-openai', model: 'custom-image-model', customFormat: 'openai-chat' },
  { provider: 'custom-openai', model: 'custom-image-model', customFormat: 'gemini' }
]

describe('shared provider capability declarations', () => {
  it('is JSON serializable and declares every provider once', () => {
    expect(Object.keys(providerCapabilityData)).toEqual([...CAPABILITY_PROVIDER_IDS])
    expect(JSON.parse(JSON.stringify(providerCapabilityData))).toEqual(providerCapabilityData)
  })

  it('declares serializable custom-size boundaries for every advertised Provider', () => {
    for (const provider of CAPABILITY_PROVIDER_IDS) {
      const capability = providerCapabilityData[provider]
      expect(Boolean(capability.customSize)).toBe(capability.supportsCustomSize)
      if (capability.customSize) expect(JSON.parse(JSON.stringify(capability.customSize))).toEqual(capability.customSize)
    }
    expect(providerCapabilityData.openai.customSize).toEqual({
      minWidth: 16,
      maxWidth: 3840,
      minHeight: 16,
      maxHeight: 3840,
      step: 16,
      minPixels: 655_360,
      maxPixels: 8_294_400,
      maxAspectRatio: 3
    })
  })

  it.each([
    ['1280x512', true, undefined],
    ['3840x2160', true, undefined],
    ['1024.5x1024', false, 'CUSTOM_SIZE_INTEGER'],
    ['1025x1024', false, 'CUSTOM_SIZE_STEP'],
    ['4000x1600', false, 'CUSTOM_SIZE_RANGE'],
    ['1024x512', false, 'CUSTOM_SIZE_PIXELS'],
    ['3840x2176', false, 'CUSTOM_SIZE_PIXELS'],
    ['3840x1024', false, 'CUSTOM_SIZE_RATIO']
  ])('validates GPT Image 2 custom-size boundary %s', (size, valid, code) => {
    expect(validateProviderGenerationParameters(
      { provider: 'openai', model: 'gpt-image-2' },
      { size, quality: 'auto', count: 1, ratio: '原图比例', referenceCount: 0 }
    )).toMatchObject(valid ? { valid: true } : { valid: false, code })
  })

  it.each(representativeConfigs)('keeps $provider base capabilities equal in Adapter and WebUI', (config) => {
    const adapter = readAdapterCapability(config)
    const webUi = readWebUiCapability(config as Pick<WebUiModelConfig, 'provider' | 'model' | 'customFormat'>)
    expect(webUi).toEqual(toWebUiCapability(adapter))
  })

  it.each(modelBoundaries)('keeps $provider/$model boundary capabilities equal in Adapter and WebUI', (config) => {
    const adapter = readAdapterCapability(config)
    const webUi = readWebUiCapability(config as Pick<WebUiModelConfig, 'provider' | 'model' | 'customFormat'>)
    expect(webUi).toEqual(toWebUiCapability(adapter))
  })

  it('keeps exported base maps equal for every provider', () => {
    for (const provider of CAPABILITY_PROVIDER_IDS) {
      expect(webUiCapabilities[provider]).toEqual(toWebUiCapability(adapterCapabilities[provider]))
    }
  })

  it('exposes custom dimensions only where the Adapter accepts pixel dimensions', () => {
    expect(CAPABILITY_PROVIDER_IDS.filter((provider) => webUiCapabilities[provider].supportsCustomSize)).toEqual([
      'openai',
      'seedream',
      'qwen',
      'flux',
      'comfyui',
      'codex-image-server',
      'custom-openai'
    ])
    for (const provider of CAPABILITY_PROVIDER_IDS) {
      expect(webUiCapabilities[provider].sizes.includes('自定义')).toBe(webUiCapabilities[provider].supportsCustomSize)
    }
  })

  it('does not advertise unsupported i-mini quality controls', () => {
    expect(readAdapterCapability({ provider: 'iMini', model: 'google/nano-banana-pro' }).qualityOptions).toEqual([])
    expect(providerSupportsQuality({ provider: 'iMini', model: 'google/nano-banana-pro' })).toBe(false)
    expect(readAdapterCapability({ provider: 'iMini', model: 'openai/gpt-image-2' }).qualityOptions).toEqual(['low', 'medium', 'high'])
    expect(providerSupportsQuality({ provider: 'iMini', model: 'openai/gpt-image-2' })).toBe(true)
    expect(providerSupportsQuality({ provider: 'apimart', model: 'gpt-image-2' })).toBe(false)
    expect(providerSupportsQuality({ provider: 'apimart', model: 'gpt-image-2-official' })).toBe(true)
  })

  it('removes Photoshop canvas ratios from every browser capability without changing CCX', () => {
    const browserCapabilities = readProviderCapabilitiesForRuntime('browser')
    const ccxCapability = readProviderCapabilityForRuntime(
      { provider: 'codex-image-server', model: 'gpt-image-2' },
      'photoshop-uxp'
    )

    for (const capability of Object.values(browserCapabilities)) {
      expect(capability.ratioOptions).not.toContain('画布比例')
    }
    expect(ccxCapability.ratioOptions).toContain('画布比例')
    expect(adapterCapabilities['codex-image-server'].ratioOptions).toContain('画布比例')
  })

  it('never resolves a browser request to the Photoshop canvas ratio', () => {
    const capability = adapterCapabilities['codex-image-server']

    expect(resolveProviderRatioForRuntime(capability, 'browser', '画布比例')).toBe('参考图比例')
    expect(resolveProviderRatioForRuntime(capability, 'photoshop-uxp', '画布比例')).toBe('画布比例')
    expect(adaptProviderCapabilityForRuntime(capability, 'browser').ratioOptions).not.toContain('画布比例')
  })

  it('enforces model-specific reference and output boundaries', () => {
    expect(readWebUiCapability({ provider: 'kling', model: 'kling/kling-v3-image-generation' })).toMatchObject({ referenceLimit: 1, sizes: ['1k', '2k'] })
    expect(readWebUiCapability({ provider: 'kling', model: 'kling/kling-v3-omni-image-generation' })).toMatchObject({ referenceLimit: 10, sizes: ['1k', '2k', '4k'] })
    expect(readWebUiCapability({ provider: 'flux', model: 'flux-2-klein-4b' }).referenceLimit).toBe(4)
    expect(readWebUiCapability({ provider: 'flux', model: 'flux-2-pro' }).referenceLimit).toBe(8)
    expect(readWebUiCapability({ provider: 'gemini', model: 'gemini-2.5-flash-image' })).toMatchObject({ referenceLimit: 3, sizes: ['1K'] })
    expect(readWebUiCapability({ provider: 'apimart', model: 'gpt-image-2' })).toMatchObject({ qualities: [], counts: [1] })
    expect(readWebUiCapability({ provider: 'apimart', model: 'gpt-image-2-official' })).toMatchObject({ qualities: ['auto', 'high', 'medium', 'low'], counts: [1, 2, 3, 4] })
    expect(readWebUiCapability({ provider: 'apimart', model: 'doubao-seedream-5-0-lite' })).toMatchObject({ referenceLimit: 14, counts: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15] })
    expect(readWebUiCapability({ provider: 'custom-openai', model: 'custom', customFormat: 'openai-chat' })).toMatchObject({ sizes: ['由模型决定'], qualities: [], counts: [1], ratios: ['由模型决定'], supportsCustomSize: false })
  })
})

import type { ImageProviderId, ModelConfig } from '../types/mugen'
import type {
  ImageGenerationParams,
  NormalizedImageResult,
  ProviderAdapter,
  ProviderConfigValidationResult
} from './contracts'
import { isImageProviderId, validateProviderConfig } from './definitions'
import { capabilityUsesCustomModel } from '../../../inner-protocol/src/providerCapabilityData'
import {
  generateImagesWithLegacyRuntime,
  ImageApiError,
  testImageConfigWithLegacyRuntime
} from './legacyRuntime'

function createLegacyAdapter(id: ImageProviderId): ProviderAdapter {
  return Object.freeze({
    id,
    generate: generateImagesWithLegacyRuntime,
    test: testImageConfigWithLegacyRuntime
  })
}

export const providerAdapterRegistry = Object.freeze({
  openai: createLegacyAdapter('openai'),
  iMini: createLegacyAdapter('iMini'),
  gemini: createLegacyAdapter('gemini'),
  apimart: createLegacyAdapter('apimart'),
  seedream: createLegacyAdapter('seedream'),
  qwen: createLegacyAdapter('qwen'),
  kling: createLegacyAdapter('kling'),
  flux: createLegacyAdapter('flux'),
  comfyui: createLegacyAdapter('comfyui'),
  'codex-image-server': createLegacyAdapter('codex-image-server'),
  'custom-openai': createLegacyAdapter('custom-openai')
} satisfies Record<ImageProviderId, ProviderAdapter>)

export function readProviderAdapter(provider: ImageProviderId): ProviderAdapter {
  if (!isImageProviderId(provider)) {
    throw new ImageApiError('当前模型供应商不可用', 400)
  }

  return providerAdapterRegistry[provider]
}

export function validateRegisteredProviderConfig(
  config: unknown,
  expectedProvider?: ImageProviderId
): ProviderConfigValidationResult {
  const result = validateProviderConfig(config, expectedProvider)
  if (!result.valid) {
    return result
  }

  const provider = (config as ModelConfig).provider
  return providerAdapterRegistry[provider]
    ? result
    : {
        valid: false,
        issues: [{ code: 'unknown-provider', field: 'provider', message: '当前模型供应商不可用' }]
      }
}

function assertRegisteredProviderConfig(config: unknown, expectedProvider?: ImageProviderId): asserts config is ModelConfig {
  const result = validateRegisteredProviderConfig(config, expectedProvider)
  if (!result.valid) {
    throw new ImageApiError(result.issues[0]?.message ?? '模型配置无效', 400)
  }
}

export async function generateImagesWithProvider(params: ImageGenerationParams): Promise<NormalizedImageResult[]> {
  assertRegisteredProviderConfig(params.config)
  const adapter = readProviderAdapter(params.config.provider)
  assertRegisteredProviderConfig(params.config, adapter.id)
  if (params.count <= 1 || !capabilityUsesCustomModel(params.config)) return adapter.generate(params)

  let images: NormalizedImageResult[]
  try {
    images = await adapter.generate(params)
  } catch (error) {
    const unsupportedCount = error instanceof ImageApiError && [400, 422].includes(error.status) &&
      /\b(n|count|num_images|num_outputs|image_count|batch_size|candidateCount|candidate_count)\b|batch size|number of images|multiple images|only.*(?:one|1|single) image|数量|多图|多张/i.test(error.message)
    if (!unsupportedCount || params.signal?.aborted) throw error
    images = []
  }

  while (images.length < params.count) {
    if (params.signal?.aborted) throw new ImageApiError('请求已取消', 499)
    try {
      const next = await adapter.generate({ ...params, count: 1 })
      images.push(...next)
    } catch (error) {
      if (images.length && error instanceof ImageApiError) error.retryable = false
      throw error
    }
  }
  return images.slice(0, params.count)
}

export async function testImageConfig(config: ModelConfig): Promise<void> {
  assertRegisteredProviderConfig(config)
  const adapter = readProviderAdapter(config.provider)
  assertRegisteredProviderConfig(config, adapter.id)
  await adapter.test(config)
}

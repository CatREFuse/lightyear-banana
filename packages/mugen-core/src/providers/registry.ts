import type { ImageProviderId, ModelConfig } from '../types/mugen'
import type {
  ImageGenerationParams,
  NormalizedImageResult,
  ProviderAdapter,
  ProviderConfigValidationResult
} from './contracts'
import { isImageProviderId, validateProviderConfig } from './definitions'
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
  return adapter.generate(params)
}

export async function testImageConfig(config: ModelConfig): Promise<void> {
  assertRegisteredProviderConfig(config)
  const adapter = readProviderAdapter(config.provider)
  assertRegisteredProviderConfig(config, adapter.id)
  await adapter.test(config)
}

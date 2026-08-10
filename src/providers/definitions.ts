import {
  CAPABILITY_PROVIDER_IDS,
  capabilitySupportsQuality,
  capabilityUsesApiKey,
  normalizeCapabilityCustomFormat,
  providerCapabilityData,
  resolveProviderCapabilityData
} from '../../packages/inner-protocol/src/providerCapabilityData'
import type { CustomModelFormat, ImageProviderId, ModelConfig, ProviderCapability } from '../types/lightyear'
import type {
  ProviderConfigValidationIssue,
  ProviderConfigValidationResult,
  ProviderDefinition
} from './contracts'

function cloneCapability(provider: ImageProviderId): ProviderCapability {
  const capability = providerCapabilityData[provider]
  return {
    ...capability,
    id: provider,
    modelOptions: [...capability.modelOptions],
    sizeOptions: [...capability.sizeOptions],
    qualityOptions: [...capability.qualityOptions],
    countOptions: [...capability.countOptions],
    ratioOptions: [...capability.ratioOptions],
    customSize: capability.customSize ? { ...capability.customSize } : undefined
  }
}

export const providerCapabilities = Object.fromEntries(
  CAPABILITY_PROVIDER_IDS.map((provider) => [provider, cloneCapability(provider)])
) as Record<ImageProviderId, ProviderCapability>

export const providerDefinitions = Object.fromEntries(
  CAPABILITY_PROVIDER_IDS.map((provider) => [
    provider,
    {
      id: provider,
      capability: providerCapabilities[provider],
      requiresApiKey: capabilityUsesApiKey(provider),
      requiresBaseUrl: provider === 'custom-openai'
    }
  ])
) as Record<ImageProviderId, ProviderDefinition>

export function isImageProviderId(value: unknown): value is ImageProviderId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(providerDefinitions, value)
}

export function validateProviderConfig(
  config: unknown,
  expectedProvider?: ImageProviderId
): ProviderConfigValidationResult {
  const issues: ProviderConfigValidationIssue[] = []
  if (!config || typeof config !== 'object') {
    return {
      valid: false,
      issues: [{ code: 'invalid-config', field: 'config', message: '模型配置无效' }]
    }
  }

  const candidate = config as Partial<ModelConfig>
  if (!isImageProviderId(candidate.provider)) {
    issues.push({ code: 'unknown-provider', field: 'provider', message: '当前模型供应商不可用' })
  } else if (expectedProvider && candidate.provider !== expectedProvider) {
    issues.push({ code: 'provider-mismatch', field: 'provider', message: '模型供应商与适配器不匹配' })
  }

  if (typeof candidate.model !== 'string' || !candidate.model.trim()) {
    issues.push({ code: 'missing-model', field: 'model', message: '请选择模型' })
  }

  if (isImageProviderId(candidate.provider)) {
    const definition = providerDefinitions[candidate.provider]
    if (definition.requiresApiKey && (typeof candidate.apiKey !== 'string' || !candidate.apiKey.trim())) {
      issues.push({ code: 'missing-api-key', field: 'apiKey', message: '请输入 API Key' })
    }

    if (
      definition.requiresBaseUrl
      && (typeof candidate.baseUrl !== 'string' || !candidate.baseUrl.trim())
    ) {
      issues.push({ code: 'missing-base-url', field: 'baseUrl', message: '请输入 Base URL' })
    }
  }

  return issues.length ? { valid: false, issues } : { valid: true, issues: [] }
}

export function normalizeCustomModelFormat(format: string | undefined): Exclude<CustomModelFormat, 'openai'> {
  return normalizeCapabilityCustomFormat(format)
}

export function providerSupportsQuality(config: Pick<ModelConfig, 'provider' | 'model'>) {
  return capabilitySupportsQuality(config)
}

export function readProviderCapability(
  config: Pick<ModelConfig, 'provider' | 'model' | 'customFormat'>
): ProviderCapability {
  return resolveProviderCapabilityData(config)
}

export function providerRequiresApiKey(provider: ImageProviderId) {
  return capabilityUsesApiKey(provider)
}

export const defaultModelConfigs: ModelConfig[] = []

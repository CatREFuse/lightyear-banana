import {
  CAPABILITY_PROVIDER_IDS,
  capabilityUsesApiKey,
  providerCapabilityData,
  resolveProviderCapabilityData
} from './providerCapabilityData'
import type { SerializableProviderCapability } from './providerCapabilityData'
import type { ModelConfig, ProviderCapability, ProviderId } from './index'

function toProtocolCapability(capability: SerializableProviderCapability): ProviderCapability {
  const sizes = capability.supportsCustomSize && !capability.sizeOptions.includes('自定义')
    ? [...capability.sizeOptions, '自定义']
    : [...capability.sizeOptions]

  return {
    id: capability.id,
    name: capability.name,
    models: [...capability.modelOptions],
    referenceLimit: capability.referenceLimit,
    sizes,
    qualities: [...capability.qualityOptions],
    counts: [...capability.countOptions],
    ratios: [...capability.ratioOptions],
    supportsCustomSize: capability.supportsCustomSize,
    customSize: capability.customSize ? { ...capability.customSize } : undefined
  }
}

export const providerCapabilities = Object.fromEntries(
  CAPABILITY_PROVIDER_IDS.map((provider) => [provider, toProtocolCapability(providerCapabilityData[provider])])
) as Record<ProviderId, ProviderCapability>

export function readProviderCapability(config?: Pick<ModelConfig, 'provider' | 'model' | 'customFormat'>): ProviderCapability {
  return toProtocolCapability(resolveProviderCapabilityData(config))
}

export function providerUsesApiKey(provider: ProviderId) {
  return capabilityUsesApiKey(provider)
}

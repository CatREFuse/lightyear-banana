import {
  defaultModelConfigs,
  normalizeCustomModelFormat,
  providerCapabilities,
  providerDefinitions,
  providerRequiresApiKey,
  providerSupportsQuality,
  readProviderCapability,
  validateProviderConfig
} from '../providers/definitions'
import type { ImageProviderId, ModelConfig, ProviderCapability, RuntimeName } from '../types/mugen'

export {
  defaultModelConfigs,
  normalizeCustomModelFormat,
  providerCapabilities,
  providerDefinitions,
  providerRequiresApiKey,
  providerSupportsQuality,
  readProviderCapability,
  validateProviderConfig
}

export const photoshopCanvasRatioOption = '画布比例'

export function adaptProviderCapabilityForRuntime(
  capability: ProviderCapability,
  runtime: RuntimeName
): ProviderCapability {
  if (runtime !== 'browser' || !capability.ratioOptions.includes(photoshopCanvasRatioOption)) {
    return capability
  }

  return {
    ...capability,
    ratioOptions: capability.ratioOptions.filter((option) => option !== photoshopCanvasRatioOption)
  }
}

export function readProviderCapabilityForRuntime(
  config: Pick<ModelConfig, 'provider' | 'model' | 'customFormat'>,
  runtime: RuntimeName
): ProviderCapability {
  return adaptProviderCapabilityForRuntime(readProviderCapability(config), runtime)
}

export function readProviderCapabilitiesForRuntime(
  runtime: RuntimeName
): Record<ImageProviderId, ProviderCapability> {
  if (runtime !== 'browser') {
    return providerCapabilities
  }

  return Object.fromEntries(
    Object.entries(providerCapabilities).map(([provider, capability]) => [
      provider,
      adaptProviderCapabilityForRuntime(capability, runtime)
    ])
  ) as Record<ImageProviderId, ProviderCapability>
}

export function resolveProviderRatioForRuntime(
  capability: ProviderCapability,
  runtime: RuntimeName,
  requestedRatio: string
): string {
  if (requestedRatio === '自定义') {
    return requestedRatio
  }

  const runtimeCapability = adaptProviderCapabilityForRuntime(capability, runtime)
  if (runtimeCapability.ratioOptions.includes(requestedRatio)) {
    return requestedRatio
  }

  return runtimeCapability.ratioOptions.find((option) => option === '原图比例')
    ?? runtimeCapability.ratioOptions[0]
    ?? ''
}

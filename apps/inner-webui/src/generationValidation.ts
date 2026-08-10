import {
  validateProviderGenerationParameters,
  type ModelConfig,
  type ProviderGenerationValidationResult
} from '@lightyear-banana/inner-protocol'

export const CUSTOM_SIZE_OPTION = '自定义'

export type ComposerGenerationParameters = {
  selectedSize: string
  customWidth: number | string
  customHeight: number | string
  quality: string
  count: number
  ratio: string
  referenceCount: number
}

export function formatComposerSize(width: number | string, height: number | string) {
  return `${String(width).trim()}x${String(height).trim()}`
}

export function validateComposerGeneration(
  config: Pick<ModelConfig, 'provider' | 'model' | 'customFormat'>,
  parameters: ComposerGenerationParameters
): ProviderGenerationValidationResult {
  return validateProviderGenerationParameters(config, {
    size: parameters.selectedSize === CUSTOM_SIZE_OPTION
      ? formatComposerSize(parameters.customWidth, parameters.customHeight)
      : parameters.selectedSize,
    quality: parameters.quality,
    count: parameters.count,
    ratio: parameters.ratio,
    referenceCount: parameters.referenceCount
  })
}

export function readCustomDimensions(value: string) {
  const match = /^(\d+)x(\d+)$/i.exec(value.trim())
  if (!match) return undefined
  return { width: Number(match[1]), height: Number(match[2]) }
}

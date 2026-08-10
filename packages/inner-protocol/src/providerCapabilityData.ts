export const CAPABILITY_PROVIDER_IDS = [
  'openai',
  'iMini',
  'gemini',
  'apimart',
  'seedream',
  'qwen',
  'kling',
  'flux',
  'comfyui',
  'codex-image-server',
  'custom-openai'
] as const

export type CapabilityProviderId = typeof CAPABILITY_PROVIDER_IDS[number]
export type CapabilityCustomFormat = 'openai' | 'openai-images' | 'openai-chat' | 'gemini'

export type ProviderCapabilityConfig = {
  provider: CapabilityProviderId
  model: string
  customFormat?: CapabilityCustomFormat
}

export type SerializableCustomSizeConstraint = {
  minWidth: number
  maxWidth: number
  minHeight: number
  maxHeight: number
  step: number
  minPixels: number
  maxPixels: number
  maxAspectRatio: number
}

export type SerializableProviderCapability = {
  id: CapabilityProviderId
  name: string
  modelOptions: string[]
  referenceLimit: number
  sizeOptions: string[]
  qualityOptions: string[]
  countOptions: number[]
  ratioOptions: string[]
  supportsCustomSize: boolean
  customSize?: SerializableCustomSizeConstraint
  supportsBaseUrl: boolean
  officialBaseUrl?: string
}

export type ProviderGenerationParameters = {
  size: string
  quality: string
  count: number
  ratio: string
  referenceCount: number
}

export type ProviderGenerationValidationCode =
  | 'SIZE_UNSUPPORTED'
  | 'CUSTOM_SIZE_FORMAT'
  | 'CUSTOM_SIZE_INTEGER'
  | 'CUSTOM_SIZE_RANGE'
  | 'CUSTOM_SIZE_STEP'
  | 'CUSTOM_SIZE_PIXELS'
  | 'CUSTOM_SIZE_RATIO'
  | 'QUALITY_UNSUPPORTED'
  | 'COUNT_UNSUPPORTED'
  | 'RATIO_UNSUPPORTED'
  | 'REFERENCE_LIMIT'

export type ProviderGenerationValidationResult =
  | { valid: true; dimensions?: { width: number; height: number } }
  | { valid: false; code: ProviderGenerationValidationCode; message: string }

const gptImageQualityOptions = ['auto', 'high', 'medium', 'low']
const openAiImageSizeOptions = ['auto', '1024x1024', '1536x1024', '1024x1536']
const resolutionSizeOptions = ['1k', '2k', '4k']
const apimartGemini31RatioOptions = ['原图比例', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '21:9', '1:4', '4:1', '1:8', '8:1']
const apimartGeminiProRatioOptions = ['原图比例', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
const apimartGptImage1RatioOptions = ['原图比例', '1:1', '3:2', '2:3']
const apimartGptImage2RatioOptions = ['原图比例', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '2:1', '1:2', '3:1', '1:3', '21:9', '9:21']
const apimartSeedream5LiteRatioOptions = ['原图比例', '1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9']
const iMiniStandardRatioOptions = ['原图比例', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
const iMiniNanoBanana2RatioOptions = [...iMiniStandardRatioOptions, '1:4', '1:8', '4:1', '8:1']
const iMiniGptImage2RatioOptions = [...iMiniStandardRatioOptions, '9:21']

const gptImage2CustomSize: SerializableCustomSizeConstraint = {
  minWidth: 16,
  maxWidth: 3840,
  minHeight: 16,
  maxHeight: 3840,
  step: 16,
  minPixels: 655_360,
  maxPixels: 8_294_400,
  maxAspectRatio: 3
}

const genericOpenAiCustomSize: SerializableCustomSizeConstraint = {
  minWidth: 256,
  maxWidth: 4096,
  minHeight: 256,
  maxHeight: 4096,
  step: 1,
  minPixels: 1024 * 1024,
  maxPixels: 4096 * 4096,
  maxAspectRatio: 16
}

const seedreamCustomSize: SerializableCustomSizeConstraint = {
  minWidth: 720,
  maxWidth: 4096,
  minHeight: 720,
  maxHeight: 4096,
  step: 1,
  minPixels: 1280 * 720,
  maxPixels: 4096 * 4096,
  maxAspectRatio: 16
}

const qwenCustomSize: SerializableCustomSizeConstraint = {
  minWidth: 512,
  maxWidth: 2048,
  minHeight: 512,
  maxHeight: 2048,
  step: 1,
  minPixels: 512 * 512,
  maxPixels: 2048 * 2048,
  maxAspectRatio: 4
}

const fluxCustomSize: SerializableCustomSizeConstraint = {
  minWidth: 256,
  maxWidth: 4096,
  minHeight: 256,
  maxHeight: 4096,
  step: 16,
  minPixels: 1024 * 1024,
  maxPixels: 2048 * 2048,
  maxAspectRatio: 16
}

const comfyUiCustomSize: SerializableCustomSizeConstraint = {
  minWidth: 256,
  maxWidth: 4096,
  minHeight: 256,
  maxHeight: 4096,
  step: 8,
  minPixels: 256 * 256,
  maxPixels: 4096 * 4096,
  maxAspectRatio: 16
}

export const providerCapabilityData: Record<CapabilityProviderId, SerializableProviderCapability> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    modelOptions: ['gpt-image-2'],
    referenceLimit: 16,
    sizeOptions: openAiImageSizeOptions,
    qualityOptions: gptImageQualityOptions,
    countOptions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    ratioOptions: ['原图比例'],
    supportsCustomSize: true,
    customSize: gptImage2CustomSize,
    supportsBaseUrl: false,
    officialBaseUrl: 'https://api.openai.com'
  },
  iMini: {
    id: 'iMini',
    name: 'i-mini',
    modelOptions: ['google/nano-banana', 'google/nano-banana-pro', 'google/nano-banana-2', 'openai/gpt-image-2'],
    referenceLimit: 14,
    sizeOptions: ['1K', '2K', '4K'],
    qualityOptions: [],
    countOptions: [1],
    ratioOptions: iMiniStandardRatioOptions,
    supportsCustomSize: false,
    supportsBaseUrl: true,
    officialBaseUrl: 'https://openapi.imini.ai/imini/router'
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    modelOptions: [
      'nano-banana-4k',
      'nano-banana-pro-4k',
      'gemini-3-pro-image-preview-4k',
      'gemini-3.1-flash-image-preview',
      'gemini-3-pro-image-preview',
      'gemini-2.5-flash-image'
    ],
    referenceLimit: 14,
    sizeOptions: resolutionSizeOptions,
    qualityOptions: ['自动'],
    countOptions: [1],
    ratioOptions: iMiniStandardRatioOptions,
    supportsCustomSize: false,
    supportsBaseUrl: false,
    officialBaseUrl: 'https://generativelanguage.googleapis.com'
  },
  apimart: {
    id: 'apimart',
    name: 'APIMart',
    modelOptions: [
      'gemini-3.1-flash-image-preview',
      'gemini-3.1-flash-image-preview-official',
      'gemini-3-pro-image-preview',
      'gemini-3-pro-image-preview-official',
      'gpt-image-2',
      'gpt-image-2-official',
      'gpt-image-1-official',
      'gpt-image-1.5-official',
      'doubao-seedream-5-0-lite'
    ],
    referenceLimit: 14,
    sizeOptions: ['0.5K', '1K', '2K', '4K'],
    qualityOptions: ['自动'],
    countOptions: [1, 2, 3, 4],
    ratioOptions: apimartGemini31RatioOptions,
    supportsCustomSize: false,
    supportsBaseUrl: false,
    officialBaseUrl: 'https://api.apimart.ai'
  },
  seedream: {
    id: 'seedream',
    name: 'ByteDance Seedream',
    modelOptions: ['seedream-4-0-250828'],
    referenceLimit: 10,
    sizeOptions: resolutionSizeOptions,
    qualityOptions: ['自动'],
    countOptions: [1, 2, 3, 4],
    ratioOptions: ['原图比例'],
    supportsCustomSize: true,
    customSize: seedreamCustomSize,
    supportsBaseUrl: false,
    officialBaseUrl: 'https://ark.ap-southeast.bytepluses.com'
  },
  qwen: {
    id: 'qwen',
    name: 'Alibaba Qwen',
    modelOptions: ['qwen-image-2.0-pro', 'qwen-image-2.0', 'qwen-image-edit-max', 'qwen-image-edit-plus'],
    referenceLimit: 3,
    sizeOptions: resolutionSizeOptions,
    qualityOptions: ['自动'],
    countOptions: [1, 2, 3, 4, 5, 6],
    ratioOptions: ['原图比例'],
    supportsCustomSize: true,
    customSize: qwenCustomSize,
    supportsBaseUrl: false,
    officialBaseUrl: 'https://dashscope.aliyuncs.com'
  },
  kling: {
    id: 'kling',
    name: 'Kuaishou Kling',
    modelOptions: ['kling/kling-v3-image-generation', 'kling/kling-v3-omni-image-generation'],
    referenceLimit: 10,
    sizeOptions: ['1k', '2k', '4k'],
    qualityOptions: ['自动'],
    countOptions: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    ratioOptions: ['16:9', '9:16', '1:1'],
    supportsCustomSize: false,
    supportsBaseUrl: false,
    officialBaseUrl: 'https://dashscope.aliyuncs.com'
  },
  flux: {
    id: 'flux',
    name: 'Black Forest Labs',
    modelOptions: [
      'flux-2-pro-preview',
      'flux-2-pro',
      'flux-2-max',
      'flux-2-flex',
      'flux-2-klein-9b-preview',
      'flux-2-klein-9b',
      'flux-2-klein-4b'
    ],
    referenceLimit: 8,
    sizeOptions: resolutionSizeOptions,
    qualityOptions: ['自动'],
    countOptions: [1],
    ratioOptions: ['原图比例'],
    supportsCustomSize: true,
    customSize: fluxCustomSize,
    supportsBaseUrl: false,
    officialBaseUrl: 'https://api.bfl.ai'
  },
  comfyui: {
    id: 'comfyui',
    name: '本地 ComfyUI',
    modelOptions: ['workflow-api-json'],
    referenceLimit: 8,
    sizeOptions: ['按工作流'],
    qualityOptions: ['按工作流'],
    countOptions: [1],
    ratioOptions: ['按工作流'],
    supportsCustomSize: true,
    customSize: comfyUiCustomSize,
    supportsBaseUrl: true
  },
  'codex-image-server': {
    id: 'codex-image-server',
    name: 'Codex Image Server',
    modelOptions: ['gpt-image-2'],
    referenceLimit: 16,
    sizeOptions: resolutionSizeOptions,
    qualityOptions: gptImageQualityOptions,
    countOptions: [1, 2, 3, 4],
    ratioOptions: ['参考图比例', '画布比例', '1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '21:9'],
    supportsCustomSize: true,
    customSize: gptImage2CustomSize,
    supportsBaseUrl: true
  },
  'custom-openai': {
    id: 'custom-openai',
    name: '自定义模型',
    modelOptions: ['custom-image-model'],
    referenceLimit: 16,
    sizeOptions: openAiImageSizeOptions,
    qualityOptions: [],
    countOptions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    ratioOptions: ['原图比例'],
    supportsCustomSize: true,
    customSize: genericOpenAiCustomSize,
    supportsBaseUrl: true
  }
}

function cloneCapability(capability: SerializableProviderCapability): SerializableProviderCapability {
  return {
    ...capability,
    modelOptions: [...capability.modelOptions],
    sizeOptions: [...capability.sizeOptions],
    qualityOptions: [...capability.qualityOptions],
    countOptions: [...capability.countOptions],
    ratioOptions: [...capability.ratioOptions],
    customSize: capability.customSize ? { ...capability.customSize } : undefined
  }
}

export function normalizeCapabilityCustomFormat(format: string | undefined): Exclude<CapabilityCustomFormat, 'openai'> {
  return format === 'openai-chat' || format === 'gemini' ? format : 'openai-images'
}

function readOpenAiQualityOptions(model: string) {
  if (/^dall-e-2$/i.test(model)) return ['standard']
  if (/^dall-e-3$/i.test(model)) return ['standard', 'hd']
  return [...gptImageQualityOptions]
}

function isApimartGemini31ImageModel(model: string) {
  return /^(?:gemini-3\.1-flash-image-preview(?:-official)?|nano-banana-2(?:-ext)?)$/i.test(model)
}

function isApimartProImageModel(model: string) {
  return /^(?:gemini-3-pro-image-preview(?:-official)?|nano-banana-pro(?:-ext)?)$/i.test(model)
}

function isApimartGptImage1Model(model: string) {
  return /^gpt-image-1(?:\.5)?-official$/i.test(model)
}

function isApimartGptImage2Model(model: string) {
  return /^gpt-image-2(?:-official)?$/i.test(model)
}

function isApimartGptImage2OfficialModel(model: string) {
  return /^gpt-image-2-official$/i.test(model)
}

function isApimartSeedream5LiteModel(model: string) {
  return /^doubao-seedream-5(?:[-.]0)?-lite$/i.test(model)
}

function readApimartCapability(config: ProviderCapabilityConfig, base: SerializableProviderCapability) {
  if (isApimartGptImage1Model(config.model)) {
    return {
      ...base,
      referenceLimit: 15,
      sizeOptions: ['默认'],
      qualityOptions: [...gptImageQualityOptions],
      countOptions: [1, 2, 3, 4],
      ratioOptions: [...apimartGptImage1RatioOptions],
      supportsCustomSize: false
    }
  }

  if (isApimartGptImage2Model(config.model)) {
    const official = isApimartGptImage2OfficialModel(config.model)
    return {
      ...base,
      referenceLimit: 16,
      sizeOptions: [...resolutionSizeOptions],
      qualityOptions: official ? [...gptImageQualityOptions] : [],
      countOptions: official ? [1, 2, 3, 4] : [1],
      ratioOptions: [...apimartGptImage2RatioOptions],
      supportsCustomSize: false
    }
  }

  if (isApimartSeedream5LiteModel(config.model)) {
    return {
      ...base,
      referenceLimit: 14,
      sizeOptions: ['2K', '3K', '4K'],
      qualityOptions: [],
      countOptions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      ratioOptions: [...apimartSeedream5LiteRatioOptions],
      supportsCustomSize: false
    }
  }

  if (isApimartProImageModel(config.model)) {
    return {
      ...base,
      referenceLimit: 14,
      sizeOptions: ['1K', '2K', '4K'],
      qualityOptions: [],
      countOptions: [1, 2, 3, 4],
      ratioOptions: [...apimartGeminiProRatioOptions],
      supportsCustomSize: false
    }
  }

  if (isApimartGemini31ImageModel(config.model)) {
    return {
      ...base,
      referenceLimit: 14,
      sizeOptions: ['0.5K', '1K', '2K', '4K'],
      qualityOptions: [],
      countOptions: [1, 2, 3, 4],
      ratioOptions: [...apimartGemini31RatioOptions],
      supportsCustomSize: false
    }
  }

  return base
}

function readIMiniCapability(config: ProviderCapabilityConfig, base: SerializableProviderCapability) {
  if (/^google\/nano-banana$/i.test(config.model)) {
    return { ...base, referenceLimit: 3, sizeOptions: ['1K'], qualityOptions: [], countOptions: [1], ratioOptions: [...iMiniStandardRatioOptions] }
  }

  if (/^google\/nano-banana-2$/i.test(config.model)) {
    return { ...base, referenceLimit: 14, sizeOptions: ['512', '1K', '2K', '4K'], qualityOptions: [], countOptions: [1], ratioOptions: [...iMiniNanoBanana2RatioOptions] }
  }

  if (/^openai\/gpt-image-2$/i.test(config.model)) {
    return {
      ...base,
      referenceLimit: 3,
      sizeOptions: ['1K', '2K', '4K'],
      qualityOptions: ['low', 'medium', 'high'],
      countOptions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      ratioOptions: [...iMiniGptImage2RatioOptions]
    }
  }

  return base
}

export function resolveProviderCapabilityData(config?: ProviderCapabilityConfig): SerializableProviderCapability {
  if (!config) return cloneCapability(providerCapabilityData.openai)
  const base = cloneCapability(providerCapabilityData[config.provider] ?? providerCapabilityData.openai)

  if (config.provider === 'custom-openai') {
    const format = normalizeCapabilityCustomFormat(config.customFormat)
    if (format === 'gemini') {
      const gemini = providerCapabilityData.gemini
      return {
        ...base,
        referenceLimit: gemini.referenceLimit,
        sizeOptions: [...gemini.sizeOptions],
        qualityOptions: [],
        countOptions: [...gemini.countOptions],
        ratioOptions: [...gemini.ratioOptions],
        supportsCustomSize: gemini.supportsCustomSize,
        customSize: undefined
      }
    }
    if (format === 'openai-chat') {
      return {
        ...base,
        sizeOptions: ['由模型决定'],
        qualityOptions: [],
        countOptions: [1],
        ratioOptions: ['由模型决定'],
        supportsCustomSize: false,
        customSize: undefined
      }
    }
    return {
      ...base,
      customSize: /^gpt-image-2$/i.test(config.model)
        ? { ...gptImage2CustomSize }
        : { ...genericOpenAiCustomSize }
    }
  }

  if (config.provider === 'apimart') return readApimartCapability(config, base)
  if (config.provider === 'iMini') return readIMiniCapability(config, base)
  if (config.provider === 'kling') {
    if (/^kling\/kling-v3-omni-image-generation$/i.test(config.model)) return base
    return { ...base, referenceLimit: 1, sizeOptions: ['1k', '2k'] }
  }
  if (config.provider === 'flux' && /(?:^|-)klein(?:-|$)/i.test(config.model)) {
    return { ...base, referenceLimit: 4 }
  }
  if (config.provider === 'gemini' && /^gemini-2\.5-flash-image$/i.test(config.model)) {
    return { ...base, referenceLimit: 3, sizeOptions: ['1K'] }
  }
  if (config.provider === 'openai') {
    return {
      ...base,
      qualityOptions: readOpenAiQualityOptions(config.model),
      customSize: /^gpt-image-2$/i.test(config.model)
        ? { ...gptImage2CustomSize }
        : { ...genericOpenAiCustomSize }
    }
  }

  return base
}

export function capabilityUsesApiKey(provider: CapabilityProviderId) {
  return provider !== 'comfyui' && provider !== 'codex-image-server'
}

export function capabilitySupportsQuality(config: Pick<ProviderCapabilityConfig, 'provider' | 'model'>) {
  return config.provider === 'openai'
    || config.provider === 'codex-image-server'
    || (config.provider === 'iMini' && /^openai\/gpt-image-2$/i.test(config.model))
    || (config.provider === 'apimart' && (isApimartGptImage1Model(config.model) || isApimartGptImage2OfficialModel(config.model)))
}

function formatPixelCount(value: number) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function invalidGenerationParameters(
  code: ProviderGenerationValidationCode,
  message: string
): ProviderGenerationValidationResult {
  return { valid: false, code, message }
}

function readCustomDimensions(value: string): ProviderGenerationValidationResult {
  const match = /^\s*([^x*×]+?)\s*[x*×]\s*([^x*×]+?)\s*$/i.exec(value)
  if (!match) return invalidGenerationParameters('CUSTOM_SIZE_FORMAT', '请填写完整的宽度和高度')
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return invalidGenerationParameters('CUSTOM_SIZE_FORMAT', '请填写有效的宽度和高度')
  }
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    return invalidGenerationParameters('CUSTOM_SIZE_INTEGER', '宽度和高度需要填写整数')
  }
  return { valid: true, dimensions: { width, height } }
}

function validateCustomDimensions(
  value: string,
  constraint: SerializableCustomSizeConstraint
): ProviderGenerationValidationResult {
  const parsed = readCustomDimensions(value)
  if (!parsed.valid || !parsed.dimensions) return parsed
  const { width, height } = parsed.dimensions
  if (
    width < constraint.minWidth || width > constraint.maxWidth
    || height < constraint.minHeight || height > constraint.maxHeight
  ) {
    return invalidGenerationParameters(
      'CUSTOM_SIZE_RANGE',
      `宽度需在 ${constraint.minWidth}–${constraint.maxWidth} 像素之间，高度需在 ${constraint.minHeight}–${constraint.maxHeight} 像素之间`
    )
  }
  if (width % constraint.step !== 0 || height % constraint.step !== 0) {
    return invalidGenerationParameters('CUSTOM_SIZE_STEP', `宽度和高度需为 ${constraint.step} 的倍数`)
  }
  const pixels = width * height
  if (pixels < constraint.minPixels || pixels > constraint.maxPixels) {
    return invalidGenerationParameters(
      'CUSTOM_SIZE_PIXELS',
      `总像素需在 ${formatPixelCount(constraint.minPixels)}–${formatPixelCount(constraint.maxPixels)} 之间`
    )
  }
  if (Math.max(width, height) / Math.min(width, height) > constraint.maxAspectRatio) {
    return invalidGenerationParameters('CUSTOM_SIZE_RATIO', `长边不能超过短边的 ${constraint.maxAspectRatio} 倍`)
  }
  return parsed
}

export function validateProviderGenerationParameters(
  config: ProviderCapabilityConfig,
  parameters: ProviderGenerationParameters
): ProviderGenerationValidationResult {
  const capability = resolveProviderCapabilityData(config)
  let dimensions: { width: number; height: number } | undefined

  if (!capability.sizeOptions.includes(parameters.size)) {
    if (!capability.supportsCustomSize || !capability.customSize) {
      return invalidGenerationParameters('SIZE_UNSUPPORTED', '请选择当前模型支持的尺寸')
    }
    const customSize = validateCustomDimensions(parameters.size, capability.customSize)
    if (!customSize.valid) return customSize
    dimensions = customSize.dimensions
  }

  if (capability.qualityOptions.length) {
    if (!capability.qualityOptions.includes(parameters.quality)) {
      return invalidGenerationParameters('QUALITY_UNSUPPORTED', '请选择当前模型支持的质量')
    }
  } else if (parameters.quality !== '' && parameters.quality !== '自动') {
    return invalidGenerationParameters('QUALITY_UNSUPPORTED', '当前模型不支持调整质量')
  }

  if (!Number.isInteger(parameters.count) || !capability.countOptions.includes(parameters.count)) {
    return invalidGenerationParameters('COUNT_UNSUPPORTED', '请选择当前模型支持的图片数量')
  }
  if (!capability.ratioOptions.includes(parameters.ratio)) {
    return invalidGenerationParameters('RATIO_UNSUPPORTED', '请选择当前模型支持的图片比例')
  }
  if (
    !Number.isInteger(parameters.referenceCount)
    || parameters.referenceCount < 0
    || parameters.referenceCount > capability.referenceLimit
  ) {
    return invalidGenerationParameters('REFERENCE_LIMIT', `当前模型最多支持 ${capability.referenceLimit} 张参考图`)
  }

  return dimensions ? { valid: true, dimensions } : { valid: true }
}

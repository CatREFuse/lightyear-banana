import type { CustomModelFormat, ImageProviderId, ModelConfig, ProviderCapability } from '../types/lightyear'

const gptImageQualityOptions = ['auto', 'high', 'medium', 'low']
const customSizeOptions = ['1k', '2k', '4k']

export const providerCapabilities: Record<ImageProviderId, ProviderCapability> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    modelOptions: ['gpt-image-2'],
    referenceLimit: 16,
    sizeOptions: ['auto', '1024x1024', '1536x1024', '1024x1536'],
    qualityOptions: gptImageQualityOptions,
    countOptions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    ratioOptions: ['原图比例'],
    supportsBaseUrl: false,
    officialBaseUrl: 'https://api.openai.com'
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
    sizeOptions: customSizeOptions,
    qualityOptions: ['自动'],
    countOptions: [1],
    ratioOptions: ['原图比例', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    supportsBaseUrl: false,
    officialBaseUrl: 'https://generativelanguage.googleapis.com',
    modelOverrides: {
      'nano-banana-4k': {
        sizeOptions: ['4k']
      },
      'nano-banana-pro-4k': {
        sizeOptions: ['4k']
      },
      'gemini-3-pro-image-preview-4k': {
        sizeOptions: ['4k']
      },
      'gemini-2.5-flash-image': {
        referenceLimit: 3,
        sizeOptions: ['默认'],
        ratioOptions: ['原图比例', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
      }
    }
  },
  seedream: {
    id: 'seedream',
    name: 'ByteDance Seedream',
    modelOptions: ['seedream-4-0-250828'],
    referenceLimit: 10,
    sizeOptions: customSizeOptions,
    qualityOptions: ['自动'],
    countOptions: [1, 2, 3, 4],
    ratioOptions: ['原图比例'],
    supportsBaseUrl: false,
    officialBaseUrl: 'https://ark.ap-southeast.bytepluses.com'
  },
  qwen: {
    id: 'qwen',
    name: 'Alibaba Qwen',
    modelOptions: ['qwen-image-2.0-pro', 'qwen-image-2.0', 'qwen-image-edit-max', 'qwen-image-edit-plus'],
    referenceLimit: 3,
    sizeOptions: customSizeOptions,
    qualityOptions: ['自动'],
    countOptions: [1, 2, 3, 4, 5, 6],
    ratioOptions: ['原图比例'],
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
    supportsBaseUrl: false,
    officialBaseUrl: 'https://dashscope.aliyuncs.com',
    modelOverrides: {
      'kling/kling-v3-image-generation': {
        referenceLimit: 1,
        sizeOptions: ['1k', '2k']
      }
    }
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
    sizeOptions: customSizeOptions,
    qualityOptions: ['自动'],
    countOptions: [1],
    ratioOptions: ['原图比例'],
    supportsBaseUrl: false,
    officialBaseUrl: 'https://api.bfl.ai',
    modelOverrides: {
      'flux-2-klein-9b-preview': {
        referenceLimit: 4
      },
      'flux-2-klein-9b': {
        referenceLimit: 4
      },
      'flux-2-klein-4b': {
        referenceLimit: 4
      }
    }
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
    supportsBaseUrl: true
  },
  'codex-image-server': {
    id: 'codex-image-server',
    name: 'Codex Image Server',
    modelOptions: ['gpt-image-2'],
    referenceLimit: 16,
    sizeOptions: customSizeOptions,
    qualityOptions: gptImageQualityOptions,
    countOptions: [1, 2, 3, 4],
    ratioOptions: ['参考图比例', '画布比例', '1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '21:9'],
    supportsBaseUrl: true
  },
  'custom-openai': {
    id: 'custom-openai',
    name: '自定义模型',
    modelOptions: [
      'gpt-image-2',
      'gpt-image-1.5',
      'gpt-image-1',
      'gemini-3-pro-image-preview-4k',
      'gemini-3-pro-image-preview',
      'nano-banana-pro-4k',
      'nano-banana-4k',
      'doubao-seedream-5-0-260128',
      'doubao-seedream-4-5-251128',
      'qwen-image-plus',
      'qwen-image-edit-plus'
    ],
    referenceLimit: 16,
    sizeOptions: customSizeOptions,
    qualityOptions: [],
    countOptions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    ratioOptions: ['原图比例', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    supportsBaseUrl: true
  }
}

const customFormatCapabilityOverrides: Record<Exclude<CustomModelFormat, 'openai'>, Partial<ProviderCapability>> = {
  'openai-images': {
    referenceLimit: 10,
    sizeOptions: customSizeOptions,
    qualityOptions: [],
    countOptions: [1, 2, 3, 4],
    ratioOptions: ['原图比例']
  },
  'openai-chat': {
    referenceLimit: 16,
    sizeOptions: customSizeOptions,
    qualityOptions: [],
    countOptions: [1],
    ratioOptions: ['原图比例', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
  },
  gemini: {
    referenceLimit: 14,
    sizeOptions: customSizeOptions,
    qualityOptions: [],
    countOptions: [1],
    ratioOptions: ['原图比例', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
  },
  qwen: {
    referenceLimit: 3,
    sizeOptions: customSizeOptions,
    qualityOptions: [],
    countOptions: [1, 2, 3, 4, 5, 6],
    ratioOptions: ['原图比例']
  }
}

const customModelCapabilityOverrides: Array<{
  format: Exclude<CustomModelFormat, 'openai'>
  modelPattern: RegExp
  override: Partial<ProviderCapability>
}> = [
  {
    format: 'openai-images',
    modelPattern: /^doubao-seedream-(?:4-5|5)-/i,
    override: {
      sizeOptions: customSizeOptions
    }
  }
]

export function normalizeCustomModelFormat(format: CustomModelFormat | undefined): Exclude<CustomModelFormat, 'openai'> {
  return format === 'openai-chat' || format === 'gemini' || format === 'qwen' ? format : 'openai-images'
}

function readOpenAiQualityOptions(model: string) {
  if (/^dall-e-2$/i.test(model)) {
    return ['standard']
  }

  if (/^dall-e-3$/i.test(model)) {
    return ['standard', 'hd']
  }

  return gptImageQualityOptions
}

export function providerSupportsQuality(config: Pick<ModelConfig, 'provider' | 'customFormat'>) {
  return (
    config.provider === 'openai' ||
    config.provider === 'codex-image-server'
  )
}

export function readProviderCapability(config: Pick<ModelConfig, 'provider' | 'model' | 'customFormat'>): ProviderCapability {
  const capability = providerCapabilities[config.provider]
  if (config.provider === 'custom-openai') {
    const customFormat = normalizeCustomModelFormat(config.customFormat)
    const formatOverride = customFormatCapabilityOverrides[customFormat]
    const modelOverride = customModelCapabilityOverrides.find(
      (item) => item.format === customFormat && item.modelPattern.test(config.model)
    )?.override

    return { ...capability, ...formatOverride, ...modelOverride }
  }

  const override = capability.modelOverrides?.[config.model]
  const qualityOptions = providerSupportsQuality(config) ? readOpenAiQualityOptions(config.model) : []
  const resolvedCapability = { ...capability, qualityOptions }

  return override ? { ...resolvedCapability, ...override } : resolvedCapability
}

export function providerRequiresApiKey(provider: ImageProviderId) {
  return provider !== 'comfyui' && provider !== 'codex-image-server'
}

export const defaultModelConfigs: ModelConfig[] = []

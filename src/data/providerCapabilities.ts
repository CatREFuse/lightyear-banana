import type { CustomModelFormat, ImageProviderId, ModelConfig, ProviderCapability } from '../types/lightyear'

const gptImageQualityOptions = ['auto', 'high', 'medium', 'low']
const openAiImageSizeOptions = ['auto', '1024x1024', '1536x1024', '1024x1536']
const customSizeOptions = ['1k', '2k', '4k']

export const providerCapabilities: Record<ImageProviderId, ProviderCapability> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    modelOptions: ['gpt-image-2'],
    referenceLimit: 16,
    sizeOptions: openAiImageSizeOptions,
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
      'gpt-image-1-official',
      'gpt-image-1.5-official',
      'doubao-seedream-5-0-lite'
    ],
    referenceLimit: 14,
    sizeOptions: ['0.5K', '1K', '2K', '4K'],
    qualityOptions: ['自动'],
    countOptions: [1, 2, 3, 4],
    ratioOptions: ['自动', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '21:9', '1:4', '4:1', '1:8', '8:1'],
    supportsBaseUrl: false,
    officialBaseUrl: 'https://api.apimart.ai'
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
    sizeOptions: customSizeOptions,
    qualityOptions: ['自动'],
    countOptions: [1],
    ratioOptions: ['原图比例'],
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
    modelOptions: ['custom-image-model'],
    referenceLimit: 16,
    sizeOptions: openAiImageSizeOptions,
    qualityOptions: [],
    countOptions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    ratioOptions: ['原图比例'],
    supportsBaseUrl: true
  }
}

export function normalizeCustomModelFormat(format: string | undefined): Exclude<CustomModelFormat, 'openai'> {
  return format === 'openai-chat' ? 'openai-chat' : 'openai-images'
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
  const qualityOptions = providerSupportsQuality(config) ? readOpenAiQualityOptions(config.model) : []

  return { ...capability, qualityOptions }
}

export function providerRequiresApiKey(provider: ImageProviderId) {
  return provider !== 'comfyui' && provider !== 'codex-image-server'
}

export const defaultModelConfigs: ModelConfig[] = []

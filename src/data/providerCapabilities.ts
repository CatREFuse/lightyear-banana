import type { ImageProviderId, ModelConfig, ProviderCapability } from '../types/lightyear'

export const providerCapabilities: Record<ImageProviderId, ProviderCapability> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    modelOptions: ['gpt-image-2'],
    referenceLimit: 16,
    sizeOptions: ['auto', '1024x1024', '1536x1024', '1024x1536'],
    qualityOptions: ['自动', '高', '中', '低'],
    countOptions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    ratioOptions: ['原图比例'],
    supportsBaseUrl: false
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    modelOptions: ['gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview', 'gemini-2.5-flash-image'],
    referenceLimit: 14,
    sizeOptions: ['1K', '2K', '4K'],
    qualityOptions: ['自动'],
    countOptions: [1, 2, 3, 4],
    ratioOptions: ['原图比例', '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    supportsBaseUrl: false,
    modelOverrides: {
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
    sizeOptions: ['1K', '2K', '4K', '2048x2048'],
    qualityOptions: ['自动'],
    countOptions: [1, 2, 3, 4],
    ratioOptions: ['原图比例'],
    supportsBaseUrl: false
  },
  qwen: {
    id: 'qwen',
    name: 'Alibaba Qwen',
    modelOptions: ['qwen-image-2.0-pro', 'qwen-image-2.0', 'qwen-image-edit-max', 'qwen-image-edit-plus'],
    referenceLimit: 3,
    sizeOptions: ['1024*1024', '1536*1024', '1024*1536', '2048*2048'],
    qualityOptions: ['自动'],
    countOptions: [1, 2, 3, 4, 5, 6],
    ratioOptions: ['原图比例'],
    supportsBaseUrl: false
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
    sizeOptions: ['1024x1024', '1536x1024', '1024x1536', '1920x1088', '1088x1920', '2048x2048'],
    qualityOptions: ['自动'],
    countOptions: [1],
    ratioOptions: ['原图比例'],
    supportsBaseUrl: false,
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
  'custom-openai': {
    id: 'custom-openai',
    name: '自定义 BaseURL（OpenAI 兼容）',
    modelOptions: ['custom-image-model'],
    referenceLimit: 16,
    sizeOptions: ['auto', '1024x1024', '1536x1024', '1024x1536'],
    qualityOptions: ['自动', '高', '中', '低'],
    countOptions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    ratioOptions: ['原图比例'],
    supportsBaseUrl: true
  }
}

export function readProviderCapability(config: Pick<ModelConfig, 'provider' | 'model'>): ProviderCapability {
  const capability = providerCapabilities[config.provider]
  const override = capability.modelOverrides?.[config.model]

  return override ? { ...capability, ...override } : capability
}

export const defaultModelConfigs: ModelConfig[] = [
  {
    id: 'nano-banana-pro',
    name: 'Nano Banana 2',
    provider: 'gemini',
    model: 'gemini-3.1-flash-image-preview',
    apiKey: '',
    baseUrl: '',
    enabled: true
  },
  {
    id: 'gpt-image-2',
    name: 'GPT Image 2',
    provider: 'openai',
    model: 'gpt-image-2',
    apiKey: '',
    baseUrl: '',
    enabled: true
  },
  {
    id: 'seedream-4',
    name: 'Seedream 4.0',
    provider: 'seedream',
    model: 'seedream-4-0-250828',
    apiKey: '',
    baseUrl: '',
    enabled: true
  },
  {
    id: 'qwen-image-edit',
    name: 'Qwen Image 2.0 Pro',
    provider: 'qwen',
    model: 'qwen-image-2.0-pro',
    apiKey: '',
    baseUrl: '',
    enabled: true
  },
  {
    id: 'kling-v3',
    name: 'Kling V3',
    provider: 'kling',
    model: 'kling/kling-v3-omni-image-generation',
    apiKey: '',
    baseUrl: '',
    enabled: true
  },
  {
    id: 'flux-2-pro-preview',
    name: 'FLUX.2 Pro Preview',
    provider: 'flux',
    model: 'flux-2-pro-preview',
    apiKey: '',
    baseUrl: '',
    enabled: false
  },
  {
    id: 'custom-openai',
    name: '自定义 OpenAI 兼容',
    provider: 'custom-openai',
    model: 'custom-image-model',
    apiKey: '',
    baseUrl: 'https://api.example.com/v1',
    enabled: false
  }
]

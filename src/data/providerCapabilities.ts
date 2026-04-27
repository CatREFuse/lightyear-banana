import type { ImageProviderId, ModelConfig, ProviderCapability } from '../types/lightyear'

export const providerCapabilities: Record<ImageProviderId, ProviderCapability> = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    modelOptions: ['gpt-image-2'],
    referenceLimit: 16,
    sizeOptions: ['1024x1024', '1536x1024', '1024x1536', '2048x2048'],
    qualityOptions: ['自动', '高', '中', '低'],
    countOptions: [1],
    ratioOptions: ['原图比例', '1:1', '4:3', '3:4', '16:9', '9:16'],
    supportsBaseUrl: false
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    modelOptions: ['gemini-3-pro-image-preview', 'gemini-2.5-flash-image'],
    referenceLimit: 14,
    sizeOptions: ['1k', '2k', '4k'],
    qualityOptions: ['自动', '高'],
    countOptions: [1, 2, 3, 4],
    ratioOptions: ['原图比例', '1:1', '4:3', '3:4', '16:9', '9:16'],
    supportsBaseUrl: false
  },
  seedream: {
    id: 'seedream',
    name: 'ByteDance Seedream',
    modelOptions: ['seedream-4-0-250828'],
    referenceLimit: 10,
    sizeOptions: ['1k', '2k', '4k'],
    qualityOptions: ['自动', '高'],
    countOptions: [1, 2, 3, 4],
    ratioOptions: ['原图比例', '1:1', '4:3', '3:4', '16:9', '9:16'],
    supportsBaseUrl: false
  },
  qwen: {
    id: 'qwen',
    name: 'Alibaba Qwen',
    modelOptions: ['qwen-image-2.0-pro', 'qwen-image-edit-max', 'qwen-image-edit-plus'],
    referenceLimit: 3,
    sizeOptions: ['1024*1024', '1328*1328', '2048*2048'],
    qualityOptions: ['自动', '高'],
    countOptions: [1, 2, 3, 4, 5, 6],
    ratioOptions: ['原图比例', '1:1', '4:3', '3:4', '16:9', '9:16'],
    supportsBaseUrl: false
  },
  kling: {
    id: 'kling',
    name: 'Kuaishou Kling',
    modelOptions: ['kling/kling-v3-image-generation', 'kling/kling-v3-omni-image-generation'],
    referenceLimit: 10,
    sizeOptions: ['1k', '2k', '4k'],
    qualityOptions: ['自动', '高'],
    countOptions: [1, 2, 3, 4, 5, 6, 7, 8, 9],
    ratioOptions: ['原图比例', '1:1', '4:3', '3:4', '16:9', '9:16'],
    supportsBaseUrl: false
  },
  flux: {
    id: 'flux',
    name: 'Black Forest Labs',
    modelOptions: ['flux-2-pro', 'flux-2-pro-preview', 'flux-2-max', 'flux-2-flex'],
    referenceLimit: 8,
    sizeOptions: ['1MP', '2MP', '4MP'],
    qualityOptions: ['自动', '高'],
    countOptions: [1],
    ratioOptions: ['原图比例', '1:1', '4:3', '3:4', '16:9', '9:16'],
    supportsBaseUrl: false
  },
  'custom-openai': {
    id: 'custom-openai',
    name: '自定义 BaseURL（OpenAI 兼容）',
    modelOptions: ['custom-image-model'],
    referenceLimit: 16,
    sizeOptions: ['1024x1024', '1536x1024', '1024x1536', '2048x2048'],
    qualityOptions: ['自动', '高', '中', '低'],
    countOptions: [1, 2, 3, 4],
    ratioOptions: ['原图比例', '1:1', '4:3', '3:4', '16:9', '9:16'],
    supportsBaseUrl: true
  }
}

export const defaultModelConfigs: ModelConfig[] = [
  {
    id: 'nano-banana-pro',
    name: 'Nano Banana Pro',
    provider: 'gemini',
    model: 'gemini-3-pro-image-preview',
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
    name: 'Qwen Image Edit',
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
    id: 'custom-openai',
    name: '自定义 OpenAI 兼容',
    provider: 'custom-openai',
    model: 'custom-image-model',
    apiKey: '',
    baseUrl: 'https://api.example.com/v1',
    enabled: false
  }
]

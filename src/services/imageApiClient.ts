import type { ImageProviderId, MockServerConfig, ModelConfig, ReferenceImage } from '../types/lightyear'

export type NormalizedImageResult = {
  previewUrl: string
  label: string
}

export type ImageGenerationParams = {
  config: ModelConfig
  count: number
  mockServer: MockServerConfig
  prompt: string
  quality: string
  ratio: string
  references: ReferenceImage[]
  size: string
}

type ApiErrorPayload = {
  error?: {
    code?: string | number
    message?: string
    status?: string
    type?: string
  }
  code?: string | number
  message?: string
  request_id?: string
}

type KlingTaskResponse = {
  output?: {
    task_id?: string
    task_status?: string
    results?: Array<{ url?: string }>
  }
}

const providerPaths: Partial<Record<ImageProviderId, string>> = {
  gemini: '/v1beta/models',
  kling: '/api/v1/services/aigc/multimodal-generation/generation',
  openai: '/v1/images/generations',
  qwen: '/api/v1/services/aigc/multimodal-generation/generation',
  seedream: '/api/v3/images/generations',
  'custom-openai': '/v1/images/generations'
}

const providerBaseUrls: Partial<Record<ImageProviderId, string>> = {
  gemini: 'https://generativelanguage.googleapis.com',
  kling: 'https://dashscope.aliyuncs.com',
  openai: 'https://api.openai.com',
  qwen: 'https://dashscope.aliyuncs.com',
  seedream: 'https://ark.ap-southeast.bytepluses.com'
}

export class ImageApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ImageApiError'
    this.status = status
  }
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

async function readResponseJson(response: Response) {
  const text = await response.text()
  if (!text) {
    return {}
  }

  try {
    return JSON.parse(text)
  } catch {
    return { message: text }
  }
}

function readApiErrorMessage(payload: ApiErrorPayload, fallback: string) {
  return payload.error?.message ?? payload.message ?? fallback
}

async function fetchJson(url: string, init: RequestInit) {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch {
    throw new ImageApiError('无法连接 API', 0)
  }

  const payload = await readResponseJson(response)
  if (!response.ok) {
    throw new ImageApiError(readApiErrorMessage(payload as ApiErrorPayload, 'API 请求失败'), response.status)
  }

  return payload
}

function resolveBaseUrl(config: ModelConfig, mockServer: MockServerConfig) {
  if (mockServer.enabled) {
    return mockServer.baseUrl
  }

  if (config.provider === 'custom-openai') {
    return config.baseUrl
  }

  return providerBaseUrls[config.provider] ?? config.baseUrl
}

function resolveOpenAiLikePath(config: ModelConfig, mockServer: MockServerConfig, hasReferences: boolean) {
  if (config.provider !== 'custom-openai' || mockServer.enabled) {
    return hasReferences ? '/v1/images/edits' : providerPaths[config.provider] ?? '/v1/images/generations'
  }

  const prefix = config.baseUrl.replace(/\/+$/, '').endsWith('/v1') ? '' : '/v1'

  return `${prefix}${hasReferences ? '/images/edits' : '/images/generations'}`
}

function createAuthHeaders(config: ModelConfig): Record<string, string> {
  if (config.provider === 'gemini') {
    return { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey }
  }

  return {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json'
  }
}

function resolveRequestConfig(config: ModelConfig, mockServer: MockServerConfig): ModelConfig {
  if (!mockServer.enabled) {
    return config
  }

  const apiKey = config.apiKey.trim()
  if (apiKey.startsWith('mock-')) {
    return config
  }

  return {
    ...config,
    apiKey: 'mock-good'
  }
}

function buildDashScopeRequest(params: ImageGenerationParams) {
  const content: Array<{ text?: string; image?: string }> = [{ text: params.prompt }]
  params.references.forEach((reference) => {
    content.push({ image: reference.image.previewUrl })
  })

  return {
    model: params.config.model,
    input: {
      messages: [
        {
          role: 'user',
          content
        }
      ]
    },
    parameters: {
      n: params.count,
      size: params.size,
      quality: params.quality,
      aspect_ratio: params.ratio
    }
  }
}

function buildGeminiRequest(params: ImageGenerationParams) {
  return {
    contents: [
      {
        role: 'user',
        parts: [
          { text: params.prompt },
          ...params.references.map((reference) => ({
            inlineData: {
              mimeType: 'image/png',
              data: reference.image.previewUrl.split(',').at(1) ?? ''
            }
          }))
        ]
      }
    ],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      candidateCount: params.count,
      imageConfig: {
        aspectRatio: params.ratio === '原图比例' ? undefined : params.ratio,
        imageSize: params.size
      }
    }
  }
}

function buildOpenAiRequest(params: ImageGenerationParams) {
  return {
    model: params.config.model,
    prompt: params.prompt,
    n: params.count,
    size: params.size,
    quality: readOpenAiQuality(params.quality),
    output_format: 'png'
  }
}

function readOpenAiQuality(quality: string) {
  if (quality === '高') {
    return 'high'
  }

  if (quality === '中') {
    return 'medium'
  }

  if (quality === '低') {
    return 'low'
  }

  return 'auto'
}

async function requestOpenAiLike(params: ImageGenerationParams) {
  const path = resolveOpenAiLikePath(params.config, params.mockServer, Boolean(params.references.length))
  const url = joinUrl(resolveBaseUrl(params.config, params.mockServer), path)

  if (!params.references.length) {
    return fetchJson(url, {
      method: 'POST',
      headers: createAuthHeaders(params.config),
      body: JSON.stringify(buildOpenAiRequest(params))
    })
  }

  const form = new FormData()
  form.append('model', params.config.model)
  form.append('prompt', params.prompt)
  form.append('n', String(params.count))
  form.append('size', params.size)
  form.append('quality', readOpenAiQuality(params.quality))
  params.references.forEach((reference, index) => {
    form.append('image[]', new Blob([reference.image.previewUrl], { type: 'image/png' }), `reference-${index + 1}.png`)
  })

  return fetchJson(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.config.apiKey}`
    },
    body: form
  })
}

async function requestGemini(params: ImageGenerationParams) {
  return fetchJson(joinUrl(resolveBaseUrl(params.config, params.mockServer), `/v1beta/models/${params.config.model}:generateContent`), {
    method: 'POST',
    headers: createAuthHeaders(params.config),
    body: JSON.stringify(buildGeminiRequest(params))
  })
}

async function requestDashScope(params: ImageGenerationParams) {
  const payload = await fetchJson(joinUrl(resolveBaseUrl(params.config, params.mockServer), providerPaths[params.config.provider] ?? ''), {
    method: 'POST',
    headers: createAuthHeaders(params.config),
    body: JSON.stringify(buildDashScopeRequest(params))
  })

  if (params.config.provider !== 'kling') {
    return payload
  }

  const taskId = (payload as KlingTaskResponse).output?.task_id
  if (!taskId) {
    return payload
  }

  return fetchJson(joinUrl(resolveBaseUrl(params.config, params.mockServer), `/api/v1/tasks/${taskId}`), {
    method: 'GET',
    headers: createAuthHeaders(params.config)
  })
}

async function requestSeedream(params: ImageGenerationParams) {
  return fetchJson(joinUrl(resolveBaseUrl(params.config, params.mockServer), providerPaths.seedream ?? ''), {
    method: 'POST',
    headers: createAuthHeaders(params.config),
    body: JSON.stringify({
      model: params.config.model,
      prompt: params.prompt,
      image: params.references.map((reference) => reference.image.previewUrl),
      response_format: 'url',
      size: params.size,
      watermark: false
    })
  })
}

function readOpenAiImages(payload: any): NormalizedImageResult[] {
  return (payload.data ?? []).map((item: any, index: number) => ({
    previewUrl: item.url ?? `data:image/png;base64,${item.b64_json}`,
    label: `生成图 ${index + 1}`
  }))
}

function readGeminiImages(payload: any): NormalizedImageResult[] {
  const parts = payload.candidates?.flatMap((candidate: any) => candidate.content?.parts ?? []) ?? []
  return parts
    .filter((part: any) => part.inlineData?.data || part.inline_data?.data)
    .map((part: any, index: number) => {
      const inlineData = part.inlineData ?? part.inline_data
      const mimeType = inlineData.mimeType ?? inlineData.mime_type ?? 'image/png'

      return {
        previewUrl: `data:${mimeType};base64,${inlineData.data}`,
        label: `生成图 ${index + 1}`
      }
    })
}

function readDashScopeImages(payload: any): NormalizedImageResult[] {
  const content = payload.output?.choices?.flatMap((choice: any) => choice.message?.content ?? []) ?? []
  return content
    .filter((item: any) => item.image)
    .map((item: any, index: number) => ({
      previewUrl: item.image,
      label: `生成图 ${index + 1}`
    }))
}

function readKlingImages(payload: any): NormalizedImageResult[] {
  return (payload.output?.results ?? []).map((item: any, index: number) => ({
    previewUrl: item.url,
    label: `生成图 ${index + 1}`
  }))
}

function readImages(provider: ImageProviderId, payload: any) {
  if (provider === 'gemini') {
    return readGeminiImages(payload)
  }

  if (provider === 'qwen') {
    return readDashScopeImages(payload)
  }

  if (provider === 'kling') {
    return readKlingImages(payload)
  }

  return readOpenAiImages(payload)
}

export async function generateImagesWithProvider(params: ImageGenerationParams) {
  const requestParams: ImageGenerationParams = {
    ...params,
    config: resolveRequestConfig(params.config, params.mockServer)
  }
  let payload: any
  if (requestParams.config.provider === 'gemini') {
    payload = await requestGemini(requestParams)
  } else if (requestParams.config.provider === 'qwen' || requestParams.config.provider === 'kling') {
    payload = await requestDashScope(requestParams)
  } else if (requestParams.config.provider === 'seedream') {
    payload = await requestSeedream(requestParams)
  } else {
    payload = await requestOpenAiLike(requestParams)
  }

  const images = readImages(requestParams.config.provider, payload)
  if (!images.length) {
    throw new ImageApiError('API 未返回图片', 502)
  }

  return images
}

export async function testImageConfig(config: ModelConfig, mockServer: MockServerConfig) {
  const prompt = 'connection test'
  const params: ImageGenerationParams = {
    config,
    count: 1,
    mockServer,
    prompt,
    quality: '自动',
    ratio: '1:1',
    references: [],
    size: config.provider === 'qwen' ? '1024*1024' : '1024x1024'
  }
  await generateImagesWithProvider(params)
}

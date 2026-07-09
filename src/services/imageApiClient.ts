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
  apimart: '/v1/images/generations',
  gemini: '/v1beta/models',
  kling: '/api/v1/services/aigc/multimodal-generation/generation',
  openai: '/v1/images/generations',
  qwen: '/api/v1/services/aigc/multimodal-generation/generation',
  seedream: '/api/v3/images/generations',
  'custom-openai': '/v1/images/generations'
}

const providerBaseUrls: Partial<Record<ImageProviderId, string>> = {
  apimart: 'https://api.apimart.ai',
  gemini: 'https://generativelanguage.googleapis.com',
  kling: 'https://dashscope.aliyuncs.com',
  openai: 'https://api.openai.com',
  qwen: 'https://dashscope.aliyuncs.com',
  seedream: 'https://ark.ap-southeast.bytepluses.com'
}

const apimartPollIntervalMs = 5000
const apimartPollAttempts = 99
const originalRatioOption = '原图比例'

type DimensionConstraints = {
  maxPixels?: number
  maxSide?: number
  minPixels?: number
  multiple?: number
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

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function isRemoteImageUrl(value: string) {
  return /^https?:\/\//i.test(value)
}

function readImageExtensionFromMimeType(mimeType: string) {
  const normalized = mimeType.split(';')[0]?.trim().toLowerCase()

  if (normalized === 'image/png') {
    return 'png'
  }

  if (normalized === 'image/jpeg' || normalized === 'image/jpg') {
    return 'jpg'
  }

  if (normalized === 'image/webp') {
    return 'webp'
  }

  return 'png'
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(Math.round(left))
  let b = Math.abs(Math.round(right))

  while (b) {
    const remainder = a % b
    a = b
    b = remainder
  }

  return a || 1
}

function readAspectRatio(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined
  }

  const divisor = greatestCommonDivisor(width, height)
  return `${Math.round(width) / divisor}:${Math.round(height) / divisor}`
}

function readReferenceAspectRatio(references: ReferenceImage[]) {
  const image = references[0]?.image
  if (!image) {
    return undefined
  }

  const boundsWidth = Math.abs(image.sourceBounds.right - image.sourceBounds.left)
  const boundsHeight = Math.abs(image.sourceBounds.bottom - image.sourceBounds.top)

  return readAspectRatio(boundsWidth || image.width, boundsHeight || image.height)
}

function readRequestedAspectRatio(params: ImageGenerationParams) {
  const normalized = params.ratio.trim()
  if (/^\d+:\d+$/.test(normalized)) {
    return normalized
  }

  if (normalized === originalRatioOption) {
    return readReferenceAspectRatio(params.references)
  }

  return undefined
}

function readTargetPixelArea(size: string) {
  const dimensions = size.match(/^(\d+)\s*[x*]\s*(\d+)$/i)
  if (dimensions) {
    return Number(dimensions[1]) * Number(dimensions[2])
  }

  const kilo = size.match(/^(\d+(?:\.\d+)?)\s*k$/i)
  if (kilo) {
    return (Number(kilo[1]) * 1024) ** 2
  }

  const megaPixels = size.match(/^(\d+(?:\.\d+)?)\s*mp$/i)
  if (megaPixels) {
    return Number(megaPixels[1]) * 1_000_000
  }

  return 1024 * 1024
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function roundToMultiple(value: number, multiple: number) {
  return Math.max(multiple, Math.round(value / multiple) * multiple)
}

function readDimensionSize(aspectRatio: string, size: string, constraints: DimensionConstraints = {}) {
  const [rawWidth, rawHeight] = aspectRatio.split(':').map(Number)
  if (!rawWidth || !rawHeight) {
    return undefined
  }

  const multiple = constraints.multiple ?? 16
  const minPixels = constraints.minPixels ?? multiple * multiple
  const maxPixels = constraints.maxPixels ?? Number.POSITIVE_INFINITY
  const maxSide = constraints.maxSide ?? Number.POSITIVE_INFINITY
  let targetArea = clamp(readTargetPixelArea(size), minPixels, maxPixels)
  let width = Math.sqrt(targetArea * (rawWidth / rawHeight))
  let height = width / (rawWidth / rawHeight)
  const longestSide = Math.max(width, height)

  if (longestSide > maxSide) {
    const scale = maxSide / longestSide
    width *= scale
    height *= scale
    targetArea = width * height
  }

  if (targetArea < minPixels) {
    const scale = Math.sqrt(minPixels / targetArea)
    width *= scale
    height *= scale
  }

  return `${roundToMultiple(width, multiple)}x${roundToMultiple(height, multiple)}`
}

function resolveOpenAiSize(params: ImageGenerationParams) {
  const aspectRatio = readRequestedAspectRatio(params)

  if (!aspectRatio) {
    return params.size
  }

  return (
    readDimensionSize(aspectRatio, params.size, {
      maxPixels: 8_294_400,
      maxSide: 3840,
      minPixels: 655_360,
      multiple: 16
    }) ?? params.size
  )
}

function resolveModelArkSize(params: ImageGenerationParams) {
  const aspectRatio = readRequestedAspectRatio(params)

  if (!aspectRatio) {
    return params.size
  }

  return (
    readDimensionSize(aspectRatio, params.size, {
      maxSide: 4096,
      multiple: 16
    }) ?? params.size
  )
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

function createMultipartAuthHeaders(config: ModelConfig): Record<string, string> {
  return {
    Authorization: `Bearer ${config.apiKey}`
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
  const aspectRatio = readRequestedAspectRatio(params)
  const parameters: Record<string, unknown> = {
    n: params.count,
    size: params.size,
    quality: params.quality
  }

  if (aspectRatio) {
    parameters.aspect_ratio = aspectRatio
  }

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
    parameters
  }
}

function buildGeminiRequest(params: ImageGenerationParams) {
  const aspectRatio = readRequestedAspectRatio(params)

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
        aspectRatio,
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
    size: resolveOpenAiSize(params),
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

function buildApimartRequest(params: ImageGenerationParams, imageUrls: string[]) {
  const payload: Record<string, unknown> = {
    model: params.config.model,
    prompt: params.prompt,
    n: params.count,
    resolution: params.size
  }
  const aspectRatio = readRequestedAspectRatio(params)

  if (aspectRatio) {
    payload.size = aspectRatio
  }

  if (/^gpt-image-1(?:\.5)?-official$/i.test(params.config.model)) {
    payload.quality = readOpenAiQuality(params.quality)
  }

  if (imageUrls.length) {
    payload.image_urls = imageUrls
  }

  return payload
}

async function readReferenceBlob(reference: ReferenceImage) {
  const response = await fetch(reference.image.previewUrl)
  if (!response.ok) {
    throw new ImageApiError('APIMart 上传参考图失败', 502)
  }

  return response.blob()
}

async function uploadApimartReferenceImage(baseUrl: string, config: ModelConfig, reference: ReferenceImage, index: number) {
  if (isRemoteImageUrl(reference.image.previewUrl)) {
    return reference.image.previewUrl
  }

  const blob = await readReferenceBlob(reference)
  const extension = readImageExtensionFromMimeType(blob.type || 'image/png')
  const form = new FormData()
  form.append('file', blob, `lightyear-reference-${index + 1}.${extension}`)

  const payload = await fetchJson(joinUrl(baseUrl, '/v1/uploads/images'), {
    method: 'POST',
    headers: createMultipartAuthHeaders(config),
    body: form
  })

  const url = (payload as any).url ?? (payload as any).data?.url
  if (typeof url !== 'string' || !url) {
    throw new ImageApiError('APIMart 上传参考图失败', 502)
  }

  return url
}

async function uploadApimartReferenceImages(params: ImageGenerationParams, baseUrl: string) {
  const imageUrls: string[] = []
  for (const [index, reference] of params.references.entries()) {
    imageUrls.push(await uploadApimartReferenceImage(baseUrl, params.config, reference, index))
  }

  return imageUrls
}

function readApimartTaskId(payload: any) {
  if (typeof payload?.task_id === 'string') {
    return payload.task_id
  }

  if (typeof payload?.data?.task_id === 'string') {
    return payload.data.task_id
  }

  const firstItem = Array.isArray(payload?.data) ? payload.data[0] : undefined
  return typeof firstItem?.task_id === 'string' ? firstItem.task_id : undefined
}

function readApimartTaskStatus(payload: any) {
  const task = payload?.data && !Array.isArray(payload.data) ? payload.data : payload
  return String(task?.status ?? task?.task_status ?? '').toLowerCase()
}

function readApimartTaskError(payload: any) {
  const task = payload?.data && !Array.isArray(payload.data) ? payload.data : payload
  return task?.error?.message ?? task?.error_message ?? task?.message ?? payload?.message
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
  form.append('size', resolveOpenAiSize(params))
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

async function requestApimart(params: ImageGenerationParams) {
  if (params.mockServer.enabled) {
    return requestOpenAiLike(params)
  }

  const baseUrl = resolveBaseUrl(params.config, params.mockServer)
  const imageUrls = await uploadApimartReferenceImages(params, baseUrl)
  const payload = await fetchJson(joinUrl(baseUrl, providerPaths.apimart ?? ''), {
    method: 'POST',
    headers: createAuthHeaders(params.config),
    body: JSON.stringify(buildApimartRequest(params, imageUrls))
  })

  const taskId = readApimartTaskId(payload)
  if (!taskId) {
    return payload
  }

  for (let attempt = 0; attempt < apimartPollAttempts; attempt += 1) {
    const result = await fetchJson(joinUrl(baseUrl, `/v1/tasks/${encodeURIComponent(taskId)}?language=zh`), {
      method: 'GET',
      headers: createAuthHeaders(params.config)
    })
    const status = readApimartTaskStatus(result)

    if (!status || status === 'completed' || status === 'succeeded' || status === 'success') {
      return result
    }

    if (status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled') {
      throw new ImageApiError(readApimartTaskError(result) || 'APIMart 任务失败', 502)
    }

    await wait(apimartPollIntervalMs)
  }

  throw new ImageApiError(`APIMart 任务超时：${taskId}`, 504)
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
      size: resolveModelArkSize(params),
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

function readApimartImages(payload: any): NormalizedImageResult[] {
  const task = payload?.data && !Array.isArray(payload.data) ? payload.data : payload
  const resultImages = task?.result?.images ?? payload?.result?.images ?? []
  const urls = Array.isArray(resultImages)
    ? resultImages.flatMap((item: any) => {
        if (Array.isArray(item?.url)) {
          return item.url
        }

        return item?.url ?? item?.image_url ?? item?.image ?? []
      })
    : []

  if (urls.length) {
    return urls
      .filter((url: unknown): url is string => typeof url === 'string' && Boolean(url))
      .map((previewUrl, index) => ({
        previewUrl,
        label: `生成图 ${index + 1}`
      }))
  }

  return readOpenAiImages(payload)
}

function readImages(provider: ImageProviderId, payload: any) {
  if (provider === 'gemini') {
    return readGeminiImages(payload)
  }

  if (provider === 'apimart') {
    return readApimartImages(payload)
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
  } else if (requestParams.config.provider === 'apimart') {
    payload = await requestApimart(requestParams)
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
    ratio: '原图比例',
    references: [],
    size: config.provider === 'qwen' ? '1024*1024' : config.provider === 'apimart' ? '1K' : '1024x1024'
  }
  await generateImagesWithProvider(params)
}

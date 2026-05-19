import { normalizeComfyUiSettings } from '../data/comfyUiDefaults'
import type {
  ComfyUiNodeMapping,
  CustomModelFormat,
  ImageProviderId,
  ImageRequestLogEntry,
  ImageRequestLogValue,
  ModelConfig,
  ReferenceImage
} from '../types/lightyear'
import { normalizeCustomModelFormat, providerCapabilities } from '../data/providerCapabilities'

export type NormalizedImageResult = {
  previewUrl: string
  label: string
  resolvedSize?: string
}

export type ImageGenerationParams = {
  canvasSize?: { width: number; height: number }
  config: ModelConfig
  count: number
  loadingTaskId?: string
  prompt: string
  quality: string
  ratio: string
  references: ReferenceImage[]
  onTiming?: (entry: ImageRequestLogEntry) => void
  signal?: AbortSignal
  size: string
}

type TimingContext = {
  metadata: Record<string, ImageRequestLogValue>
  onTiming?: (entry: ImageRequestLogEntry) => void
}

type ApiErrorPayload = {
  error?: {
    code?: string | number
    message?: string
    status?: string
    type?: string
  }
  code?: string | number
  detail?: string
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

type BflTaskResponse = {
  polling_url?: string
}

type ComfyUiPromptResponse = {
  prompt_id?: string
}

const providerPaths: Partial<Record<ImageProviderId, string>> = {
  apimart: '/v1/images/generations',
  'codex-image-server': '/v1/images/generate',
  gemini: '/v1beta/models',
  kling: '/api/v1/services/aigc/image-generation/generation',
  openai: '/v1/images/generations',
  qwen: '/api/v1/services/aigc/multimodal-generation/generation',
  seedream: '/api/v3/images/generations',
  'custom-openai': '/v1/images/generations'
}

const customFormatPathBase: Record<CustomModelFormat, string> = {
  openai: '/v1',
  'openai-images': '/v1',
  'openai-chat': '/v1'
}

const providerBaseUrls: Partial<Record<ImageProviderId, string>> = {
  apimart: 'https://api.apimart.ai',
  'codex-image-server': 'http://127.0.0.1:17341',
  comfyui: 'http://127.0.0.1:8000',
  gemini: 'https://generativelanguage.googleapis.com',
  kling: 'https://dashscope.aliyuncs.com',
  openai: 'https://api.openai.com',
  qwen: 'https://dashscope.aliyuncs.com',
  seedream: 'https://ark.ap-southeast.bytepluses.com',
  flux: 'https://api.bfl.ai'
}

const pollIntervalMs = 2000
const pollAttempts = 45
const apimartPollIntervalMs = 5000
const apimartPollAttempts = 144
const apimartAspectRatios = new Set(['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '21:9', '1:4', '4:1', '1:8', '8:1'])
const apimartFixedAspectRatios = ['1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '21:9', '1:4', '4:1', '1:8', '8:1']
const gptImage2MinPixels = 655_360
const gptImage2MaxPixels = 8_294_400
const gptImage2MaxEdge = 3840
const gptImage2MaxRatio = 3
const customDimensionMinPixels = 1024 * 1024
const customDimensionMaxPixels = 4096 * 4096
const customDimensionMaxEdge = 4096
const customDimensionMaxRatio = 16
const codexSizePresets = new Map([
  ['1k', { maxEdge: 1024, maxPixels: 1024 * 1024 }],
  ['2k', { maxEdge: 2048, maxPixels: 2048 * 2048 }],
  ['4k', { maxEdge: gptImage2MaxEdge, maxPixels: gptImage2MaxPixels }]
])
const pixelSizePresetMaxPixels = new Map([
  ['1k', 1024 * 1024],
  ['2k', 2048 * 2048],
  ['4k', 4096 * 4096]
])

export class ImageApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ImageApiError'
    this.status = status
  }
}

function joinUrl(baseUrl: string, path: string) {
  return `${normalizeBaseUrl(baseUrl).replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function normalizeBaseUrl(baseUrl: string) {
  const cleanBaseUrl = baseUrl.trim()
  if (!cleanBaseUrl) {
    return ''
  }

  if (/^https?:\/\//i.test(cleanBaseUrl)) {
    return cleanBaseUrl
  }

  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i.test(cleanBaseUrl)) {
    return `http://${cleanBaseUrl}`
  }

  return `https://${cleanBaseUrl}`
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
  return payload.error?.message ?? payload.message ?? payload.detail ?? fallback
}

function nowMs() {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

function logApiTiming(label: string, fields: Record<string, unknown>) {
  console.info(`[Lightyear API] ${label}`, fields)
}

function createRequestLogId() {
  return `request-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function readTimingMetadata(params: ImageGenerationParams, phase: string, extra: Record<string, ImageRequestLogValue> = {}) {
  return {
    phase,
    provider: params.config.provider,
    customFormat: readCustomModelFormat(params.config),
    model: params.config.model,
    baseUrl: resolveBaseUrl(params.config),
    count: params.count,
    size: params.size,
    ratio: params.ratio,
    quality: params.quality,
    referenceCount: params.references.length,
    promptLength: params.prompt.length,
    hasCanvasSize: Boolean(params.canvasSize),
    ...extra
  }
}

function readTimingContext(
  params: ImageGenerationParams,
  phase: string,
  extra: Record<string, ImageRequestLogValue> = {}
): TimingContext {
  return {
    metadata: readTimingMetadata(params, phase, extra),
    onTiming: params.onTiming
  }
}

async function fetchJson(url: string, init: RequestInit, timing?: TimingContext) {
  const startedAt = nowMs()
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted || error instanceof DOMException && error.name === 'AbortError') {
      throw new ImageApiError('请求已取消', 499)
    }
    throw new ImageApiError('无法连接 API', 0)
  }

  const headersAt = nowMs()
  const payload = await readResponseJson(response)
  const parsedAt = nowMs()
  const entry: ImageRequestLogEntry = {
    id: createRequestLogId(),
    createdAt: new Date().toISOString(),
    url,
    method: init.method ?? 'GET',
    status: response.status,
    ok: response.ok,
    contentLength: response.headers.get('content-length') ?? '',
    metadata: timing?.metadata ?? {},
    stages: {
      headersMs: Math.round(headersAt - startedAt),
      bodyParseMs: Math.round(parsedAt - headersAt),
      totalMs: Math.round(parsedAt - startedAt)
    }
  }
  logApiTiming('fetch', entry)
  timing?.onTiming?.(entry)

  if (!response.ok) {
    throw new ImageApiError(readApiErrorMessage(payload as ApiErrorPayload, 'API 请求失败'), response.status)
  }

  return payload
}

function resolveBaseUrl(config: ModelConfig) {
  const capability = providerCapabilities[config.provider]
  if (capability.officialBaseUrl && config.provider !== 'custom-openai') {
    return capability.officialBaseUrl ?? ''
  }

  if (config.provider === 'custom-openai' || config.provider === 'comfyui' || config.provider === 'codex-image-server') {
    return config.baseUrl || providerBaseUrls[config.provider] || ''
  }

  return config.baseUrl || capability.officialBaseUrl || providerBaseUrls[config.provider] || ''
}

function resolveOpenAiLikePath(config: ModelConfig, hasReferences: boolean) {
  if (config.provider !== 'custom-openai' && config.provider !== 'openai') {
    return hasReferences ? '/v1/images/edits' : providerPaths[config.provider] ?? '/v1/images/generations'
  }

  const prefix = resolveBaseUrl(config).replace(/\/+$/, '').endsWith('/v1') ? '' : '/v1'

  return `${prefix}${hasReferences ? '/images/edits' : '/images/generations'}`
}

function readCustomModelFormat(config: ModelConfig): CustomModelFormat | undefined {
  if (config.provider !== 'custom-openai') {
    return undefined
  }

  return normalizeCustomModelFormat(config.customFormat)
}

function resolveCustomV1Path(config: ModelConfig, path: string) {
  const baseUrl = resolveBaseUrl(config).replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const basePath = customFormatPathBase[readCustomModelFormat(config) ?? 'openai']
  const prefix = baseUrl.endsWith(basePath) ? '' : basePath

  return `${prefix}${normalizedPath}`
}

function shouldUseOpenAiChatFormat(config: ModelConfig) {
  return config.provider === 'custom-openai' && readCustomModelFormat(config) === 'openai-chat'
}

function resolveGeminiGenerateUrl(config: ModelConfig) {
  const baseUrl = resolveBaseUrl(config).replace(/\/+$/, '')
  const encodedModel = encodeURIComponent(config.model)

  if (/\/v1beta\/models$/i.test(baseUrl)) {
    return joinUrl(baseUrl, `/${encodedModel}:generateContent`)
  }

  if (/\/v1beta$/i.test(baseUrl)) {
    return joinUrl(baseUrl, `/models/${encodedModel}:generateContent`)
  }

  return joinUrl(baseUrl, `/v1beta/models/${encodedModel}:generateContent`)
}

function resolveGeminiModelsUrl(config: ModelConfig) {
  const baseUrl = resolveBaseUrl(config).replace(/\/+$/, '')

  if (/\/v1beta\/models$/i.test(baseUrl)) {
    return baseUrl
  }

  if (/\/v1beta$/i.test(baseUrl)) {
    return joinUrl(baseUrl, '/models')
  }

  return joinUrl(baseUrl, '/v1beta/models')
}

function resolveCustomModelsUrl(config: ModelConfig) {
  return joinUrl(resolveBaseUrl(config), resolveCustomV1Path(config, '/models'))
}

function createAuthHeaders(config: ModelConfig): Record<string, string> {
  if (config.provider === 'codex-image-server') {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    }
    if (config.apiKey.trim()) {
      headers['X-API-Key'] = config.apiKey.trim()
    }

    return headers
  }

  if (config.provider === 'comfyui') {
    return config.apiKey.trim() ? { Authorization: `Bearer ${config.apiKey}` } : {}
  }

  if (config.provider === 'gemini') {
    return {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.apiKey
    }
  }

  if (config.provider === 'flux') {
    return {
      'Content-Type': 'application/json',
      'x-key': config.apiKey
    }
  }

  return {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json'
  }
}

function wait(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) {
    return Promise.reject(new ImageApiError('请求已取消', 499))
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort)
      resolve()
    }, ms)
    function handleAbort() {
      clearTimeout(timer)
      reject(new ImageApiError('请求已取消', 499))
    }

    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}

function readQwenSize(size: string) {
  if (size === 'auto' || size === '默认' || /^1k$/i.test(size)) {
    return '1024*1024'
  }

  if (/^2k$/i.test(size)) {
    return '2048*2048'
  }

  if (/^4k$/i.test(size)) {
    return '2048*2048'
  }

  return size.replace('x', '*')
}

function readGeminiImageSize(size: string) {
  if (/^[124]k$/i.test(size)) {
    return size.toUpperCase()
  }

  return size
}

function buildQwenRequest(params: ImageGenerationParams) {
  const content: Array<{ text?: string; image?: string }> = []
  params.references.forEach((reference) => {
    content.push({ image: reference.image.previewUrl })
  })
  content.push({ text: params.prompt })

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
      size: readQwenSize(params.size),
      prompt_extend: true,
      watermark: false
    }
  }
}

function buildKlingRequest(params: ImageGenerationParams) {
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
      result_type: 'single',
      aspect_ratio: params.ratio,
      resolution: params.size,
      watermark: false
    }
  }
}

function buildGeminiRequest(params: ImageGenerationParams) {
  const imageConfig: Record<string, string> = {}
  if (params.ratio !== '原图比例') {
    imageConfig.aspectRatio = params.ratio
  }
  if (params.size !== '默认') {
    imageConfig.imageSize = readGeminiImageSize(params.size)
  }

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
      imageConfig
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

function buildCustomOpenAiImagesRequest(params: ImageGenerationParams) {
  return {
    model: params.config.model,
    prompt: params.prompt,
    n: params.count,
    size: params.size
  }
}

function buildOpenAiChatRequest(params: ImageGenerationParams) {
  return {
    model: params.config.model,
    stream: false,
    messages: [
      {
        role: 'user',
        content: params.references.length
          ? [
              { type: 'text', text: params.prompt },
              ...params.references.map((reference) => ({
                type: 'image_url',
                image_url: { url: reference.image.previewUrl }
              }))
            ]
          : params.prompt
      }
    ]
  }
}

function readApimartResolution(size: string) {
  const normalized = size.trim().toUpperCase()
  if (['0.5K', '1K', '2K', '4K'].includes(normalized)) {
    return normalized
  }

  const dimensions = parseDimensionText(size)
  if (!dimensions) {
    return '1K'
  }

  const maxEdge = Math.max(dimensions.width, dimensions.height)
  if (maxEdge <= 768) {
    return '0.5K'
  }
  if (maxEdge <= 1536) {
    return '1K'
  }
  if (maxEdge <= 2560) {
    return '2K'
  }

  return '4K'
}

function normalizeApimartAspectRatio(value: string) {
  const normalized = value === '自动' ? 'auto' : value
  return apimartAspectRatios.has(normalized) ? normalized : 'auto'
}

function isApimartProImageModel(model: string) {
  return /gemini-3-pro-image-preview/i.test(model)
}

function findNearestApimartAspectRatio(dimensions?: { width: number; height: number }) {
  const sourceRatio = dimensions && dimensions.width > 0 && dimensions.height > 0 ? dimensions.width / dimensions.height : 1
  let bestRatio = '1:1'
  let bestDelta = Number.POSITIVE_INFINITY

  for (const ratio of apimartFixedAspectRatios) {
    const parsed = parseRatioText(ratio)
    if (!parsed) {
      continue
    }

    const delta = Math.abs(Math.log(sourceRatio / (parsed.width / parsed.height)))
    if (delta < bestDelta) {
      bestRatio = ratio
      bestDelta = delta
    }
  }

  return bestRatio
}

function readApimartSourceDimensions(params: ImageGenerationParams) {
  if (params.ratio === '画布比例') {
    return readDimensionsRatio(params.canvasSize) ?? readDimensionsRatio(params.references[0]?.image)
  }

  if (params.ratio === '自定义') {
    return parseDimensionText(params.size) ?? readDimensionsRatio(params.canvasSize) ?? readDimensionsRatio(params.references[0]?.image)
  }

  return readDimensionsRatio(params.references[0]?.image) ?? readDimensionsRatio(params.canvasSize)
}

function readApimartAspectRatio(params: ImageGenerationParams) {
  if (params.ratio === '自动' || params.ratio === '原图比例' || params.ratio === '参考图比例') {
    return isApimartProImageModel(params.config.model) ? findNearestApimartAspectRatio(readApimartSourceDimensions(params)) : 'auto'
  }

  const selectedRatio = parseRatioText(params.ratio)
  if (selectedRatio) {
    return normalizeApimartAspectRatio(formatAspectRatio(selectedRatio))
  }

  const dimensions = readApimartSourceDimensions(params)

  if (!dimensions) {
    return isApimartProImageModel(params.config.model) ? findNearestApimartAspectRatio() : 'auto'
  }

  const ratio = normalizeApimartAspectRatio(formatAspectRatio(dimensions))
  return ratio === 'auto' && isApimartProImageModel(params.config.model) ? findNearestApimartAspectRatio(dimensions) : ratio
}

function buildApimartRequest(params: ImageGenerationParams) {
  const payload: Record<string, unknown> = {
    model: params.config.model,
    prompt: params.prompt,
    n: params.count,
    size: readApimartAspectRatio(params),
    resolution: readApimartResolution(params.size)
  }

  if (params.references.length) {
    payload.image_urls = params.references.map((reference) => reference.image.previewUrl)
  }

  return payload
}

function buildCodexImageServerRequest(params: ImageGenerationParams) {
  const payload: Record<string, unknown> = {
    model: params.config.model,
    count: params.count,
    prompt: params.prompt,
    quality: readOpenAiQuality(params.quality),
    size: params.size,
    aspect: params.ratio,
    output_format: 'png',
    return: 'file'
  }

  if (params.references.length) {
    payload.references = params.references.map((reference) => ({
      image: reference.image.previewUrl,
      label: reference.label,
      source: reference.source,
      width: reference.image.width,
      height: reference.image.height
    }))
  }

  if (params.canvasSize) {
    payload.canvas_size = params.canvasSize
  }

  return payload
}

function readDataUrlParts(value: string) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(value)
  if (!match) {
    return null
  }

  return {
    data: match[3] ?? '',
    isBase64: Boolean(match[2]),
    mimeType: match[1] || 'image/png'
  }
}

function dataUrlToBlob(value: string) {
  const parts = readDataUrlParts(value)
  if (!parts) {
    return new Blob([value], { type: 'image/png' })
  }

  if (!parts.isBase64) {
    return new Blob([decodeURIComponent(parts.data)], { type: parts.mimeType })
  }

  const binary = atob(parts.data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new Blob([bytes], { type: parts.mimeType })
}

function readBflImageInput(value: string) {
  const parts = readDataUrlParts(value)
  return parts?.isBase64 ? parts.data : value
}

function parseFluxSize(size: string) {
  const match = /^(\d+)x(\d+)$/.exec(size)
  if (!match) {
    return { width: 1024, height: 1024 }
  }

  return {
    width: Number(match[1]),
    height: Number(match[2])
  }
}

function buildFluxRequest(params: ImageGenerationParams) {
  const dimensions = parseFluxSize(params.size)
  const payload: Record<string, string | number | boolean> = {
    prompt: params.prompt,
    output_format: 'jpeg',
    safety_tolerance: 2,
    width: dimensions.width,
    height: dimensions.height
  }

  params.references.slice(0, 8).forEach((reference, index) => {
    payload[index === 0 ? 'input_image' : `input_image_${index + 1}`] = readBflImageInput(reference.image.previewUrl)
  })

  return payload
}

function readComfyUiBaseUrl(config: ModelConfig) {
  return resolveBaseUrl(config)
}

async function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      resolve(String(reader.result ?? ''))
    })
    reader.addEventListener('error', () => reject(reader.error ?? new Error('无法读取图片')))
    reader.readAsDataURL(blob)
  })
}

async function fetchBlob(url: string, init: RequestInit) {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted || error instanceof DOMException && error.name === 'AbortError') {
      throw new ImageApiError('请求已取消', 499)
    }
    throw new ImageApiError('无法连接 API', 0)
  }

  if (!response.ok) {
    const payload = await readResponseJson(response)
    throw new ImageApiError(readApiErrorMessage(payload as ApiErrorPayload, 'API 请求失败'), response.status)
  }

  return response.blob()
}

async function uploadComfyUiImage(baseUrl: string, config: ModelConfig, reference: ReferenceImage, index: number) {
  const form = new FormData()
  form.append('image', dataUrlToBlob(reference.image.previewUrl), `lightyear-reference-${index + 1}.png`)
  form.append('overwrite', 'true')
  form.append('type', 'input')

  const payload = await fetchJson(joinUrl(baseUrl, '/upload/image'), {
    method: 'POST',
    headers: createAuthHeaders(config),
    body: form
  })

  return (payload as any).name ?? `lightyear-reference-${index + 1}.png`
}

function readDefaultComfyUiKey(type: ComfyUiNodeMapping['type']) {
  const defaults: Record<ComfyUiNodeMapping['type'], string> = {
    batch_size: 'batch_size',
    custom: '',
    height: 'height',
    image: 'image',
    model: 'ckpt_name',
    negative_prompt: 'text',
    prompt: 'text',
    seed: 'seed',
    steps: 'steps',
    width: 'width'
  }

  return defaults[type]
}

function parseComfyUiSize(size: string) {
  const match = /^(\d+)[x*](\d+)$/.exec(size)
  if (!match) {
    return { width: 1024, height: 1024 }
  }

  return {
    width: Number(match[1]),
    height: Number(match[2])
  }
}

function applyComfyUiWorkflowNodes(
  workflow: Record<string, any>,
  nodes: ComfyUiNodeMapping[],
  params: ImageGenerationParams,
  uploadedImages: string[]
) {
  const dimensions = parseComfyUiSize(params.size)
  const values: Record<ComfyUiNodeMapping['type'], string | number | undefined> = {
    batch_size: params.count,
    custom: undefined,
    height: dimensions.height,
    image: uploadedImages[0],
    model: params.config.model,
    negative_prompt: '',
    prompt: params.prompt,
    seed: Math.floor(Math.random() * 1125899906842624),
    steps: 20,
    width: dimensions.width
  }

  nodes.forEach((node) => {
    const key = node.key || readDefaultComfyUiKey(node.type)
    if (!key) {
      return
    }

    node.nodeIds.forEach((nodeId, index) => {
      const target = workflow[nodeId]
      if (!target?.inputs) {
        return
      }

      const value = node.type === 'custom' ? node.value : node.type === 'image' ? uploadedImages[index] ?? uploadedImages[0] : values[node.type]
      if (value !== undefined) {
        target.inputs[key] = value
      }
    })
  })
}

function readComfyUiHistoryImages(baseUrl: string, history: any, promptId: string) {
  const outputs = history[promptId]?.outputs ?? history.outputs ?? {}
  const images: Array<{ filename: string; subfolder?: string; type?: string }> = []

  Object.values(outputs).forEach((output: any) => {
    if (Array.isArray(output?.images)) {
      images.push(...output.images)
    }
  })

  return images.map((image, index) => {
    const url = new URL(joinUrl(baseUrl, '/view'))
    url.searchParams.set('filename', image.filename)
    url.searchParams.set('type', image.type ?? 'output')
    if (image.subfolder) {
      url.searchParams.set('subfolder', image.subfolder)
    }

    return {
      previewUrl: url.toString(),
      label: `生成图 ${index + 1}`
    }
  })
}

function readOpenAiQuality(quality: string) {
  if (['auto', 'high', 'medium', 'low', 'standard', 'hd'].includes(quality)) {
    return quality
  }

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

function parseRatioText(value: string) {
  const match = /^([1-9][0-9]*(?:\.\d+)?):([1-9][0-9]*(?:\.\d+)?)$/.exec(String(value || ''))
  if (!match) {
    return undefined
  }

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined
  }

  return { width, height }
}

function parseDimensionText(value: string) {
  const match = /^(\d{2,5})[x*](\d{2,5})$/i.exec(String(value || '').trim())
  if (!match) {
    return undefined
  }

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined
  }

  return {
    width: Math.round(width),
    height: Math.round(height)
  }
}

function formatDimensions(dimensions: { width: number; height: number }) {
  return `${dimensions.width}x${dimensions.height}`
}

function readDimensionsRatio(dimensions?: { width: number; height: number }) {
  if (!dimensions?.width || !dimensions?.height) {
    return undefined
  }

  const width = Number(dimensions.width)
  const height = Number(dimensions.height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined
  }

  return { width, height }
}

function resolveCodexAspectDimensions(params: Pick<ImageGenerationParams, 'canvasSize' | 'ratio' | 'references' | 'size'>) {
  if (params.ratio === '参考图比例' || params.ratio === '原图比例') {
    return readDimensionsRatio(params.references[0]?.image) ?? parseRatioText(params.size) ?? { width: 16, height: 9 }
  }

  if (params.ratio === '画布比例') {
    return readDimensionsRatio(params.canvasSize) ?? parseRatioText(params.size) ?? { width: 16, height: 9 }
  }

  return parseRatioText(params.ratio) ?? parseRatioText(params.size) ?? { width: 16, height: 9 }
}

function roundDownToMultiple(value: number, multiple: number) {
  return Math.max(multiple, Math.floor(value / multiple) * multiple)
}

function roundToMultiple(value: number, multiple: number) {
  return Math.max(multiple, Math.round(value / multiple) * multiple)
}

function readGreatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(Math.round(left))
  let b = Math.abs(Math.round(right))
  while (b) {
    const next = a % b
    a = b
    b = next
  }

  return a || 1
}

function formatAspectRatio(dimensions: { width: number; height: number }) {
  const divisor = readGreatestCommonDivisor(dimensions.width, dimensions.height)
  return `${Math.round(dimensions.width / divisor)}:${Math.round(dimensions.height / divisor)}`
}

function clampPixelRatio(ratio: number, maxRatio = customDimensionMaxRatio) {
  return Math.max(1 / maxRatio, Math.min(maxRatio, ratio))
}

function derivePixelSizeForRatio(aspect: { width: number; height: number }, targetPixels: number) {
  const ratio = clampPixelRatio(aspect.width / aspect.height)
  let width = roundToMultiple(Math.sqrt(targetPixels * ratio), 16)
  let height = roundToMultiple(width / ratio, 16)

  if (Math.max(width, height) > customDimensionMaxEdge) {
    if (width >= height) {
      width = customDimensionMaxEdge
      height = roundToMultiple(width / ratio, 16)
    } else {
      height = customDimensionMaxEdge
      width = roundToMultiple(height * ratio, 16)
    }
  }

  while (width * height > customDimensionMaxPixels || Math.max(width, height) > customDimensionMaxEdge) {
    if (width >= height) {
      width = Math.max(16, width - 16)
      height = roundToMultiple(width / ratio, 16)
    } else {
      height = Math.max(16, height - 16)
      width = roundToMultiple(height * ratio, 16)
    }
  }

  while (width * height < customDimensionMinPixels) {
    if (width <= height) {
      width += 16
      height = roundToMultiple(width / ratio, 16)
    } else {
      height += 16
      width = roundToMultiple(height * ratio, 16)
    }
  }

  return { width, height }
}

function resolvePixelPresetSize(size: string, aspect: { width: number; height: number }, minPixels = customDimensionMinPixels) {
  const presetPixels = pixelSizePresetMaxPixels.get(size.toLowerCase())
  if (!presetPixels) {
    return size
  }

  return formatDimensions(derivePixelSizeForRatio(aspect, Math.max(minPixels, presetPixels)))
}

function shouldResolveSizePresetToPixels(config: ModelConfig) {
  return (
    config.provider === 'seedream' ||
    config.provider === 'qwen' ||
    config.provider === 'flux' ||
    config.provider === 'comfyui'
  )
}

function deriveCodexSizeForRatio(aspect: { width: number; height: number }, maxEdge: number, maxPixels: number) {
  const sourceRatio = aspect.width / aspect.height
  const ratio = Math.max(1 / gptImage2MaxRatio, Math.min(gptImage2MaxRatio, sourceRatio))
  const heightLimitByEdge = ratio >= 1 ? maxEdge / ratio : maxEdge
  const heightLimitByPixels = Math.sqrt(maxPixels / ratio)
  const height = roundDownToMultiple(Math.min(heightLimitByEdge, heightLimitByPixels), 16)
  const width = roundDownToMultiple(height * ratio, 16)
  let candidate = { width, height }

  while (
    candidate.width * candidate.height > maxPixels ||
    Math.max(candidate.width, candidate.height) > maxEdge ||
    Math.max(candidate.width, candidate.height) / Math.min(candidate.width, candidate.height) > gptImage2MaxRatio
  ) {
    if (candidate.width >= candidate.height) {
      candidate.width -= 16
      candidate.height = roundDownToMultiple(candidate.width / ratio, 16)
    } else {
      candidate.height -= 16
      candidate.width = roundDownToMultiple(candidate.height * ratio, 16)
    }
  }

  while (candidate.width * candidate.height < gptImage2MinPixels) {
    const nextHeight = roundDownToMultiple(candidate.height + 16, 16)
    const nextWidth = roundDownToMultiple(nextHeight * ratio, 16)
    const nextCandidate = { width: nextWidth, height: nextHeight }

    if (
      nextCandidate.width * nextCandidate.height > maxPixels ||
      Math.max(nextCandidate.width, nextCandidate.height) > gptImage2MaxEdge ||
      Math.max(nextCandidate.width, nextCandidate.height) / Math.min(nextCandidate.width, nextCandidate.height) > gptImage2MaxRatio
    ) {
      break
    }

    candidate = nextCandidate
  }

  return `${candidate.width}x${candidate.height}`
}

export function resolveImageRequestSize(params: Pick<ImageGenerationParams, 'canvasSize' | 'config' | 'ratio' | 'references' | 'size'>) {
  const pixelDimensions = parseDimensionText(params.size)
  if (pixelDimensions) {
    return formatDimensions(pixelDimensions)
  }

  if (params.config.provider === 'codex-image-server') {
    const preset = codexSizePresets.get(params.size.toLowerCase())
    if (preset) {
      return deriveCodexSizeForRatio(resolveCodexAspectDimensions(params), preset.maxEdge, preset.maxPixels)
    }
  }

  if (shouldResolveSizePresetToPixels(params.config)) {
    return resolvePixelPresetSize(params.size, resolveCodexAspectDimensions(params))
  }

  return params.size
}

async function requestOpenAiLike(params: ImageGenerationParams) {
  const path = resolveOpenAiLikePath(params.config, Boolean(params.references.length))
  const url = joinUrl(resolveBaseUrl(params.config), path)

  if (!params.references.length) {
    return fetchJson(url, {
      method: 'POST',
      headers: createAuthHeaders(params.config),
      signal: params.signal,
      body: JSON.stringify(buildOpenAiRequest(params))
    }, readTimingContext(params, 'generate'))
  }

  const form = new FormData()
  form.append('model', params.config.model)
  form.append('prompt', params.prompt)
  form.append('n', String(params.count))
  form.append('size', params.size)
  form.append('quality', readOpenAiQuality(params.quality))
  params.references.forEach((reference, index) => {
    form.append('image', dataUrlToBlob(reference.image.previewUrl), `reference-${index + 1}.png`)
  })

  return fetchJson(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.config.apiKey}`
    },
    signal: params.signal,
    body: form
  }, readTimingContext(params, 'edit'))
}

async function requestCustomOpenAiImagesCompatible(params: ImageGenerationParams) {
  const path = resolveCustomV1Path(params.config, params.references.length ? '/images/edits' : '/images/generations')
  const url = joinUrl(resolveBaseUrl(params.config), path)
  if (!params.references.length) {
    return fetchJson(url, {
      method: 'POST',
      headers: createAuthHeaders(params.config),
      signal: params.signal,
      body: JSON.stringify(buildCustomOpenAiImagesRequest(params))
    }, readTimingContext(params, 'generate'))
  }

  const form = new FormData()
  form.append('model', params.config.model)
  form.append('prompt', params.prompt)
  form.append('n', String(params.count))
  form.append('size', params.size)
  params.references.forEach((reference, index) => {
    form.append('image', dataUrlToBlob(reference.image.previewUrl), `reference-${index + 1}.png`)
  })

  return fetchJson(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.config.apiKey}`
    },
    signal: params.signal,
    body: form
  }, readTimingContext(params, 'edit'))
}

async function requestOpenAiChatCompatible(params: ImageGenerationParams) {
  const path = resolveCustomV1Path(params.config, '/chat/completions')
  const url = joinUrl(resolveBaseUrl(params.config), path)
  return fetchJson(url, {
    method: 'POST',
    headers: createAuthHeaders(params.config),
    signal: params.signal,
    body: JSON.stringify(buildOpenAiChatRequest(params))
  }, readTimingContext(params, 'chatCompletions'))
}

async function requestCustomProvider(params: ImageGenerationParams) {
  const format = readCustomModelFormat(params.config)
  if (format === 'openai-chat') {
    return requestOpenAiChatCompatible(params)
  }

  return requestCustomOpenAiImagesCompatible(params)
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

async function requestApimart(params: ImageGenerationParams) {
  const payload = await fetchJson(joinUrl(resolveBaseUrl(params.config), providerPaths.apimart ?? ''), {
    method: 'POST',
    headers: createAuthHeaders(params.config),
    signal: params.signal,
    body: JSON.stringify(buildApimartRequest(params))
  }, readTimingContext(params, 'submit'))

  const taskId = readApimartTaskId(payload)
  if (!taskId) {
    return payload
  }

  for (let attempt = 0; attempt < apimartPollAttempts; attempt += 1) {
    const result = await fetchJson(joinUrl(resolveBaseUrl(params.config), `/v1/tasks/${encodeURIComponent(taskId)}?language=zh`), {
      method: 'GET',
      headers: createAuthHeaders(params.config),
      signal: params.signal
    }, readTimingContext(params, 'poll', { taskId, attempt: attempt + 1 }))
    const status = readApimartTaskStatus(result)
    if (!status || status === 'completed' || status === 'succeeded' || status === 'success') {
      return result
    }
    if (status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled') {
      throw new ImageApiError(readApimartTaskError(result) || 'APIMart 任务失败', 502)
    }
    await wait(apimartPollIntervalMs, params.signal)
  }

  throw new ImageApiError(`APIMart 任务超时：${taskId}`, 504)
}

async function requestCodexImageServer(params: ImageGenerationParams) {
  const baseUrl = resolveBaseUrl(params.config)
  const payload = await fetchJson(joinUrl(baseUrl, providerPaths['codex-image-server'] ?? ''), {
    method: 'POST',
    headers: createAuthHeaders(params.config),
    signal: params.signal,
    body: JSON.stringify(buildCodexImageServerRequest(params))
  }, readTimingContext(params, 'generate'))

  const data = Array.isArray((payload as any).data) ? (payload as any).data : undefined
  const imageItems = data?.length ? data : (payload as any).url ? [payload] : []
  if (!imageItems.length) {
    return payload
  }

  const normalized = await Promise.all(
    imageItems.map(async (item: any, index: number) => {
      const imageUrl = item.previewUrl ?? item.url
      if (!imageUrl) {
        return undefined
      }

      if (String(imageUrl).startsWith('data:')) {
        return {
          previewUrl: imageUrl,
          label: item.label ?? `生成图 ${index + 1}`,
          resolvedSize: item.resolved_size ?? (payload as any).resolved_size
        }
      }

      return {
        previewUrl: await blobToDataUrl(
          await fetchBlob(imageUrl, {
            method: 'GET',
            headers: createAuthHeaders(params.config),
            signal: params.signal
          })
        ),
        label: item.label ?? `生成图 ${index + 1}`,
        resolvedSize: item.resolved_size ?? (payload as any).resolved_size
      }
    })
  )

  return {
    data: normalized.filter(Boolean)
  }
}

async function requestGemini(params: ImageGenerationParams) {
  return fetchJson(resolveGeminiGenerateUrl(params.config), {
    method: 'POST',
    headers: createAuthHeaders(params.config),
    signal: params.signal,
    body: JSON.stringify(buildGeminiRequest(params))
  }, readTimingContext(params, 'generateContent'))
}

async function requestDashScope(params: ImageGenerationParams) {
  const payload = await fetchJson(joinUrl(resolveBaseUrl(params.config), providerPaths[params.config.provider] ?? ''), {
    method: 'POST',
    headers:
      params.config.provider === 'kling'
        ? { ...createAuthHeaders(params.config), 'X-DashScope-Async': 'enable' }
        : createAuthHeaders(params.config),
    signal: params.signal,
    body: JSON.stringify(params.config.provider === 'kling' ? buildKlingRequest(params) : buildQwenRequest(params))
  }, readTimingContext(params, 'submit'))

  if (params.config.provider !== 'kling') {
    return payload
  }

  const taskId = (payload as KlingTaskResponse).output?.task_id
  if (!taskId) {
    return payload
  }

  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    const result = await fetchJson(joinUrl(resolveBaseUrl(params.config), `/api/v1/tasks/${taskId}`), {
      method: 'GET',
      headers: createAuthHeaders(params.config),
      signal: params.signal
    }, readTimingContext(params, 'poll', { taskId, attempt: attempt + 1 }))
    const status = (result as KlingTaskResponse).output?.task_status
    if (!status || status === 'SUCCEEDED') {
      return result
    }
    if (status === 'FAILED' || status === 'CANCELED') {
      throw new ImageApiError('Kling 任务失败', 502)
    }
    await wait(pollIntervalMs, params.signal)
  }

  throw new ImageApiError('Kling 任务超时', 504)
}

async function requestSeedream(params: ImageGenerationParams) {
  const maxImages = Math.max(1, Math.min(params.count, 15 - params.references.length))
  return fetchJson(joinUrl(resolveBaseUrl(params.config), providerPaths.seedream ?? ''), {
    method: 'POST',
    headers: createAuthHeaders(params.config),
    signal: params.signal,
    body: JSON.stringify({
      model: params.config.model,
      prompt: params.prompt,
      image: params.references.map((reference) => reference.image.previewUrl),
      response_format: 'url',
      size: params.size,
      sequential_image_generation: maxImages > 1 ? 'auto' : 'disabled',
      sequential_image_generation_options: maxImages > 1 ? { max_images: maxImages } : undefined,
      watermark: false
    })
  }, readTimingContext(params, 'generate', { maxImages }))
}

async function requestFlux(params: ImageGenerationParams) {
  const payload = await fetchJson(joinUrl(resolveBaseUrl(params.config), `/v1/${params.config.model}`), {
    method: 'POST',
    headers: createAuthHeaders(params.config),
    signal: params.signal,
    body: JSON.stringify(buildFluxRequest(params))
  }, readTimingContext(params, 'submit'))
  const pollingUrl = (payload as BflTaskResponse).polling_url
  if (!pollingUrl) {
    return payload
  }

  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    const result = await fetchJson(pollingUrl, {
      method: 'GET',
      headers: createAuthHeaders(params.config),
      signal: params.signal
    }, readTimingContext(params, 'poll', { attempt: attempt + 1 }))
    const status = (result as any).status
    if (!status || status === 'Ready') {
      return result
    }
    if (status === 'Error' || status === 'Failed') {
      throw new ImageApiError('FLUX 任务失败', 502)
    }
    await wait(pollIntervalMs, params.signal)
  }

  throw new ImageApiError('FLUX 任务超时', 504)
}

async function requestComfyUi(params: ImageGenerationParams) {
  const settings = normalizeComfyUiSettings(params.config.comfyUi)
  const workflowText = settings.workflow.trim()
  if (!workflowText) {
    throw new ImageApiError('请导入 ComfyUI workflow', 400)
  }

  let workflow: Record<string, any>
  try {
    workflow = workflowText ? JSON.parse(workflowText) : {}
  } catch {
    throw new ImageApiError('ComfyUI workflow JSON 无效', 400)
  }

  const baseUrl = readComfyUiBaseUrl(params.config)
  const uploadedImages = await Promise.all(
    params.references.map((reference, index) => uploadComfyUiImage(baseUrl, params.config, reference, index))
  )
  applyComfyUiWorkflowNodes(workflow, settings.workflowNodes, params, uploadedImages)

  const clientId = `lightyear-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const task = (await fetchJson(joinUrl(baseUrl, '/prompt'), {
    method: 'POST',
    headers: {
      ...createAuthHeaders(params.config),
      'Content-Type': 'application/json'
    },
    signal: params.signal,
    body: JSON.stringify({ prompt: workflow, client_id: clientId })
  }, readTimingContext(params, 'submit', { clientId }))) as ComfyUiPromptResponse

  if (!task.prompt_id) {
    throw new ImageApiError('ComfyUI 未返回任务 ID', 502)
  }

  const timeoutMs = Math.max(1000, settings.timeoutMs)
  const pollMs = Math.max(250, settings.pollIntervalMs)
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const history = await fetchJson(joinUrl(baseUrl, `/history/${task.prompt_id}`), {
      method: 'GET',
      headers: createAuthHeaders(params.config),
      signal: params.signal
    }, readTimingContext(params, 'poll', { taskId: task.prompt_id }))
    const images = readComfyUiHistoryImages(baseUrl, history, task.prompt_id)
    if (images.length) {
      const normalizedImages = await Promise.all(
        images.map(async (image) => ({
          ...image,
          previewUrl: await blobToDataUrl(
            await fetchBlob(image.previewUrl, {
              method: 'GET',
              headers: createAuthHeaders(params.config),
              signal: params.signal
            })
          )
        }))
      )
      return { data: normalizedImages }
    }

    await wait(pollMs, params.signal)
  }

  throw new ImageApiError('ComfyUI 任务超时', 504)
}

function readOpenAiImages(payload: any): NormalizedImageResult[] {
  return (payload.data ?? [])
    .map((item: any, index: number) => ({
      previewUrl: item.previewUrl ?? item.url ?? (item.b64_json ? `data:image/png;base64,${item.b64_json}` : ''),
      label: `生成图 ${index + 1}`
    }))
    .filter((item: NormalizedImageResult) => item.previewUrl)
}

function readOpenAiChatImages(payload: any): NormalizedImageResult[] {
  const contents = payload.choices?.map((choice: any) => choice.message?.content).filter(Boolean) ?? []
  const urls = contents.flatMap((content: any) => {
    if (typeof content === 'string') {
      return [...content.matchAll(/!\[[^\]]*]\((data:image\/[^)]+|https?:\/\/[^)]+)\)/g)].map((match) => match[1])
    }

    if (!Array.isArray(content)) {
      return []
    }

    return content
      .map((part: any) => part.image_url?.url ?? part.imageUrl?.url ?? part.image ?? part.url)
      .filter(Boolean)
  })

  return urls.map((previewUrl: string, index: number) => ({
    previewUrl,
    label: `生成图 ${index + 1}`
  }))
}

function readGeminiImages(payload: any): NormalizedImageResult[] {
  const source = Array.isArray(payload.data?.candidates) ? payload.data : payload
  const parts = source.candidates?.flatMap((candidate: any) => candidate.content?.parts ?? []) ?? []
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

function readDashScopeImages(payload: any): NormalizedImageResult[] {
  if (Array.isArray(payload.data)) {
    return payload.data
      .map((item: any, index: number) => ({
        previewUrl: item.url ?? (item.b64_json ? `data:image/png;base64,${item.b64_json}` : ''),
        label: `生成图 ${index + 1}`
      }))
      .filter((item: NormalizedImageResult) => item.previewUrl)
  }

  const content = payload.output?.choices?.flatMap((choice: any) => choice.message?.content ?? []) ?? []
  return content
    .filter((item: any) => item.image)
    .map((item: any, index: number) => ({
      previewUrl: item.image,
      label: `生成图 ${index + 1}`
    }))
}

function readKlingImages(payload: any): NormalizedImageResult[] {
  const content = payload.output?.choices?.flatMap((choice: any) => choice.message?.content ?? [])
  const items = content?.length ? content : payload.output?.results ?? []

  return items.map((item: any, index: number) => ({
    previewUrl: item.image ?? item.url,
    label: `生成图 ${index + 1}`
  }))
}

function readFluxImages(payload: any): NormalizedImageResult[] {
  const sample = payload.result?.sample ?? payload.sample
  const samples = Array.isArray(sample) ? sample : sample ? [sample] : []

  return samples.map((item: string, index: number) => ({
    previewUrl: item,
    label: `生成图 ${index + 1}`
  }))
}

function readImages(config: ModelConfig, payload: any) {
  if (config.provider === 'comfyui') {
    return payload.data ?? []
  }

  if (config.provider === 'codex-image-server') {
    if (Array.isArray(payload.data)) {
      return payload.data
    }

    return payload.url ? [{ previewUrl: payload.url, label: '生成图 1' }] : []
  }

  if (config.provider === 'gemini') {
    return readGeminiImages(payload)
  }

  if (config.provider === 'apimart') {
    return readApimartImages(payload)
  }

  if (config.provider === 'qwen') {
    return readDashScopeImages(payload)
  }

  if (config.provider === 'kling') {
    return readKlingImages(payload)
  }

  if (config.provider === 'flux') {
    return readFluxImages(payload)
  }

  if (shouldUseOpenAiChatFormat(config)) {
    return readOpenAiChatImages(payload)
  }

  return readOpenAiImages(payload)
}

async function requestProviderPayload(params: ImageGenerationParams) {
  if (params.config.provider === 'gemini') {
    return requestGemini(params)
  }

  if (params.config.provider === 'apimart') {
    return requestApimart(params)
  }

  if (params.config.provider === 'custom-openai') {
    return requestCustomProvider(params)
  }

  if (params.config.provider === 'qwen' || params.config.provider === 'kling') {
    return requestDashScope(params)
  }

  if (params.config.provider === 'seedream') {
    return requestSeedream(params)
  }

  if (params.config.provider === 'flux') {
    return requestFlux(params)
  }

  if (params.config.provider === 'comfyui') {
    return requestComfyUi(params)
  }

  if (params.config.provider === 'codex-image-server') {
    return requestCodexImageServer(params)
  }

  return requestOpenAiLike(params)
}

export async function generateImagesWithProvider(params: ImageGenerationParams) {
  const payload = await requestProviderPayload(params)
  const images = readImages(params.config, payload)
  if (!images.length) {
    throw new ImageApiError('API 未返回图片', 502)
  }

  return images.slice(0, params.count)
}

export async function testImageConfig(config: ModelConfig) {
  if (config.provider === 'comfyui') {
    await fetchJson(joinUrl(readComfyUiBaseUrl(config), '/system_stats'), {
      method: 'GET',
      headers: createAuthHeaders(config)
    })
    return
  }

  if (config.provider === 'codex-image-server') {
    const baseUrl = resolveBaseUrl(config)
    await fetchJson(joinUrl(baseUrl, '/healthz'), {
      method: 'GET',
      headers: createAuthHeaders(config)
    })
    await fetchJson(joinUrl(baseUrl, '/v1/capabilities'), {
      method: 'GET',
      headers: createAuthHeaders(config)
    })
    return
  }

  if (config.provider === 'gemini') {
    const payload = await fetchJson(resolveGeminiModelsUrl(config), {
      method: 'GET',
      headers: createAuthHeaders(config)
    })
    const message = readApiErrorMessage(payload as ApiErrorPayload, '')
    if ((payload as ApiErrorPayload).error || message) {
      throw new ImageApiError(message || 'Gemini API 配置不可用', 400)
    }
    return
  }

  if (config.provider === 'apimart') {
    const payload = await fetchJson(joinUrl(resolveBaseUrl(config), '/v1/models'), {
      method: 'GET',
      headers: createAuthHeaders(config)
    })
    const message = readApiErrorMessage(payload as ApiErrorPayload, '')
    if ((payload as ApiErrorPayload).error || message) {
      throw new ImageApiError(message || 'APIMart API 配置不可用', 400)
    }
    return
  }

  if (config.provider === 'custom-openai') {
    const url = resolveCustomModelsUrl(config)
    const payload = await fetchJson(url, {
      method: 'GET',
      headers: createAuthHeaders(config)
    })
    const message = readApiErrorMessage(payload as ApiErrorPayload, '')
    if ((payload as ApiErrorPayload).error || message) {
      throw new ImageApiError(message || 'API 配置不可用', 400)
    }
    return
  }

  const prompt = 'connection test'
  const params: ImageGenerationParams = {
    config,
    count: 1,
    prompt,
    quality: '自动',
    ratio: config.provider === 'kling' ? '1:1' : '原图比例',
    references: [],
    size:
      config.provider === 'qwen'
          ? '1024*1024'
          : config.provider === 'kling'
            ? '1k'
            : config.provider === 'seedream'
              ? '1K'
              : '1024x1024'
  }
  await generateImagesWithProvider(params)
}

import { normalizeComfyUiSettings } from '../data/comfyUiDefaults'
import type { ComfyUiNodeMapping, ImageProviderId, ModelConfig, ReferenceImage } from '../types/lightyear'

export type NormalizedImageResult = {
  previewUrl: string
  label: string
}

export type ImageGenerationParams = {
  canvasSize?: { width: number; height: number }
  config: ModelConfig
  count: number
  prompt: string
  quality: string
  ratio: string
  references: ReferenceImage[]
  signal?: AbortSignal
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
  'codex-image-server': '/v1/images/generate',
  gemini: '/v1beta/models',
  kling: '/api/v1/services/aigc/image-generation/generation',
  openai: '/v1/images/generations',
  qwen: '/api/v1/services/aigc/multimodal-generation/generation',
  seedream: '/api/v3/images/generations',
  'custom-openai': '/v1/images/generations'
}

const providerBaseUrls: Partial<Record<ImageProviderId, string>> = {
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
  return payload.error?.message ?? payload.message ?? payload.detail ?? fallback
}

async function fetchJson(url: string, init: RequestInit) {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted || error instanceof DOMException && error.name === 'AbortError') {
      throw new ImageApiError('请求已取消', 499)
    }
    throw new ImageApiError('无法连接 API', 0)
  }

  const payload = await readResponseJson(response)
  if (!response.ok) {
    throw new ImageApiError(readApiErrorMessage(payload as ApiErrorPayload, 'API 请求失败'), response.status)
  }

  return payload
}

function resolveBaseUrl(config: ModelConfig) {
  if (config.provider === 'custom-openai' || config.provider === 'comfyui' || config.provider === 'codex-image-server') {
    return config.baseUrl || providerBaseUrls[config.provider] || ''
  }

  return providerBaseUrls[config.provider] ?? config.baseUrl
}

function resolveOpenAiLikePath(config: ModelConfig, hasReferences: boolean) {
  if (config.provider !== 'custom-openai') {
    return hasReferences ? '/v1/images/edits' : providerPaths[config.provider] ?? '/v1/images/generations'
  }

  const prefix = config.baseUrl.replace(/\/+$/, '').endsWith('/v1') ? '' : '/v1'

  return `${prefix}${hasReferences ? '/images/edits' : '/images/generations'}`
}

function createAuthHeaders(config: ModelConfig): Record<string, string> {
  if (config.provider === 'codex-image-server') {
    return { 'Content-Type': 'application/json' }
  }

  if (config.provider === 'comfyui') {
    return config.apiKey.trim() ? { Authorization: `Bearer ${config.apiKey}` } : {}
  }

  if (config.provider === 'gemini') {
    return { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey }
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
      size: params.size,
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
  if (params.config.model !== 'gemini-2.5-flash-image' && params.size !== '默认') {
    imageConfig.imageSize = params.size
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
      candidateCount: params.count,
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
  const path = resolveOpenAiLikePath(params.config, Boolean(params.references.length))
  const url = joinUrl(resolveBaseUrl(params.config), path)

  if (!params.references.length) {
    return fetchJson(url, {
      method: 'POST',
      headers: createAuthHeaders(params.config),
      signal: params.signal,
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
    form.append('image', dataUrlToBlob(reference.image.previewUrl), `reference-${index + 1}.png`)
  })

  return fetchJson(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.config.apiKey}`
    },
    signal: params.signal,
    body: form
  })
}

async function requestCodexImageServer(params: ImageGenerationParams) {
  const baseUrl = resolveBaseUrl(params.config)
  const payload = await fetchJson(joinUrl(baseUrl, providerPaths['codex-image-server'] ?? ''), {
    method: 'POST',
    headers: createAuthHeaders(params.config),
    signal: params.signal,
    body: JSON.stringify(buildCodexImageServerRequest(params))
  })

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
          label: item.label ?? `生成图 ${index + 1}`
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
        label: item.label ?? `生成图 ${index + 1}`
      }
    })
  )

  return {
    data: normalized.filter(Boolean)
  }
}

async function requestGemini(params: ImageGenerationParams) {
  return fetchJson(joinUrl(resolveBaseUrl(params.config), `/v1beta/models/${params.config.model}:generateContent`), {
    method: 'POST',
    headers: createAuthHeaders(params.config),
    signal: params.signal,
    body: JSON.stringify(buildGeminiRequest(params))
  })
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
  })

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
    })
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
  })
}

async function requestFlux(params: ImageGenerationParams) {
  const payload = await fetchJson(joinUrl(resolveBaseUrl(params.config), `/v1/${params.config.model}`), {
    method: 'POST',
    headers: createAuthHeaders(params.config),
    signal: params.signal,
    body: JSON.stringify(buildFluxRequest(params))
  })
  const pollingUrl = (payload as BflTaskResponse).polling_url
  if (!pollingUrl) {
    return payload
  }

  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    const result = await fetchJson(pollingUrl, {
      method: 'GET',
      headers: createAuthHeaders(params.config),
      signal: params.signal
    })
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
  })) as ComfyUiPromptResponse

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
    })
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

function readImages(provider: ImageProviderId, payload: any) {
  if (provider === 'comfyui') {
    return payload.data ?? []
  }

  if (provider === 'codex-image-server') {
    if (Array.isArray(payload.data)) {
      return payload.data
    }

    return payload.url ? [{ previewUrl: payload.url, label: '生成图 1' }] : []
  }

  if (provider === 'gemini') {
    return readGeminiImages(payload)
  }

  if (provider === 'qwen') {
    return readDashScopeImages(payload)
  }

  if (provider === 'kling') {
    return readKlingImages(payload)
  }

  if (provider === 'flux') {
    return readFluxImages(payload)
  }

  return readOpenAiImages(payload)
}

export async function generateImagesWithProvider(params: ImageGenerationParams) {
  let payload: any
  if (params.config.provider === 'gemini') {
    payload = await requestGemini(params)
  } else if (params.config.provider === 'qwen' || params.config.provider === 'kling') {
    payload = await requestDashScope(params)
  } else if (params.config.provider === 'seedream') {
    payload = await requestSeedream(params)
  } else if (params.config.provider === 'flux') {
    payload = await requestFlux(params)
  } else if (params.config.provider === 'comfyui') {
    payload = await requestComfyUi(params)
  } else if (params.config.provider === 'codex-image-server') {
    payload = await requestCodexImageServer(params)
  } else {
    payload = await requestOpenAiLike(params)
  }

  const images = readImages(params.config.provider, payload)
  if (!images.length) {
    throw new ImageApiError('API 未返回图片', 502)
  }

  return images
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
      headers: { 'Content-Type': 'application/json' }
    })
    await fetchJson(joinUrl(baseUrl, '/v1/capabilities'), {
      method: 'GET',
      headers: createAuthHeaders(config)
    })
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
      config.provider === 'gemini'
        ? config.model === 'gemini-2.5-flash-image'
          ? '默认'
          : '1K'
        : config.provider === 'qwen'
          ? '1024*1024'
          : config.provider === 'kling'
            ? '1k'
            : config.provider === 'seedream'
              ? '1K'
              : '1024x1024'
  }
  await generateImagesWithProvider(params)
}

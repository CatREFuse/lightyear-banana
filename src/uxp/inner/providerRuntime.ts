import {
  generateImagesWithProvider,
  isRetryableImageRequestError,
  maxImageRequestRetryCount,
  testImageConfig,
  type NormalizedImageResult
} from '../../services/imageApiClient'
import type { ImageProviderId, ModelConfig, ReferenceImage } from '../../types/mugen'
import { providerRequiresApiKey } from '../../data/providerCapabilities'
import { createCanvasImageFromApiAsset } from '../../utils/imagePixels'
import { canUseDevelopmentApimartBaseUrl } from '../../utils/apimartDevelopmentConfig'
import { getHostRequire } from '../photoshopHost'
import { AssetStore } from './assetStore'
import { getCredential, getSettings } from './storage'
import { toHostAssetPointer, type GenerationSnapshot, type HistoryUpsertEntry, type RequestLog, type TaskPhase } from '../../../packages/inner-protocol/src/index'
import { validateProviderGenerationParameters } from '../../../packages/inner-protocol/src/providerCapabilityData'

type RuntimeEvent = 'generation.progress' | 'generation.completed' | 'generation.failed'

type RuntimeEmitter = (event: RuntimeEvent, payload: unknown) => void

type RuntimeOptions = {
  assets: AssetStore
  emit: RuntimeEmitter
  persistHistory: (entry: HistoryUpsertEntry) => Promise<void>
}

type MugenEnvironment = 'development' | 'test' | 'production'

type ProviderPreviewContext = {
  config?: Pick<ModelConfig, 'provider' | 'apiKey' | 'baseUrl'>
  environment?: MugenEnvironment
}

type ProviderPreviewMaterializationOptions = ProviderPreviewContext & {
  fetchImplementation?: typeof fetch
}

type RunningTask = {
  controller: AbortController
  startedAt: number
  completion?: Promise<void>
}

type ProviderTimingProgressPhase = Extract<TaskPhase, 'uploading' | 'requesting' | 'polling'>
type RuntimeProgressPhase = TaskPhase

const localPreviewProviders = new Set<ImageProviderId>(['comfyui', 'codex-image-server'])
const redirectStatuses = new Set([301, 302, 303, 307, 308])
const maxPreviewRedirects = 5
const maxPreviewBytes = 128 * 1024 * 1024
const reservedRemoteDomains = [
  'localhost',
  'localdomain',
  'internal',
  'lan',
  'local',
  'home',
  'home.arpa',
  'test',
  'invalid',
  'example',
  'example.com',
  'example.net',
  'example.org',
  'onion',
  'arpa',
  'localtest.me',
  'lvh.me',
  'nip.io',
  'sslip.io',
  'vcap.me'
] as const

function createTaskId() {
  return `generation-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function elapsedSeconds(startedAt: number) {
  return Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
}

function messageFromError(error: unknown, apiKey = '') {
  const message = error instanceof Error ? error.message : '生成失败，请稍后再试'
  return apiKey ? message.split(apiKey).join('[redacted]') : message
}

export function redactUrl(value: string) {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return value.replace(/([?&](?:api[_-]?key|token|key)=)[^&\s]+/gi, '$1[redacted]')
  }
}

function bytesToBase64(bytes: Uint8Array, signal?: AbortSignal) {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    if (signal?.aborted) throw abortError()
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function normalizeHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, '')
  return normalized.startsWith('[') && normalized.endsWith(']') ? normalized.slice(1, -1) : normalized
}

function readIpv4(hostname: string) {
  const parts = hostname.split('.')
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return undefined
  const octets = parts.map(Number)
  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : undefined
}

function isIpLiteral(hostname: string) {
  return hostname.includes(':') || Boolean(readIpv4(hostname)) || /^\d+(?:\.\d+){0,3}$/.test(hostname)
}

function isLoopbackHostname(hostname: string) {
  if (hostname === 'localhost' || hostname === '::1' || hostname === '0:0:0:0:0:0:0:1') return true
  return readIpv4(hostname)?.[0] === 127
}

function runtimeEnvironment(): MugenEnvironment {
  return typeof __MUGEN_APP_ENV__ === 'undefined' ? 'production' : __MUGEN_APP_ENV__
}

function isAuthorizedApimartFixturePreview(url: URL, provider: ImageProviderId, context?: ProviderPreviewContext) {
  const config = context?.config
  if (!config || provider !== 'apimart' || config.provider !== provider) return false
  const environment = context.environment ?? runtimeEnvironment()
  if (!canUseDevelopmentApimartBaseUrl(config, environment)) return false
  try {
    const fixtureOrigin = new URL(config.baseUrl).origin
    return isLoopbackHostname(normalizeHostname(url.hostname)) && url.origin === fixtureOrigin
  } catch {
    return false
  }
}

function isDomainOrSubdomain(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`)
}

function isValidPublicHostname(hostname: string) {
  if (hostname.length > 253 || !hostname.includes('.')) return false
  return hostname.split('.').every((label) => (
    label.length > 0
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ))
}

/**
 * UXP does not expose a DNS-resolution hook, so remote downloads reject every
 * IP literal and revalidate the hostname on each redirect. DNS pinning remains
 * the responsibility of the runtime/network boundary.
 */
export function validateProviderPreviewNetworkUrl(value: string, provider: ImageProviderId, context?: ProviderPreviewContext) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('生成图片地址无效')
  }

  if (url.username || url.password) throw new Error('生成图片地址不能包含凭据')
  const hostname = normalizeHostname(url.hostname)
  if (!hostname) throw new Error('生成图片地址无效')

  if (isAuthorizedApimartFixturePreview(url, provider, context)) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('本地图片地址协议不受支持')
    return url
  }

  if (localPreviewProviders.has(provider)) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('本地图片地址协议不受支持')
    if (!isLoopbackHostname(hostname)) throw new Error('本地模型只能返回回环地址')
    return url
  }

  if (url.protocol !== 'https:') throw new Error('远程图片地址必须使用 HTTPS')
  if (isIpLiteral(hostname)) throw new Error('远程图片地址不能使用 IP')
  if (!isValidPublicHostname(hostname)) throw new Error('远程图片地址域名无效')
  if (reservedRemoteDomains.some((domain) => isDomainOrSubdomain(hostname, domain))) {
    throw new Error('远程图片地址域名不受支持')
  }
  return url
}

function validateInlineImageDataUrl(value: string) {
  const separator = value.indexOf(',')
  if (separator < 0) throw new Error('生成图片数据无效')
  const metadata = value.slice(5, separator).split(';')
  const mimeType = metadata.shift()?.trim().toLowerCase() ?? ''
  if (!/^image\/[a-z0-9][a-z0-9.+-]*$/.test(mimeType) || !metadata.some((item) => item.trim().toLowerCase() === 'base64')) {
    throw new Error('生成图片数据必须是 Base64 图片')
  }

  const base64 = value.slice(separator + 1).replace(/\s/g, '')
  if (!/^[a-z0-9+/]*={0,2}$/i.test(base64) || base64.length % 4 === 1) throw new Error('生成图片数据无效')
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  const decodedBytes = Math.floor(base64.length * 3 / 4) - padding
  if (decodedBytes > maxPreviewBytes) throw new Error('生成图片超过大小限制')
  return value
}

function readImageMimeType(response: Response) {
  const mimeType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (!/^image\/[a-z0-9][a-z0-9.+-]*$/.test(mimeType)) throw new Error('生成结果不是图片')
  return mimeType
}

export async function materializeProviderPreviewUrl(
  previewUrl: string,
  provider: ImageProviderId,
  signal: AbortSignal,
  options: ProviderPreviewMaterializationOptions = {}
) {
  if (/^data:/i.test(previewUrl)) return validateInlineImageDataUrl(previewUrl)

  const fetchImplementation = options.fetchImplementation ?? fetch
  let currentUrl = validateProviderPreviewNetworkUrl(previewUrl, provider, options)
  for (let redirectCount = 0; ; redirectCount += 1) {
    if (signal.aborted) throw abortError()
    const response = await fetchImplementation(currentUrl.toString(), {
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'manual',
      signal
    })
    if (response.redirected) throw new Error('图片下载发生了未验证的跳转')

    if (redirectStatuses.has(response.status)) {
      if (redirectCount >= maxPreviewRedirects) throw new Error('生成图片跳转次数过多')
      const location = response.headers.get('location')
      if (!location) throw new Error('生成图片跳转地址无效')
      try {
        currentUrl = validateProviderPreviewNetworkUrl(new URL(location, currentUrl).toString(), provider, options)
      } catch (error) {
        if (error instanceof Error) throw error
        throw new Error('生成图片跳转地址无效')
      }
      continue
    }

    if (!response.ok) throw new Error('生成图片下载失败')
    const mimeType = readImageMimeType(response)
    const contentLengthValue = response.headers.get('content-length')
    if (contentLengthValue !== null) {
      const contentLength = Number(contentLengthValue)
      if (Number.isFinite(contentLength) && contentLength > maxPreviewBytes) throw new Error('生成图片超过大小限制')
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (signal.aborted) throw abortError()
    if (bytes.byteLength > maxPreviewBytes) throw new Error('生成图片超过大小限制')
    return `data:${mimeType};base64,${bytesToBase64(bytes, signal)}`
  }
}

export function mapProviderTimingPhase(value: unknown): ProviderTimingProgressPhase | undefined {
  if (typeof value !== 'string') return undefined
  switch (value.toLowerCase()) {
    case 'upload':
      return 'uploading'
    case 'poll':
      return 'polling'
    case 'submit':
    case 'request':
    case 'generate':
    case 'edit':
    case 'chatcompletions':
    case 'generatecontent':
      return 'requesting'
    default:
      return undefined
  }
}

export function reduceProviderTimingProgress(previous: ProviderTimingProgressPhase | undefined, value: unknown) {
  const current = mapProviderTimingPhase(value)
  if (!current || current === previous) return { current: previous, emitted: undefined }
  return { current, emitted: current }
}

function providerProgressMessage(phase: ProviderTimingProgressPhase) {
  if (phase === 'uploading') return '正在上传参考图'
  if (phase === 'polling') return '正在等待模型结果'
  return '正在请求模型'
}

function isAbort(error: unknown, controller: AbortController) {
  return controller.signal.aborted || error instanceof Error && error.name === 'AbortError'
}

function abortError() {
  const error = new Error('Aborted')
  error.name = 'AbortError'
  return error
}

function toRequestLog(entry: { id: string; method: string; url: string; status: number; createdAt: string; stages: { totalMs: number } }): RequestLog {
  return {
    id: entry.id,
    method: entry.method,
    url: redactUrl(entry.url).slice(0, 2048),
    status: entry.status,
    durationMs: entry.stages.totalMs,
    createdAt: entry.createdAt
  }
}

function toImageProviderId(value: string): ImageProviderId {
  const providerIds: ImageProviderId[] = ['openai', 'iMini', 'gemini', 'apimart', 'seedream', 'qwen', 'kling', 'flux', 'comfyui', 'codex-image-server', 'custom-openai']
  if (!providerIds.includes(value as ImageProviderId)) throw new Error('所选模型服务不受支持')
  return value as ImageProviderId
}

function sanitizeBaseUrl(value: string) {
  if (!value) return value
  const url = new URL(value)
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/, '')
}

async function readConfig(configId: string): Promise<ModelConfig> {
  const settings = await getSettings()
  const config = settings.configs.find((item) => item.id === configId)
  if (!config) throw new Error('找不到所选模型配置')
  if (!config.enabled) throw new Error('所选模型配置已停用')

  const provider = toImageProviderId(config.provider)
  const apiKey = await getCredential({ id: config.id, provider, baseUrl: config.baseUrl })
  if (providerRequiresApiKey(provider) && !apiKey) throw new Error('请先在设置中保存该模型的 API Key')
  return {
    ...config,
    provider,
    apiKey,
    baseUrl: sanitizeBaseUrl(config.baseUrl),
    models: config.models ?? [],
    comfyUi: config.comfyUi as ModelConfig['comfyUi']
  }
}

export function validateHostGenerationRequest(
  config: Pick<ModelConfig, 'provider' | 'model' | 'customFormat'>,
  snapshot: Pick<GenerationSnapshot, 'size' | 'quality' | 'count' | 'ratio' | 'references'>
) {
  const validation = validateProviderGenerationParameters(config, {
    size: snapshot.size,
    quality: snapshot.quality,
    count: snapshot.count,
    ratio: snapshot.ratio,
    referenceCount: snapshot.references.length
  })
  if (!validation.valid) throw new Error(validation.message)
  return validation
}

function toReference(asset: Awaited<ReturnType<AssetStore['getOrRestore']>>): ReferenceImage {
  return {
    id: asset.ref.assetId,
    source: asset.ref.source,
    label: asset.ref.label,
    image: asset.image
  }
}

export class ProviderRuntime {
  private readonly runningTasks = new Map<string, RunningTask>()
  private readonly pendingStarts = new Set<Promise<unknown>>()
  private accepting = true
  private destroyed = false
  private readonly options: RuntimeOptions

  constructor(options: RuntimeOptions) {
    this.options = options
  }

  async start(snapshot: GenerationSnapshot) {
    if (this.destroyed || !this.accepting) throw new Error('生成服务正在清理，请稍后重试')
    const taskId = createTaskId()
    const retainTask = this.options.assets.retain(snapshot.references.map((reference) => reference.assetId), `task:${taskId}`)
    this.pendingStarts.add(retainTask)
    try {
      await retainTask
    } finally {
      this.pendingStarts.delete(retainTask)
    }
    if (this.destroyed || !this.accepting) {
      this.options.assets.releaseOwner(`task:${taskId}`, true)
      throw new Error('生成服务正在清理，请稍后重试')
    }
    const running: RunningTask = { controller: new AbortController(), startedAt: Date.now() }
    this.runningTasks.set(taskId, running)
    running.completion = this.run(taskId, snapshot, running)
    void running.completion
    return { taskId }
  }

  cancel(taskId: string) {
    const running = this.runningTasks.get(taskId)
    if (!running) return { taskId, cancelled: false }
    running.controller.abort()
    return { taskId, cancelled: true }
  }

  cancelAll() {
    let cancelled = 0
    for (const taskId of this.runningTasks.keys()) if (this.cancel(taskId).cancelled) cancelled += 1
    return cancelled
  }

  async waitForIdle() {
    const completions = [...this.runningTasks.values()].map((task) => task.completion).filter((task): task is Promise<void> => Boolean(task))
    await Promise.allSettled(completions)
  }

  async pauseAndDrain() {
    this.accepting = false
    this.cancelAll()
    await Promise.allSettled([...this.pendingStarts])
    this.cancelAll()
    await this.waitForIdle()
  }

  resume() {
    if (!this.destroyed) this.accepting = true
  }

  async testConfig(configId: string) {
    let config: ModelConfig | undefined
    try {
      config = await readConfig(configId)
      await testImageConfig(config)
      return { ok: true, message: '连接成功' }
    } catch (error) {
      return { ok: false, message: messageFromError(error, config?.apiKey) }
    }
  }

  destroy() {
    this.accepting = false
    this.destroyed = true
    this.cancelAll()
    for (const taskId of this.runningTasks.keys()) this.options.assets.releaseOwner(`task:${taskId}`, true)
    this.runningTasks.clear()
  }

  private async run(taskId: string, snapshot: GenerationSnapshot, running: RunningTask) {
    const logs: RequestLog[] = []
    const materializedAssetIds: string[] = []
    let config: ModelConfig | undefined
    try {
      this.emitProgress(taskId, running, 'waiting', '准备生成')
      config = await readConfig(snapshot.configId)
      validateHostGenerationRequest(config, snapshot)
      const references = await Promise.all(snapshot.references.map(async (reference) => toReference(await this.options.assets.getOrRestore(reference.assetId))))
      let canvasSize: { width: number; height: number } | undefined
      try {
        const hostRequire = getHostRequire()
        const document = hostRequire?.('photoshop')?.app?.activeDocument
        if (document) canvasSize = { width: Number(document.width) || 1, height: Number(document.height) || 1 }
      } catch {
        canvasSize = undefined
      }
      this.emitProgress(taskId, running, 'requesting', '正在请求模型')

      let images: NormalizedImageResult[] | undefined
      let lastProviderProgressPhase: ProviderTimingProgressPhase | undefined = 'requesting'
      for (let attempt = 0; attempt <= maxImageRequestRetryCount; attempt += 1) {
        try {
          images = await generateImagesWithProvider({
            canvasSize,
            config,
            count: snapshot.count,
            loadingTaskId: taskId,
            prompt: snapshot.prompt,
            quality: snapshot.quality,
            ratio: snapshot.ratio,
            references,
            selectedSize: snapshot.size,
            signal: running.controller.signal,
            size: snapshot.size,
            onTiming: (entry) => {
              if (logs.length < 50) logs.push(toRequestLog(entry))
              const transition = reduceProviderTimingProgress(lastProviderProgressPhase, entry.metadata?.phase)
              lastProviderProgressPhase = transition.current
              if (transition.emitted) {
                this.emitProgress(taskId, running, transition.emitted, providerProgressMessage(transition.emitted))
              }
            }
          })
          break
        } catch (error) {
          if (isAbort(error, running.controller)) throw error
          if (!isRetryableImageRequestError(error) || attempt === maxImageRequestRetryCount) throw error
          this.emitProgress(taskId, running, 'retrying', '连接不稳定，正在重试', attempt + 1)
          lastProviderProgressPhase = undefined
        }
      }

      if (!images?.length) throw new Error('模型未返回图片')
      this.emitProgress(taskId, running, 'downloading', '正在整理图片')
      const assets = []
      for (let index = 0; index < images.length; index += 1) {
        if (running.controller.signal.aborted) throw abortError()
        const image = images[index]!
        const previewUrl = await materializeProviderPreviewUrl(image.previewUrl, config!.provider, running.controller.signal, {
          config: config!
        })
        const canvasImage = await createCanvasImageFromApiAsset({
          id: `${taskId}-${index + 1}`,
          label: image.label || `生成图片 ${index + 1}`,
          modelConfigId: config!.id,
          modelName: config!.name || config!.model,
          previewUrl
        })
        const asset = await this.options.assets.add('generated', canvasImage, { owner: `task:${taskId}` })
        materializedAssetIds.push(asset.assetId)
        assets.push(asset)
      }

      if (running.controller.signal.aborted) throw abortError()
      try {
        for (const assetId of materializedAssetIds) this.options.assets.get(assetId)
      } catch {
        throw new Error('生成结果超过 Photoshop 暂存容量，请减少图片数量或尺寸')
      }
      await this.options.persistHistory({
        id: taskId,
        updatedAt: new Date().toISOString(),
        prompt: snapshot.prompt,
        assets: assets.map(toHostAssetPointer),
        references: snapshot.references,
        snapshot,
        logs,
        status: 'completed',
        elapsedSeconds: elapsedSeconds(running.startedAt)
      })
      try {
        this.options.emit('generation.completed', { taskId, assets, logs })
        this.emitProgress(taskId, running, 'completed', '生成完成')
      } catch {
        // A committed Host history record remains authoritative if the WebView reloads.
      }
    } catch (error) {
      const cancelled = isAbort(error, running.controller)
      await this.options.assets.removePersistent(materializedAssetIds).catch(() => undefined)
      for (const assetId of materializedAssetIds) this.options.assets.discard(assetId)
      const message = cancelled ? '已取消生成' : messageFromError(error, config?.apiKey)
      try {
        await this.options.persistHistory({
          id: taskId,
          updatedAt: new Date().toISOString(),
          prompt: snapshot.prompt,
          assets: [],
          references: snapshot.references,
          snapshot,
          logs,
          status: cancelled ? 'cancelled' : 'failed',
          elapsedSeconds: elapsedSeconds(running.startedAt),
          ...(!cancelled ? { error: message } : {})
        })
      } catch {
        // The task lease is released below even when local history storage is unavailable.
      }
      try {
        if (cancelled) {
          this.emitProgress(taskId, running, 'cancelled', message)
        } else {
          this.options.emit('generation.failed', {
            taskId,
            error: { code: 'GENERATION_FAILED', message, recoverable: true }
          })
          this.emitProgress(taskId, running, 'failed', '生成失败')
        }
      } catch {
        // Terminal state is already committed when possible; event delivery is best effort.
      }
    } finally {
      this.options.assets.releaseOwner(`task:${taskId}`, true)
      this.runningTasks.delete(taskId)
    }
  }

  private emitProgress(
    taskId: string,
    running: RunningTask,
    phase: RuntimeProgressPhase,
    message: string,
    attempt?: number
  ) {
    this.options.emit('generation.progress', {
      taskId,
      phase,
      elapsedSeconds: elapsedSeconds(running.startedAt),
      message,
      ...(attempt ? { attempt } : {})
    })
  }
}

export function createProviderRuntime(assets: AssetStore, emit: RuntimeEmitter, persistHistory: RuntimeOptions['persistHistory'] = async () => undefined) {
  return new ProviderRuntime({ assets, emit, persistHistory })
}

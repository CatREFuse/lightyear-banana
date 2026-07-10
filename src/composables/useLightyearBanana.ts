import { computed, onUnmounted, reactive, shallowRef, watch } from 'vue'
import { buildInfo } from '../buildInfo'
import { createDefaultComfyUiSettings, normalizeComfyUiSettings } from '../data/comfyUiDefaults'
import {
  defaultModelConfigs,
  normalizeCustomModelFormat,
  providerCapabilities,
  providerRequiresApiKey,
  readProviderCapability
} from '../data/providerCapabilities'
import {
  generateImagesWithProvider,
  resolveImageRequestSize,
  testImageConfig,
  type ImageGenerationParams,
  type NormalizedImageResult
} from '../services/imageApiClient'
import {
  type AppView,
  type AppUpdateCheckResult,
  type AppUpdateCheckState,
  type CanvasOperationState,
  type ChatTurn,
  type DiagnosticExportState,
  type GeneratedImage,
  type GenerationLoadingPhase,
  type GenerationRequestSnapshot,
  type GenerationLoadingState,
  type ImageRequestLogEntry,
  type MacPermissionPane,
  type ModelConfig,
  type PlacementTarget,
  type ReferenceImage,
  type ReferenceSource,
  type ResolutionInputMode,
  type RuntimeName,
  type SettingsTestState,
  type SettingsView,
  type WindowDeployResult,
  type WindowDeploySide,
  type WindowDeployState
} from '../types/lightyear'
import { canvasPrimitiveService } from '../uxp/canvasPrimitiveService'
import type { CapturedCanvasImage } from '../uxp/canvasPrimitives'
import { getHostRequire, readActiveDocumentLabel } from '../uxp/photoshopHost'
import { createCanvasImageFromApiAsset } from '../utils/imagePixels'
import {
  bytesToBase64,
  createReferenceCanvasImage,
  pickBrowserReferenceImage,
  readBrowserClipboardReferenceImage,
  readImageMimeType
} from '../utils/referenceImages'
import {
  deserializeCanvasImage,
  exportElectronDiagnostics,
  getElectronBridgeStatus,
  hasElectronBridge,
  invokeElectronBridge,
  onElectronBridgeEvent,
  readElectronStoredSettings,
  serializeCanvasImage,
  serializePlacementTarget,
  writeElectronStoredSettings
} from '../services/electronBridge'

const referenceLabels: Record<ReferenceSource, string> = {
  visible: '可见图层',
  selection: '选区',
  layer: '选择图层',
  upload: '上传图片',
  clipboard: '剪贴板',
  generated: '生成结果'
}

type StoredSettings = {
  activeConfigId: string
  configs: ModelConfig[]
  generationHistory: ChatTurn[]
}

const settingsStorageKey = 'lightyear-banana.settings.v1'
const maxStoredTurns = 50
const maxApiRetryCount = 99
const apiRetryDelayMs = 800
const retiredBundledConfigIds = new Set([
  'nano-banana-pro',
  'gpt-image-2',
  'seedream-4',
  'qwen-image-edit',
  'kling-v3',
  'flux-2-pro-preview',
  'local-comfyui',
  'codex-image-server',
  'custom-openai'
])

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(message))
    }, ms)

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => {
        clearTimeout(timer)
      })
  })
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function readImageExtensionFromMime(mimeType: string) {
  const extension = mimeType.split('/')[1]?.split(';')[0]?.toLowerCase()
  if (extension === 'jpeg') {
    return 'jpg'
  }

  return extension && /^[a-z0-9]+$/.test(extension) ? extension : 'png'
}

function readImageExtensionFromUrl(previewUrl: string) {
  const path = previewUrl.split('?')[0]?.split('#')[0] ?? ''
  const extension = path.split('.').pop()?.toLowerCase() ?? ''

  return ['gif', 'jpg', 'jpeg', 'png', 'webp'].includes(extension) ? (extension === 'jpeg' ? 'jpg' : extension) : 'png'
}

function readGeneratedImageExtension(image: CapturedCanvasImage, mimeType?: string) {
  if (mimeType?.startsWith('image/')) {
    return readImageExtensionFromMime(mimeType)
  }

  return readImageExtensionFromUrl(image.previewUrl)
}

function sanitizeImageFileName(value: string) {
  const clean = value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim()

  return clean || 'lightyear-image'
}

function readGeneratedImageFileName(image: CapturedCanvasImage, extension?: string) {
  const imageExtension = extension ?? readImageExtensionFromUrl(image.previewUrl)
  const baseName = sanitizeImageFileName(`${image.label || '生成图'}-${image.width}x${image.height}`)

  return `${baseName}.${imageExtension}`
}

async function fetchImageBlob(previewUrl: string) {
  const response = await fetch(previewUrl)
  if (!response.ok) {
    throw new Error('图片下载失败')
  }

  return response.blob()
}

function triggerBrowserDownload(href: string, fileName: string) {
  const link = document.createElement('a')
  link.href = href
  link.download = fileName
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

async function saveBrowserGeneratedImage(image: CapturedCanvasImage) {
  try {
    const blob = await fetchImageBlob(image.previewUrl)
    const extension = readGeneratedImageExtension(image, blob.type)
    const url = URL.createObjectURL(blob)
    try {
      triggerBrowserDownload(url, readGeneratedImageFileName(image, extension))
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 30000)
    }
    return
  } catch {
    triggerBrowserDownload(image.previewUrl, readGeneratedImageFileName(image))
  }
}

async function saveUxpGeneratedImage(image: CapturedCanvasImage) {
  const hostRequire = getHostRequire()
  const uxp = hostRequire?.('uxp')
  const localFileSystem = uxp?.storage?.localFileSystem
  if (!localFileSystem?.getFileForSaving) {
    throw new Error('当前环境无法保存图片')
  }

  const blob = await fetchImageBlob(image.previewUrl)
  const extension = readGeneratedImageExtension(image, blob.type)
  const file = await localFileSystem.getFileForSaving(readGeneratedImageFileName(image, extension), {
    types: [extension]
  })
  if (!file) {
    return false
  }

  await file.write(new Uint8Array(await blob.arrayBuffer()), {
    format: uxp.storage?.formats?.binary
  })

  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object')
}

function readString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function readNumber(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function readOptionalString(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function readDefaultRatio(options: string[], fallback = ''): string {
  return options.find((option) => option === '原图比例') ?? options[0] ?? fallback
}

function normalizeModelList(models: unknown, selectedModel: string, fallbackModels: string[] = []) {
  const rawModels = Array.isArray(models) ? models.filter((item): item is string => typeof item === 'string') : []
  const normalized = uniqueStrings([...rawModels, selectedModel, ...(rawModels.length ? [] : fallbackModels)])

  return normalized.length ? normalized : ['custom-image-model']
}

function normalizeProviderId(provider: unknown): ModelConfig['provider'] | undefined {
  if (provider === 'i-mini') {
    return 'iMini'
  }

  return typeof provider === 'string' && provider in providerCapabilities ? provider as ModelConfig['provider'] : undefined
}

function readNormalizedProvider(config: ModelConfig): ModelConfig['provider'] {
  const legacyProvider = normalizeProviderId(config.provider)
  if (legacyProvider === 'iMini') {
    return legacyProvider
  }

  if (config.provider === 'custom-openai' && /apimart\.ai/i.test(config.baseUrl.trim())) {
    return 'apimart'
  }

  return legacyProvider ?? config.provider
}

function cloneModelConfig(config: ModelConfig): ModelConfig {
  const provider = readNormalizedProvider(config)
  const capability = providerCapabilities[provider]
  const selectedModel =
    provider === 'iMini' && !capability.modelOptions.includes(config.model.trim())
      ? capability.modelOptions[0] ?? config.model
      : config.model
  const models = normalizeModelList(provider === 'iMini' ? capability.modelOptions : config.models, selectedModel, capability.modelOptions)
  const model = models.includes(selectedModel.trim()) ? selectedModel.trim() : models[0] ?? selectedModel
  const customFormat = provider === 'custom-openai' ? normalizeCustomModelFormat(config.customFormat) : undefined

  return {
    ...config,
    provider,
    model,
    models,
    baseUrl: capability.supportsBaseUrl ? config.baseUrl : '',
    usesOfficialBaseUrl: false,
    customFormat,
    comfyUi: provider === 'comfyui' ? normalizeComfyUiSettings(config.comfyUi) : undefined
  }
}

function createEmptyModelConfig(): ModelConfig {
  return {
    id: '',
    name: '未配置',
    provider: 'custom-openai',
    model: 'custom-image-model',
    models: ['custom-image-model'],
    apiKey: '',
    baseUrl: '',
    usesOfficialBaseUrl: false,
    customFormat: 'openai-images',
    enabled: false,
    comfyUi: undefined
  }
}

function cloneDefaultConfigs() {
  return defaultModelConfigs.map(cloneModelConfig)
}

function readDefaultBaseUrl(provider: ModelConfig['provider'], fallback: string) {
  const capability = providerCapabilities[provider]
  if (provider === 'comfyui') {
    return 'http://127.0.0.1:8000'
  }

  if (provider === 'codex-image-server') {
    return ''
  }

  return capability.supportsBaseUrl ? capability.officialBaseUrl || fallback : ''
}

function readDefaultApiKey(provider: ModelConfig['provider'], fallback: string) {
  return providerRequiresApiKey(provider) ? fallback : ''
}

function isModelConfig(value: unknown): value is ModelConfig {
  if (!value || typeof value !== 'object') {
    return false
  }

  const config = value as Partial<ModelConfig>
  return (
    typeof config.id === 'string' &&
    typeof config.name === 'string' &&
    typeof config.provider === 'string' &&
    Boolean(normalizeProviderId(config.provider)) &&
    typeof config.model === 'string' &&
    (config.models === undefined || Array.isArray(config.models) && config.models.every((model) => typeof model === 'string')) &&
    typeof config.apiKey === 'string' &&
    typeof config.baseUrl === 'string' &&
    (config.usesOfficialBaseUrl === undefined || typeof config.usesOfficialBaseUrl === 'boolean') &&
    (config.customFormat === undefined || typeof config.customFormat === 'string') &&
    typeof config.enabled === 'boolean'
  )
}

function normalizeConfigs(value: unknown) {
  if (!Array.isArray(value)) {
    return cloneDefaultConfigs()
  }

  const storedConfigs = value.filter(isModelConfig).map(cloneModelConfig)
  if (!storedConfigs.length) {
    return cloneDefaultConfigs()
  }

  const storedById = new Map(storedConfigs.map((config) => [config.id, config]))
  const defaultIds = new Set(defaultModelConfigs.map((config) => config.id))
  const defaults = defaultModelConfigs.map((config) => cloneModelConfig({ ...config, ...storedById.get(config.id) }))
  const customConfigs = storedConfigs.filter((config) => !defaultIds.has(config.id) && !retiredBundledConfigIds.has(config.id))

  return [...defaults, ...customConfigs]
}

function cloneCanvasImageForStorage<T extends CapturedCanvasImage>(image: T): T {
  return {
    ...image,
    rgba: new Uint8Array()
  }
}

function normalizeStoredCanvasImage(value: unknown): CapturedCanvasImage | null {
  if (!isRecord(value)) {
    return null
  }

  const width = Math.max(1, Math.round(readNumber(value.width, 1024)))
  const height = Math.max(1, Math.round(readNumber(value.height, 1024)))
  const rawSourceBounds = isRecord(value.sourceBounds) ? value.sourceBounds : {}
  const sourceBounds = {
    left: readNumber(rawSourceBounds.left, 0),
    top: readNumber(rawSourceBounds.top, 0),
    right: readNumber(rawSourceBounds.right, width),
    bottom: readNumber(rawSourceBounds.bottom, height)
  }

  return {
    id: readString(value.id, createId('stored-image')),
    label: readString(value.label, '生成图'),
    width,
    height,
    sourceBounds,
    previewUrl: readString(value.previewUrl),
    rgba: new Uint8Array()
  }
}

function normalizeStoredReference(value: unknown): ReferenceImage | null {
  if (!isRecord(value)) {
    return null
  }

  const image = normalizeStoredCanvasImage(value.image)
  if (!image) {
    return null
  }

  return {
    id: readString(value.id, createId('stored-reference')),
    source: readString(value.source, 'generated') as ReferenceSource,
    label: readString(value.label, referenceLabels.generated),
    image
  }
}

function normalizeStoredGeneratedImage(value: unknown): GeneratedImage | null {
  if (!isRecord(value)) {
    return null
  }

  const image = normalizeStoredCanvasImage(value)
  if (!image) {
    return null
  }

  return {
    ...image,
    modelConfigId: readString(value.modelConfigId),
    modelName: readString(value.modelName)
  }
}

function normalizeStoredRequestLogs(value: unknown): ImageRequestLogEntry[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter(isRecord)
    .map((entry) => {
      const rawStages = isRecord(entry.stages) ? entry.stages : {}
      const rawMetadata = isRecord(entry.metadata) ? entry.metadata : {}

      return {
        id: readString(entry.id, createId('request')),
        createdAt: readString(entry.createdAt, new Date().toISOString()),
        url: readString(entry.url),
        method: readString(entry.method, 'GET'),
        status: readNumber(entry.status),
        ok: Boolean(entry.ok),
        contentLength: readString(entry.contentLength),
        metadata: { ...rawMetadata } as ImageRequestLogEntry['metadata'],
        stages: {
          headersMs: readNumber(rawStages.headersMs),
          bodyParseMs: readNumber(rawStages.bodyParseMs),
          totalMs: readNumber(rawStages.totalMs)
        }
      }
    })
}

function normalizeStoredRequestSnapshot(value: unknown): GenerationRequestSnapshot | undefined {
  if (!isRecord(value) || !isModelConfig(value.config)) {
    return undefined
  }

  const rawCanvasSize = isRecord(value.canvasSize) ? value.canvasSize : undefined

  return {
    canvasSize: rawCanvasSize
      ? {
          width: Math.max(1, Math.round(readNumber(rawCanvasSize.width, 1))),
          height: Math.max(1, Math.round(readNumber(rawCanvasSize.height, 1)))
        }
      : undefined,
    config: cloneModelConfig(value.config),
    count: Math.max(1, Math.round(readNumber(value.count, 1))),
    prompt: readString(value.prompt),
    quality: readString(value.quality),
    ratio: readString(value.ratio),
    references: Array.isArray(value.references) ? value.references.map(normalizeStoredReference).filter((item) => item !== null) : [],
    resolvedSize: readString(value.resolvedSize),
    selectedSize: readString(value.selectedSize),
    summary: readString(value.summary)
  }
}

function normalizeStoredTurns(value: unknown): ChatTurn[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((rawTurn) => {
      if (!isRecord(rawTurn)) {
        return null
      }

      return {
        id: readString(rawTurn.id, createId('turn')),
        prompt: readString(rawTurn.prompt),
        references: Array.isArray(rawTurn.references)
          ? rawTurn.references.map(normalizeStoredReference).filter((item) => item !== null)
          : [],
        responseText: readString(rawTurn.responseText),
        elapsedLabel: readString(rawTurn.elapsedLabel),
        repeatRequest: normalizeStoredRequestSnapshot(rawTurn.repeatRequest),
        requestLogs: normalizeStoredRequestLogs(rawTurn.requestLogs),
        results: Array.isArray(rawTurn.results)
          ? rawTurn.results.map(normalizeStoredGeneratedImage).filter((item) => item !== null)
          : [],
        tone: readOptionalString(rawTurn.tone) as ChatTurn['tone']
      } satisfies ChatTurn
    })
    .filter((turn) => turn !== null)
    .slice(-maxStoredTurns)
}

function cloneReferenceForStorage(reference: ReferenceImage): ReferenceImage {
  return {
    ...reference,
    image: cloneCanvasImageForStorage(reference.image)
  }
}

function cloneRequestSnapshotForStorage(snapshot: GenerationRequestSnapshot): GenerationRequestSnapshot {
  return {
    ...snapshot,
    config: cloneModelConfig(snapshot.config),
    references: snapshot.references.map(cloneReferenceForStorage)
  }
}

function cloneTurnForStorage(turn: ChatTurn): ChatTurn {
  return {
    ...turn,
    references: turn.references.map(cloneReferenceForStorage),
    repeatRequest: turn.repeatRequest ? cloneRequestSnapshotForStorage(turn.repeatRequest) : undefined,
    requestLogs: turn.requestLogs?.map((log) => ({
      ...log,
      metadata: { ...log.metadata },
      stages: { ...log.stages }
    })),
    results: turn.results.map(cloneCanvasImageForStorage)
  }
}

function cloneTurnsForStorage(turns: ChatTurn[]) {
  return turns.slice(-maxStoredTurns).map(cloneTurnForStorage)
}

function readStoredSettings(): StoredSettings {
  const fallbackConfigs = cloneDefaultConfigs()
  const fallback: StoredSettings = {
    activeConfigId: fallbackConfigs[0]?.id ?? '',
    configs: fallbackConfigs,
    generationHistory: []
  }

  try {
    const electronStoredSettings = readElectronStoredSettings()
    if (electronStoredSettings) {
      const parsed = electronStoredSettings as Partial<StoredSettings>
      const configs = normalizeConfigs(parsed.configs)
      const activeConfigId =
        typeof parsed.activeConfigId === 'string' && configs.some((config) => config.id === parsed.activeConfigId)
          ? parsed.activeConfigId
          : configs[0]?.id ?? ''

      return {
        activeConfigId,
        configs,
        generationHistory: normalizeStoredTurns(parsed.generationHistory)
      }
    }

    const raw = localStorage.getItem(settingsStorageKey)
    if (!raw) {
      return fallback
    }

    const parsed = JSON.parse(raw) as Partial<StoredSettings>
    const configs = normalizeConfigs(parsed.configs)
    const activeConfigId =
      typeof parsed.activeConfigId === 'string' && configs.some((config) => config.id === parsed.activeConfigId)
        ? parsed.activeConfigId
        : configs[0]?.id ?? ''

    return {
      activeConfigId,
      configs,
      generationHistory: normalizeStoredTurns(parsed.generationHistory)
    }
  } catch {
    return fallback
  }
}

function writeStoredSettings(settings: StoredSettings) {
  try {
    localStorage.setItem(settingsStorageKey, JSON.stringify(settings))
  } catch {
  }

  void writeElectronStoredSettings(settings)
}

export function useLightyearBanana(runtime: RuntimeName) {
  const storedSettings = readStoredSettings()
  const isElectronRuntime = runtime === 'electron'
  const initialConfig =
    storedSettings.configs.find((config) => config.id === storedSettings.activeConfigId) ??
    storedSettings.configs[0] ??
    createEmptyModelConfig()
  const initialCapability = readProviderCapability(initialConfig)
  const activeView = shallowRef<AppView>('workspace')
  const settingsView = shallowRef<SettingsView>('list')
  const settingsDraftIsNew = shallowRef(false)
  const status = shallowRef(runtime === 'photoshop-uxp' ? 'Photoshop UXP' : isElectronRuntime ? 'Lightyear App' : '浏览器预览')
  const connectionStatus = shallowRef(runtime === 'photoshop-uxp' ? 'Photoshop UXP' : isElectronRuntime ? 'Photoshop 未连接' : '浏览器预览')
  const documentLabel = shallowRef(readActiveDocumentLabel())
  const busy = shallowRef(false)
  const prompt = shallowRef('')
  const references = shallowRef<ReferenceImage[]>([])
  const turns = shallowRef<ChatTurn[]>(storedSettings.generationHistory)
  const configs = shallowRef<ModelConfig[]>(storedSettings.configs)
  const activeConfigId = shallowRef(storedSettings.activeConfigId)
  const size = shallowRef(readDefaultSize(initialCapability.sizeOptions))
  const resolutionMode = shallowRef<ResolutionInputMode>('preset')
  const customWidth = shallowRef(2048)
  const customHeight = shallowRef(2048)
  const quality = shallowRef(readDefaultQuality(initialCapability.qualityOptions))
  const count = shallowRef(initialCapability.countOptions.includes(1) ? 1 : initialCapability.countOptions[0] ?? 1)
  const ratio = shallowRef(readDefaultRatio(initialCapability.ratioOptions))
  const installPluginUrl = shallowRef('')
  const editingConfigId = shallowRef(activeConfigId.value)
  const settingsTestState = shallowRef<SettingsTestState>({ status: 'idle', message: '' })
  const windowDeployState = shallowRef<WindowDeployState>({ status: 'idle', message: '' })
  const appUpdateState = shallowRef<AppUpdateCheckState>({
    status: 'idle',
    message: `当前版本 v${buildInfo.version}`,
    currentVersion: buildInfo.version
  })
  const diagnosticExportState = shallowRef<DiagnosticExportState>({
    status: 'idle',
    message: '最近 24 小时'
  })
  const toastMessage = shallowRef('')
  const generationLoading = shallowRef<GenerationLoadingState[]>([])
  const canvasOperation = shallowRef<CanvasOperationState>({ type: 'idle', label: '' })
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  let bridgeStatusTimer: ReturnType<typeof setInterval> | undefined
  let removeBridgeListener: (() => void) | undefined
  let generationTimer: ReturnType<typeof setInterval> | undefined
  let settingsTestResetTimer: ReturnType<typeof setTimeout> | undefined
  const generationControllers = new Map<string, AbortController>()
  const generationStartedAt = new Map<string, number>()

  const settingsDraft = reactive<ModelConfig>({
    ...cloneModelConfig(initialConfig)
  })

  const canUsePhotoshop = computed(() => runtime === 'photoshop-uxp' && Boolean(getHostRequire()))
  const canUseElectronBridge = computed(() => isElectronRuntime && hasElectronBridge())
  const activeConfig = computed(
    () => configs.value.find((config) => config.id === activeConfigId.value) ?? configs.value[0] ?? createEmptyModelConfig()
  )
  const activeCapability = computed(() => readProviderCapability(activeConfig.value))
  const editingCapability = computed(() => readProviderCapability(settingsDraft))
  const enabledConfigs = computed(() => configs.value.filter((config) => config.enabled))
  const referenceLimit = computed(() => activeCapability.value.referenceLimit)
  const canAddReference = computed(() => references.value.length < referenceLimit.value)
  const canSend = computed(() => configs.value.length > 0 && (Boolean(prompt.value.trim()) || references.value.length > 0))

  function writeCurrentStoredSettings() {
    writeStoredSettings({
      activeConfigId: activeConfigId.value,
      configs: configs.value.map(cloneModelConfig),
      generationHistory: cloneTurnsForStorage(turns.value)
    })
  }

  watch([configs, activeConfigId, turns], writeCurrentStoredSettings, { deep: true })

  watch(activeCapability, (capability) => {
    size.value = capability.sizeOptions.includes(size.value) ? size.value : readDefaultSize(capability.sizeOptions)
    quality.value = capability.qualityOptions.includes(quality.value) ? quality.value : readDefaultQuality(capability.qualityOptions)
    count.value = readRequestCountForCapability(count.value, capability)
    ratio.value = capability.ratioOptions.includes(ratio.value) ? ratio.value : readDefaultRatio(capability.ratioOptions, ratio.value)
  })

  function readCapabilityForConfig(configId: string) {
    const config = configs.value.find((item) => item.id === configId) ?? activeConfig.value

    return readProviderCapability(config)
  }

  function selectModel(model: string) {
    const cleanModel = model.trim()
    if (!cleanModel) {
      return
    }

    const source = activeConfig.value
    const nextModels = normalizeModelList(source.models, cleanModel)
    configs.value = configs.value.map((config) =>
      config.id === source.id ? cloneModelConfig({ ...config, model: cleanModel, models: nextModels }) : config
    )
    status.value = `已选择 ${cleanModel}`
  }

  function readDefaultSize(options: string[]): string {
    return (
      options.find((option) => option === '1k') ??
      options.find((option) => option === 'auto') ??
      options.find((option) => option === '1024x1024') ??
      options.find((option) => option === '1024*1024') ??
      options.find((option) => option === '1K') ??
      options.find((option) => option === '默认') ??
      options[0] ??
      ''
    )
  }

  function readUpscaleSize(options: string[]): string {
    return (
      options.find((option) => option === '4K') ??
      options.find((option) => option === '4k') ??
      options.find((option) => option === '2048x2048') ??
      options.find((option) => option === '2048*2048') ??
      options.find((option) => option === '1920x1088') ??
      options.find((option) => option === '1088x1920') ??
      options.find((option) => option !== 'auto') ??
      ''
    )
  }

function readDefaultQuality(options: string[]): string {
  return options.find((option) => option === 'auto') ?? options[0] ?? ''
}

function readHighestQuality(options: string[]): string {
  return (
    options.find((option) => option === 'high') ??
    options.find((option) => option === 'hd') ??
    options.at(-1) ??
    ''
  )
  }

  function showToast(message: string) {
    toastMessage.value = message
    if (toastTimer) {
      clearTimeout(toastTimer)
    }
    toastTimer = setTimeout(() => {
      toastMessage.value = ''
      toastTimer = undefined
    }, 1800)
  }

  function clearSettingsTestResetTimer() {
    if (settingsTestResetTimer) {
      clearTimeout(settingsTestResetTimer)
      settingsTestResetTimer = undefined
    }
  }

  function setSettingsTestState(nextState: SettingsTestState, options: { resetAfterMs?: number } = {}) {
    clearSettingsTestResetTimer()
    settingsTestState.value = nextState

    if (!options.resetAfterMs) {
      return
    }

    settingsTestResetTimer = setTimeout(() => {
      settingsTestState.value = { status: 'idle', message: '' }
      settingsTestResetTimer = undefined
    }, options.resetAfterMs)
  }

  function updateGenerationElapsed() {
    generationLoading.value = generationLoading.value.map((task) => {
      const elapsedSeconds = Math.floor((Date.now() - (generationStartedAt.get(task.id) ?? Date.now())) / 1000)
      const phase = task.phase === 'waiting-connection' && elapsedSeconds >= 2 ? 'waiting-generation' : task.phase

      return {
        ...task,
        elapsedSeconds,
        phase
      }
    })
  }

  function clearGenerationTimerIfIdle() {
    if (generationLoading.value.length || !generationTimer) {
      return
    }

    clearInterval(generationTimer)
    generationTimer = undefined
  }

  function ensureGenerationTimer() {
    if (generationTimer) {
      return
    }

    generationTimer = setInterval(updateGenerationElapsed, 250)
  }

  function clearAllGenerationLoading() {
    if (generationTimer) {
      clearInterval(generationTimer)
      generationTimer = undefined
    }

    generationControllers.forEach((controller) => controller.abort())
    generationControllers.clear()
    generationStartedAt.clear()
    generationLoading.value = []
  }

  function startGenerationLoading(cleanPrompt: string, sentReferences: ReferenceImage[]) {
    const id = createId('generation')
    const startedAt = Date.now()
    generationStartedAt.set(id, startedAt)
    generationLoading.value = [
      ...generationLoading.value,
      {
        id,
        references: sentReferences,
        prompt: cleanPrompt,
        elapsedSeconds: 0,
        phase: 'waiting-connection',
        requestLogs: []
      }
    ]
    ensureGenerationTimer()
    return id
  }

  function updateGenerationPhase(taskId: string, phase: GenerationLoadingPhase) {
    generationLoading.value = generationLoading.value.map((task) => (task.id === taskId ? { ...task, phase } : task))
  }

  function readPhaseAfterRequestLog(entry: ImageRequestLogEntry): GenerationLoadingPhase {
    const phase = String(entry.metadata.phase ?? '')
    if (phase === 'submit' || phase === 'poll') {
      return 'waiting-generation'
    }

    return 'downloading'
  }

  function appendGenerationRequestLog(taskId: string, entry: ImageRequestLogEntry) {
    generationLoading.value = generationLoading.value.map((task) => {
      if (task.id !== taskId) {
        return task
      }

      return {
        ...task,
        phase: readPhaseAfterRequestLog(entry),
        requestLogs: [
          ...(task.requestLogs ?? []),
          {
            ...entry,
            metadata: { ...entry.metadata },
            stages: { ...entry.stages }
          }
        ]
      }
    })
  }

  function recordGenerationRequestLog(taskId: string, requestLogs: ImageRequestLogEntry[], entry: ImageRequestLogEntry) {
    requestLogs.push(entry)
    appendGenerationRequestLog(taskId, entry)
  }

  function stopGenerationLoading(id: string) {
    generationControllers.delete(id)
    generationStartedAt.delete(id)
    generationLoading.value = generationLoading.value.filter((task) => task.id !== id)
    clearGenerationTimerIfIdle()
  }

  function readGenerationElapsed(taskId: string, fallbackStartedAt: number) {
    return Math.max(1, Math.round((Date.now() - (generationStartedAt.get(taskId) ?? fallbackStartedAt)) / 1000))
  }

  function cancelGeneration(taskId: string) {
    const controller = generationControllers.get(taskId)
    if (!controller || controller.signal.aborted) {
      return
    }

    controller.abort()
    status.value = '已取消生成'
    showToast('已取消生成')
  }

  function resetSettingsDraft(configId = editingConfigId.value) {
    const source = configs.value.find((config) => config.id === configId) ?? activeConfig.value
    editingConfigId.value = source.id
    Object.assign(settingsDraft, cloneModelConfig(source))
  }

  function refreshDocument() {
    if (isElectronRuntime) {
      connectionStatus.value = hasElectronBridge() ? 'Photoshop 未连接' : 'Photoshop 未连接'
      return
    }

    documentLabel.value = readActiveDocumentLabel()
    connectionStatus.value = canUsePhotoshop.value ? 'Photoshop 已连接' : runtime === 'browser' ? '浏览器预览' : 'Photoshop 未连接'
  }

  async function refreshElectronDocument() {
    if (!canUseElectronBridge.value) {
      connectionStatus.value = 'Photoshop 未连接'
      return
    }

    try {
      const bridgeStatus = await getElectronBridgeStatus()
      installPluginUrl.value = bridgeStatus.uxpPackage?.downloadUrl ?? ''
      documentLabel.value = bridgeStatus.photoshop.connected ? bridgeStatus.photoshop.documentLabel ?? 'Photoshop 已连接' : 'Photoshop 未连接'
      connectionStatus.value = bridgeStatus.photoshop.connected ? 'Photoshop 已连接' : 'Photoshop 未连接'
    } catch (error) {
      connectionStatus.value = 'Photoshop 未连接'
    }
  }

  async function runCanvasAction(operation: CanvasOperationState, action: () => Promise<void>) {
    busy.value = true
    canvasOperation.value = operation
    const startedAt = performance.now()
    try {
      await action()
      if (isElectronRuntime) {
        await refreshElectronDocument()
      } else {
        refreshDocument()
      }
    } catch (error) {
      status.value = readErrorMessage(error, '操作失败').replace(/^Error invoking remote method '[^']+': Error: /, '')
    } finally {
      console.debug(`[Lightyear Banana] ${operation.label || operation.type} ${Math.round(performance.now() - startedAt)}ms`)
      canvasOperation.value = { type: 'idle', label: '' }
      busy.value = false
    }
  }

  function addReferenceImage(source: ReferenceSource, image: CapturedCanvasImage) {
    if (!canAddReference.value) {
      status.value = `当前模型最多 ${referenceLimit.value} 张参考图`
      return
    }

    const isFirstReference = references.value.length === 0
    references.value = [
      ...references.value,
      {
        id: createId('reference'),
        source,
        label: referenceLabels[source],
        image
      }
    ]
    if (isFirstReference) {
      ratio.value = readDefaultRatio(activeCapability.value.ratioOptions, ratio.value)
    }
    status.value = `已添加${referenceLabels[source]}`
  }

  async function addReference(source: ReferenceSource) {
    await runCanvasAction({ type: 'capture', label: `正在读取${referenceLabels[source]}` }, async () => {
      if (source === 'upload') {
        const image = await pickUploadReferenceImage()
        if (image) {
          addReferenceImage(source, image)
        } else {
          status.value = '未选择图片'
        }
        return
      }

      if (source === 'clipboard') {
        addReferenceImage(source, await readClipboardReferenceImage())
        return
      }

      if (!canUseElectronBridge.value && !canUsePhotoshop.value) {
        status.value = '请在 Lightyear App 或 Photoshop 面板中添加参考'
        return
      }

      if (source === 'visible') {
        const image = canUseElectronBridge.value
          ? deserializeCanvasImage(await invokeElectronBridge('canvas.captureVisible'))
          : await canvasPrimitiveService.captureVisibleReferenceImage()
        addReferenceImage(source, image)
        return
      }

      if (source === 'selection') {
        const image = canUseElectronBridge.value
          ? deserializeCanvasImage(await invokeElectronBridge('canvas.captureSelection'))
          : await canvasPrimitiveService.captureSelectionReferenceImage()
        addReferenceImage(source, image)
        return
      }

      if (source === 'layer') {
        const image = canUseElectronBridge.value
          ? deserializeCanvasImage(await invokeElectronBridge('canvas.captureLayer'))
          : await canvasPrimitiveService.captureSelectedLayerReferenceImage()
        addReferenceImage(source, image)
        return
      }

      status.value = `${referenceLabels[source]}暂不可用`
    })
  }

  async function pickUploadReferenceImage() {
    if (canUseElectronBridge.value) {
      const image = await invokeElectronBridge<ReturnType<typeof serializeCanvasImage> | null>('reference.pickUpload')

      return image ? deserializeCanvasImage(image) : null
    }

    if (canUsePhotoshop.value) {
      return pickUxpUploadReferenceImage()
    }

    return pickBrowserReferenceImage()
  }

  async function readClipboardReferenceImage() {
    if (canUseElectronBridge.value) {
      return deserializeCanvasImage(await invokeElectronBridge('reference.readClipboard'))
    }

    return readBrowserClipboardReferenceImage()
  }

  async function pickUxpUploadReferenceImage() {
    const hostRequire = getHostRequire()
    const uxp = hostRequire?.('uxp')
    const localFileSystem = uxp?.storage?.localFileSystem
    if (!localFileSystem?.getFileForOpening) {
      throw new Error('当前环境无法上传图片')
    }

    const file = await localFileSystem.getFileForOpening({
      types: ['png', 'jpg', 'jpeg', 'webp']
    })
    if (!file) {
      return null
    }

    const raw = await file.read({
      format: uxp.storage?.formats?.binary
    })
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw)
    const fileName = String(file.name || '参考图')

    return createReferenceCanvasImage({
      idPrefix: 'upload',
      label: `上传图片：${fileName}`,
      previewUrl: `data:${readImageMimeType(fileName)};base64,${bytesToBase64(bytes)}`
    })
  }

  function removeReference(id: string) {
    references.value = references.value.filter((reference) => reference.id !== id)
  }

  function clearReferences() {
    references.value = []
  }

  function clearConversationData() {
    clearAllGenerationLoading()
    turns.value = []
    references.value = []
    status.value = '对话已清空'
    showToast('对话已清空')
  }

  function selectConfig(configId: string) {
    activeConfigId.value = configId
    const capability = activeCapability.value
    size.value = readDefaultSize(capability.sizeOptions)
    quality.value = capability.qualityOptions.includes(quality.value) ? quality.value : readDefaultQuality(capability.qualityOptions)
    count.value = capability.countOptions.includes(count.value) ? count.value : capability.countOptions[0] ?? 1
    ratio.value = readDefaultRatio(capability.ratioOptions, ratio.value)
  }

  async function buildGeneratedImagesFromApi(
    apiImages: NormalizedImageResult[],
    modelConfigId: string,
    modelName: string
  ) {
    const images = await Promise.all(
      apiImages.map((apiImage, index) =>
        createCanvasImageFromApiAsset({
          id: createId(`generated-${index + 1}`),
          label: apiImage.label,
          modelConfigId,
          modelName,
          previewUrl: apiImage.previewUrl
        })
      )
    )

    return {
      images,
      resolvedSize: apiImages.find((image) => image.resolvedSize)?.resolvedSize
    }
  }

  function waitForApiRetry(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('请求已取消'))
        return
      }

      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', handleAbort)
        resolve()
      }, ms)

      function handleAbort() {
        clearTimeout(timer)
        reject(new Error('请求已取消'))
      }

      signal?.addEventListener('abort', handleAbort, { once: true })
    })
  }

  async function buildGeneratedImagesWithRetries(params: ImageGenerationParams, modelConfigId: string) {
    let lastError: unknown
    const retryLimit = maxApiRetryCount

    for (let retryIndex = 0; retryIndex <= retryLimit; retryIndex += 1) {
      const attempt = retryIndex + 1

      try {
        if (params.loadingTaskId) {
          updateGenerationPhase(params.loadingTaskId, 'waiting-connection')
        }

        const apiImages = await generateImagesWithProvider({
          ...params,
          onTiming: (entry) => {
            params.onTiming?.({
              ...entry,
              metadata: {
                ...entry.metadata,
                maxRequestRetries: retryLimit,
                requestAttempt: attempt
              }
            })
          }
        })

        return buildGeneratedImagesFromApi(apiImages, modelConfigId, params.config.model)
      } catch (error) {
        lastError = error
        if (params.signal?.aborted || retryIndex >= retryLimit) {
          throw error
        }

        if (params.loadingTaskId) {
          updateGenerationPhase(params.loadingTaskId, 'waiting-retry')
        }

        await waitForApiRetry(apiRetryDelayMs * attempt, params.signal)
      }
    }

    throw lastError
  }

  function readCustomResolutionSize() {
    return `${customWidth.value}x${customHeight.value}`
  }

  function readResolutionDimensions(value: string) {
    const match = /^(\d{2,5})[x*](\d{2,5})$/i.exec(value.trim())
    if (!match) {
      return undefined
    }

    const width = Math.round(Number(match[1]))
    const height = Math.round(Number(match[2]))
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return undefined
    }

    return { width, height }
  }

  function validateCustomResolution() {
    const width = Math.round(Number(customWidth.value))
    const height = Math.round(Number(customHeight.value))
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return '请输入宽高'
    }

    const imageRatio = width / height
    if (imageRatio < 1 / 16 || imageRatio > 16) {
      return '宽高比需在 1:16 到 16:1 之间'
    }

    const pixels = width * height
    if (pixels < 1024 * 1024 || pixels > 4096 * 4096) {
      return '像素总量需在 1024² 到 4096² 之间'
    }

    customWidth.value = width
    customHeight.value = height
    return ''
  }

  async function readCanvasSizeForRequest(requestRatio: string) {
    if (requestRatio !== '画布比例') {
      return undefined
    }

    if (canUseElectronBridge.value) {
      return invokeElectronBridge<{ width: number; height: number }>('canvas.readSize')
    }

    if (canUsePhotoshop.value) {
      return canvasPrimitiveService.readCanvasSize()
    }

    return undefined
  }

  function readGenerationSummary(snapshot: Pick<GenerationRequestSnapshot, 'quality' | 'resolvedSize' | 'selectedSize'>) {
    const sizeLabel =
      snapshot.selectedSize && snapshot.selectedSize !== snapshot.resolvedSize
        ? `${snapshot.selectedSize} · ${snapshot.resolvedSize}`
        : snapshot.resolvedSize || snapshot.selectedSize

    return snapshot.quality ? `${sizeLabel} · ${snapshot.quality}` : sizeLabel
  }

  function buildGenerationResponseText(snapshot: GenerationRequestSnapshot, generatedCount: number) {
    return `已生成 ${generatedCount} 张 · ${snapshot.config.model} · ${snapshot.summary}`
  }

  function cloneGenerationRequestSnapshot(snapshot: GenerationRequestSnapshot): GenerationRequestSnapshot {
    return {
      ...snapshot,
      config: cloneModelConfig(snapshot.config),
      references: snapshot.references.map((reference) => ({ ...reference }))
    }
  }

  function readRequestSizeForSnapshot(snapshot: GenerationRequestSnapshot) {
    return resolveImageRequestSize({
      canvasSize: snapshot.canvasSize,
      config: snapshot.config,
      ratio: snapshot.ratio,
      references: snapshot.references,
      size: snapshot.resolvedSize || snapshot.selectedSize
    })
  }

  function normalizeGenerationSnapshotForRequest(snapshot: GenerationRequestSnapshot): GenerationRequestSnapshot {
    const resolvedSize = readRequestSizeForSnapshot(snapshot)
    if (!resolvedSize || resolvedSize === snapshot.resolvedSize) {
      return snapshot
    }

    return {
      ...snapshot,
      resolvedSize,
      summary: readGenerationSummary({
        quality: snapshot.quality,
        resolvedSize,
        selectedSize: snapshot.selectedSize
      })
    }
  }

  function readRequestCountForCapability(requestedCount: number, capability = activeCapability.value) {
    if (capability.countOptions.includes(requestedCount)) {
      return requestedCount
    }

    return capability.countOptions.includes(1) ? 1 : capability.countOptions[0] ?? 1
  }

  function readRequestCountForSnapshot(snapshot: GenerationRequestSnapshot) {
    return readRequestCountForCapability(snapshot.count, readProviderCapability(snapshot.config))
  }

  function finalizeGenerationSnapshot(snapshot: GenerationRequestSnapshot, resolvedSize?: string): GenerationRequestSnapshot {
    if (!resolvedSize || resolvedSize === snapshot.resolvedSize) {
      return snapshot
    }

    return {
      ...snapshot,
      resolvedSize,
      summary: readGenerationSummary({
        quality: snapshot.quality,
        resolvedSize,
        selectedSize: snapshot.selectedSize
      })
    }
  }

  function cloneRequestLogs(logs: ImageRequestLogEntry[]) {
    return logs.map((log) => ({
      ...log,
      metadata: { ...log.metadata },
      stages: { ...log.stages }
    }))
  }

  function buildFailedGenerationTurn(
    snapshot: GenerationRequestSnapshot,
    message: string,
    elapsedSeconds: number,
    requestLogs: ImageRequestLogEntry[] = []
  ): ChatTurn {
    return {
      id: createId('turn'),
      prompt: snapshot.prompt,
      references: snapshot.references,
      responseText: message,
      elapsedLabel: `失败 · ${elapsedSeconds}s`,
      repeatRequest: cloneGenerationRequestSnapshot(snapshot),
      requestLogs: cloneRequestLogs(requestLogs),
      results: [],
      tone: 'error'
    }
  }

  async function sendPrompt() {
    const cleanPrompt = prompt.value.trim()
    const hasReferences = references.value.length > 0
    if (!cleanPrompt && !hasReferences) {
      status.value = '请输入提示词或添加参考图'
      return
    }
    if (!configs.value.length) {
      status.value = '请先添加 API 配置'
      showToast('请先添加 API 配置')
      return
    }

    const requestPrompt = cleanPrompt || '根据参考图生成'
    const sentReferences = references.value.map((reference) => ({ ...reference }))
    const requestConfig = cloneModelConfig(activeConfig.value)
    const requestCapability = readProviderCapability(requestConfig)
    const requestCount = readRequestCountForCapability(count.value, requestCapability)
    const requestQuality = requestCapability.qualityOptions.includes(quality.value) ? quality.value : readDefaultQuality(requestCapability.qualityOptions)
    const requestRatio = resolutionMode.value === 'custom' ? '自定义' : ratio.value
    let requestSize = resolutionMode.value === 'custom' ? readCustomResolutionSize() : size.value
    let requestCanvasSize: { width: number; height: number } | undefined

    if (providerRequiresApiKey(requestConfig.provider) && !requestConfig.apiKey.trim()) {
      status.value = '请输入 API Key'
      showToast('请输入 API Key')
      return
    }

    if (requestCapability.supportsBaseUrl && !requestConfig.baseUrl.trim()) {
      status.value = '请输入 Base URL'
      showToast('请输入 Base URL')
      return
    }

    if (resolutionMode.value === 'custom') {
      const message = validateCustomResolution()
      if (message) {
        status.value = message
        showToast(message)
        return
      }
    }

    requestSize = resolutionMode.value === 'custom' ? readCustomResolutionSize() : size.value

    try {
      requestCanvasSize = await readCanvasSizeForRequest(requestRatio)
    } catch (error) {
      const message = readErrorMessage(error, '无法读取画布比例')
      status.value = message
      showToast(message)
      return
    }

    const requestResolvedSize = resolveImageRequestSize({
      canvasSize: requestCanvasSize,
      config: requestConfig,
      ratio: requestRatio,
      references: sentReferences,
      size: requestSize
    })
    const requestSnapshot: GenerationRequestSnapshot = {
      canvasSize: requestCanvasSize,
      config: requestConfig,
      count: requestCount,
      prompt: requestPrompt,
      quality: requestQuality,
      ratio: requestRatio,
      references: sentReferences,
      resolvedSize: requestResolvedSize,
      selectedSize: requestSize,
      summary: readGenerationSummary({
        quality: requestQuality,
        resolvedSize: requestResolvedSize,
        selectedSize: requestSize
      })
    }

    prompt.value = ''
    references.value = []
    const startedAt = Date.now()
    const taskId = startGenerationLoading(requestPrompt, sentReferences)
    const abortController = new AbortController()
    const requestLogs: ImageRequestLogEntry[] = []
    generationControllers.set(taskId, abortController)
    status.value = '正在生成'

    void (async () => {
      try {
        const generated = await buildGeneratedImagesWithRetries(
          {
            config: requestConfig,
            count: requestCount,
            canvasSize: requestCanvasSize,
            prompt: requestPrompt,
            quality: requestQuality,
            loadingTaskId: taskId,
            ratio: requestRatio,
            references: sentReferences,
            selectedSize: requestSize,
            onTiming: (entry) => recordGenerationRequestLog(taskId, requestLogs, entry),
            signal: abortController.signal,
            size: requestResolvedSize
          },
          requestConfig.id
        )
        const finalSnapshot = finalizeGenerationSnapshot(requestSnapshot, generated.resolvedSize)
        const turn: ChatTurn = {
          id: createId('turn'),
          prompt: requestPrompt,
          references: sentReferences,
          responseText: buildGenerationResponseText(finalSnapshot, generated.images.length),
          elapsedLabel: `耗费 ${readGenerationElapsed(taskId, startedAt)}s`,
          repeatRequest: cloneGenerationRequestSnapshot(finalSnapshot),
          requestLogs: cloneRequestLogs(requestLogs),
          results: generated.images
        }

        turns.value = [...turns.value, turn]
        status.value = '生成完成'
      } catch (error) {
        if (abortController.signal.aborted) {
          const canceledTurn: ChatTurn = {
            id: createId('turn'),
            prompt: requestPrompt,
            references: sentReferences,
            responseText: '已取消生成',
            elapsedLabel: `${readGenerationElapsed(taskId, startedAt)}s`,
            requestLogs: cloneRequestLogs(requestLogs),
            results: [],
            tone: 'canceled'
          }

          turns.value = [...turns.value, canceledTurn]
          return
        }

        const message = `API 请求失败：${readErrorMessage(error, '请检查配置后重试')}`
        const failedTurn = buildFailedGenerationTurn(requestSnapshot, message, readGenerationElapsed(taskId, startedAt), requestLogs)

        turns.value = [...turns.value, failedTurn]
        status.value = message
        showToast(message)
      } finally {
        stopGenerationLoading(taskId)
      }
    })()
  }

  async function appendGeneration(turnId: string) {
    const sourceTurn = turns.value.find((turn) => turn.id === turnId)
    if (!sourceTurn?.repeatRequest) {
      status.value = '没有可追加的生成请求'
      return
    }

    const requestSnapshot = normalizeGenerationSnapshotForRequest(cloneGenerationRequestSnapshot(sourceTurn.repeatRequest))
    const startedAt = Date.now()
    const taskId = startGenerationLoading(requestSnapshot.prompt, requestSnapshot.references)
    const abortController = new AbortController()
    const requestLogs: ImageRequestLogEntry[] = []
    generationControllers.set(taskId, abortController)
    status.value = '正在追加生成'

    void (async () => {
      try {
        const generated = await buildGeneratedImagesWithRetries(
          {
            config: requestSnapshot.config,
            count: readRequestCountForSnapshot(requestSnapshot),
            canvasSize: requestSnapshot.canvasSize,
            prompt: requestSnapshot.prompt,
            quality: requestSnapshot.quality,
            loadingTaskId: taskId,
            ratio: requestSnapshot.ratio,
            references: requestSnapshot.references,
            selectedSize: requestSnapshot.selectedSize,
            onTiming: (entry) => recordGenerationRequestLog(taskId, requestLogs, entry),
            signal: abortController.signal,
            size: readRequestSizeForSnapshot(requestSnapshot)
          },
          requestSnapshot.config.id
        )
        const finalSnapshot = finalizeGenerationSnapshot(requestSnapshot, generated.resolvedSize)

        turns.value = turns.value.map((turn) => {
          if (turn.id !== turnId) {
            return turn
          }

          const mergedResults = [...turn.results, ...generated.images]
          return {
            ...turn,
            elapsedLabel: `耗费 ${readGenerationElapsed(taskId, startedAt)}s`,
            repeatRequest: cloneGenerationRequestSnapshot(finalSnapshot),
            requestLogs: [...(turn.requestLogs ?? []), ...cloneRequestLogs(requestLogs)],
            responseText: buildGenerationResponseText(finalSnapshot, mergedResults.length),
            results: mergedResults
          }
        })
        status.value = '追加生成完成'
      } catch (error) {
        if (abortController.signal.aborted) {
          const canceledTurn: ChatTurn = {
            id: createId('turn'),
            prompt: requestSnapshot.prompt,
            references: requestSnapshot.references,
            responseText: '已取消生成',
            elapsedLabel: `${readGenerationElapsed(taskId, startedAt)}s`,
            requestLogs: cloneRequestLogs(requestLogs),
            results: [],
            tone: 'canceled'
          }

          turns.value = [...turns.value, canceledTurn]
          return
        }

        const message = `API 请求失败：${readErrorMessage(error, '请检查配置后重试')}`
        turns.value = [...turns.value, buildFailedGenerationTurn(requestSnapshot, message, readGenerationElapsed(taskId, startedAt), requestLogs)]
        status.value = message
        showToast(message)
      } finally {
        stopGenerationLoading(taskId)
      }
    })()
  }

  async function retryGeneration(turnId: string) {
    const sourceTurn = turns.value.find((turn) => turn.id === turnId)
    if (!sourceTurn?.repeatRequest) {
      status.value = '没有可重试的生成请求'
      return
    }

    const requestSnapshot = normalizeGenerationSnapshotForRequest(cloneGenerationRequestSnapshot(sourceTurn.repeatRequest))
    const startedAt = Date.now()
    const taskId = startGenerationLoading(requestSnapshot.prompt, requestSnapshot.references)
    const abortController = new AbortController()
    const requestLogs: ImageRequestLogEntry[] = []
    generationControllers.set(taskId, abortController)
    status.value = '正在重试生成'

    void (async () => {
      try {
        const generated = await buildGeneratedImagesWithRetries(
          {
            config: requestSnapshot.config,
            count: readRequestCountForSnapshot(requestSnapshot),
            canvasSize: requestSnapshot.canvasSize,
            prompt: requestSnapshot.prompt,
            quality: requestSnapshot.quality,
            loadingTaskId: taskId,
            ratio: requestSnapshot.ratio,
            references: requestSnapshot.references,
            selectedSize: requestSnapshot.selectedSize,
            onTiming: (entry) => recordGenerationRequestLog(taskId, requestLogs, entry),
            signal: abortController.signal,
            size: readRequestSizeForSnapshot(requestSnapshot)
          },
          requestSnapshot.config.id
        )
        const finalSnapshot = finalizeGenerationSnapshot(requestSnapshot, generated.resolvedSize)

        turns.value = turns.value.map((turn) => {
          if (turn.id !== turnId) {
            return turn
          }

          return {
            ...turn,
            elapsedLabel: `耗费 ${readGenerationElapsed(taskId, startedAt)}s`,
            responseText: buildGenerationResponseText(finalSnapshot, generated.images.length),
            repeatRequest: cloneGenerationRequestSnapshot(finalSnapshot),
            requestLogs: cloneRequestLogs(requestLogs),
            results: generated.images,
            tone: 'normal'
          }
        })
        status.value = '重试生成完成'
      } catch (error) {
        if (abortController.signal.aborted) {
          turns.value = turns.value.map((turn) => {
            if (turn.id !== turnId) {
              return turn
            }

            return {
              ...turn,
              responseText: '已取消生成',
              elapsedLabel: `${readGenerationElapsed(taskId, startedAt)}s`,
              repeatRequest: cloneGenerationRequestSnapshot(requestSnapshot),
              requestLogs: cloneRequestLogs(requestLogs),
              results: [],
              tone: 'canceled'
            }
          })
          return
        }

        const message = `API 请求失败：${readErrorMessage(error, '请检查配置后重试')}`
        turns.value = turns.value.map((turn) => {
          if (turn.id !== turnId) {
            return turn
          }

          return {
            ...buildFailedGenerationTurn(requestSnapshot, message, readGenerationElapsed(taskId, startedAt), requestLogs),
            id: turn.id
          }
        })
        status.value = message
        showToast(message)
      } finally {
        stopGenerationLoading(taskId)
      }
    })()
  }

  function selectRequestConfig(config: ModelConfig) {
    const existing = configs.value.find((item) => item.id === config.id)
    if (existing) {
      const models = normalizeModelList(existing.models, config.model)
      configs.value = configs.value.map((item) =>
        item.id === existing.id ? cloneModelConfig({ ...item, model: config.model, models }) : item
      )
      activeConfigId.value = existing.id
      return existing.id
    }

    const restored = cloneModelConfig({
      ...config,
      id: createId('config'),
      name: readCopiedConfigName(config.name || config.model || '配置'),
      enabled: true
    })
    configs.value = [...configs.value, restored]
    activeConfigId.value = restored.id

    return restored.id
  }

  function editGenerationRequest(turnId: string) {
    const sourceTurn = turns.value.find((turn) => turn.id === turnId)
    if (!sourceTurn?.repeatRequest) {
      status.value = '没有可修改的生成请求'
      return
    }

    const snapshot = cloneGenerationRequestSnapshot(sourceTurn.repeatRequest)
    const configId = selectRequestConfig(snapshot.config)
    const capability = readCapabilityForConfig(configId)
    prompt.value = snapshot.prompt
    references.value = snapshot.references.map((reference) => ({
      ...reference,
      id: createId('reference'),
      image: { ...reference.image }
    }))
    count.value = readRequestCountForCapability(snapshot.count, capability)
    quality.value = capability.qualityOptions.includes(snapshot.quality) ? snapshot.quality : readDefaultQuality(capability.qualityOptions)

    const selectedSize = snapshot.selectedSize || snapshot.resolvedSize
    const customDimensions = snapshot.ratio === '自定义' ? readResolutionDimensions(selectedSize) : undefined
    if (customDimensions) {
      resolutionMode.value = 'custom'
      customWidth.value = customDimensions.width
      customHeight.value = customDimensions.height
    } else {
      resolutionMode.value = 'preset'
      size.value = capability.sizeOptions.includes(selectedSize) ? selectedSize : readDefaultSize(capability.sizeOptions)
      ratio.value = capability.ratioOptions.includes(snapshot.ratio)
        ? snapshot.ratio
        : readDefaultRatio(capability.ratioOptions, ratio.value)
    }

    activeView.value = 'workspace'
    status.value = '已填入修改请求'
    showToast('已填入修改请求')
  }

  async function placeImage(image: GeneratedImage, target: PlacementTarget) {
    await runCanvasAction({ type: 'place', label: '正在置入', imageId: image.id }, async () => {
      const placeableImage = image

      if (canUseElectronBridge.value) {
        await invokeElectronBridge('canvas.placeImage', {
          image: serializeCanvasImage(placeableImage),
          target: serializePlacementTarget(target, placeableImage)
        })
        status.value = '已置入 Photoshop'
        return
      }

      if (!canUsePhotoshop.value) {
        status.value = '浏览器预览无法置入 Photoshop'
        return
      }

      if (target.type === 'reference-selection') {
        const bounds = target.bounds
        await canvasPrimitiveService.insertImageFromPreview(placeableImage, {
          left: bounds.left,
          top: bounds.top,
          width: bounds.right - bounds.left,
          height: bounds.bottom - bounds.top
        })
        status.value = `已置入参考图片 ${target.referenceIndex + 1} 的选区`
        return
      }

      if (target.type === 'current-selection') {
        await canvasPrimitiveService.insertImageFromPreviewToSelection(placeableImage)
        status.value = '已置入当前选区'
        return
      }

      if (target.type === 'original-size') {
        await canvasPrimitiveService.insertImageFromPreview(placeableImage, {
          left: 0,
          top: 0,
          width: placeableImage.width,
          height: placeableImage.height
        })
        status.value = '已按原尺寸置入'
        return
      }

      await canvasPrimitiveService.insertImageFromPreviewToFullCanvas(placeableImage)
      status.value = '已置入全画布'
    })
  }

  async function saveGeneratedImage(image: CapturedCanvasImage) {
    status.value = '正在保存图片'

    try {
      if (canUseElectronBridge.value) {
        const result = await invokeElectronBridge<{ saved: boolean }>('result.saveImage', {
          fileName: readGeneratedImageFileName(image),
          height: image.height,
          label: image.label,
          previewUrl: image.previewUrl,
          width: image.width
        })
        if (!result.saved) {
          status.value = '已取消保存'
          return
        }
      } else if (canUsePhotoshop.value) {
        const saved = await saveUxpGeneratedImage(image)
        if (!saved) {
          status.value = '已取消保存'
          return
        }
      } else {
        await saveBrowserGeneratedImage(image)
      }

      status.value = '已保存到本地'
      showToast('已保存到本地')
    } catch (error) {
      const message = `保存失败：${readErrorMessage(error, '请稍后重试')}`
      status.value = message
      showToast(message)
    }
  }

  function useResultAsReference(image: GeneratedImage) {
    addReferenceImage('generated', image)
  }

  function upscaleImage(image: GeneratedImage) {
    const nextConfigId = configs.value.some((config) => config.id === image.modelConfigId) ? image.modelConfigId : activeConfigId.value
    const capability = readCapabilityForConfig(nextConfigId)

    activeConfigId.value = nextConfigId
    size.value = readUpscaleSize(capability.sizeOptions)
    quality.value = readHighestQuality(capability.qualityOptions)
    count.value = capability.countOptions.includes(1) ? 1 : capability.countOptions[0] ?? 1
    ratio.value = readDefaultRatio(capability.ratioOptions, ratio.value)
    prompt.value = '提升分辨率'
    references.value = [
      {
        id: createId('reference'),
        source: 'generated',
        label: image.label,
        image
      }
    ]
    status.value = `${image.label} 已填入超分参数`
  }

  function openSettings(configId = activeConfig.value.id) {
    settingsView.value = 'list'
    settingsDraftIsNew.value = false
    if (configId) {
      const source = configs.value.find((config) => config.id === configId) ?? activeConfig.value
      editingConfigId.value = source.id
      Object.assign(settingsDraft, cloneModelConfig(source))
    }
    activeView.value = 'settings'
  }

  function closeSettings() {
    activeView.value = 'workspace'
  }

  function closeSettingsDetail() {
    settingsView.value = 'list'
    settingsDraftIsNew.value = false
    resetSettingsDraft()
  }

  function editConfig(configId: string) {
    const source = configs.value.find((config) => config.id === configId)
    if (!source) {
      return
    }

    editingConfigId.value = source.id
    Object.assign(settingsDraft, cloneModelConfig(source))
    settingsDraftIsNew.value = false
    settingsView.value = 'detail'
  }

  function createConfig() {
    const next: ModelConfig = {
      id: createId('config'),
      name: '新配置',
      provider: 'custom-openai',
      model: 'custom-image-model',
      models: ['custom-image-model'],
      apiKey: '',
      baseUrl: '',
      usesOfficialBaseUrl: false,
      customFormat: 'openai-images',
      enabled: true,
      comfyUi: undefined
    }

    editingConfigId.value = next.id
    Object.assign(settingsDraft, next)
    settingsDraftIsNew.value = true
    settingsView.value = 'detail'
  }

  function readCopiedConfigName(name: string) {
    const baseName = name.trim() || '配置'
    const existingNames = new Set(configs.value.map((config) => config.name.trim()))
    let nextName = `${baseName} 副本`
    let index = 2

    while (existingNames.has(nextName)) {
      nextName = `${baseName} 副本 ${index}`
      index += 1
    }

    return nextName
  }

  function duplicateConfig() {
    const next = cloneModelConfig({
      ...settingsDraft,
      id: createId('config'),
      name: readCopiedConfigName(settingsDraft.name)
    })

    editingConfigId.value = next.id
    Object.assign(settingsDraft, next)
    settingsDraftIsNew.value = true
    settingsView.value = 'detail'
    status.value = '已复制配置'
    showToast('已复制配置')
  }

  function saveConfig() {
    if (settingsDraftIsNew.value) {
      configs.value = [...configs.value, cloneModelConfig({ ...settingsDraft, id: editingConfigId.value })]
      settingsDraftIsNew.value = false
    } else {
      configs.value = configs.value.map((config) =>
        config.id === editingConfigId.value ? cloneModelConfig({ ...settingsDraft, id: editingConfigId.value }) : config
      )
    }
    settingsView.value = 'list'
    status.value = '保存成功'
    showToast('保存成功')
  }

  function toggleConfigEnabled(enabled: boolean) {
    settingsDraft.enabled = enabled
    setSettingsTestState({ status: 'idle', message: '' })

    if (settingsDraftIsNew.value) {
      return
    }

    configs.value = configs.value.map((config) =>
      config.id === editingConfigId.value ? { ...config, enabled } : config
    )

    if (!enabled && activeConfigId.value === editingConfigId.value) {
      activeConfigId.value = configs.value.find((config) => config.enabled)?.id ?? editingConfigId.value
    }

    if (enabled) {
      activeConfigId.value = editingConfigId.value
    }

    const message = enabled ? '已启用配置' : '已停用配置'
    status.value = message
    showToast(message)
  }

  function deleteConfig() {
    if (settingsDraftIsNew.value) {
      closeSettingsDetail()
      status.value = '已取消新配置'
      return
    }

    configs.value = configs.value.filter((config) => config.id !== editingConfigId.value)
    const nextActiveConfigId = configs.value[0]?.id ?? ''
    activeConfigId.value = nextActiveConfigId
    editingConfigId.value = nextActiveConfigId
    resetSettingsDraft(nextActiveConfigId)
    settingsView.value = 'list'
  }

  async function testConfig() {
    const capability = providerCapabilities[settingsDraft.provider]

    if (settingsDraft.provider === 'codex-image-server') {
      if (!settingsDraft.baseUrl.trim()) {
        setSettingsTestState({ status: 'error', message: '请输入 Base URL' }, { resetAfterMs: 3000 })
        status.value = '请输入 Base URL'
        return
      }

      setSettingsTestState({ status: 'testing', message: '正在测试本机服务' })
      status.value = '正在测试本机服务'

      try {
        await testImageConfig({ ...settingsDraft })
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : ''
        const message = /api key|token|unauthorized|401/i.test(rawMessage)
          ? '本机服务 Key 校验失败'
          : rawMessage || '本机服务不可用'
        setSettingsTestState({ status: 'error', message }, { resetAfterMs: 3000 })
        status.value = message
        return
      }

      setSettingsTestState({ status: 'success', message: '本机服务可用' }, { resetAfterMs: 3000 })
      status.value = '本机服务可用'
      return
    }

    if (providerRequiresApiKey(settingsDraft.provider) && !settingsDraft.apiKey.trim()) {
      setSettingsTestState({ status: 'error', message: '请输入 API Key' }, { resetAfterMs: 3000 })
      status.value = '请输入 API Key'
      return
    }

    if (capability.supportsBaseUrl && !settingsDraft.baseUrl.trim()) {
      setSettingsTestState({ status: 'error', message: '请输入 Base URL' }, { resetAfterMs: 3000 })
      status.value = '请输入 Base URL'
      return
    }

    setSettingsTestState({ status: 'testing', message: '正在测试 API' })
    status.value = '正在测试 API'

    try {
      await testImageConfig({ ...settingsDraft })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'API 配置不可用'
      setSettingsTestState({ status: 'error', message }, { resetAfterMs: 3000 })
      status.value = message
      return
    }

    setSettingsTestState({ status: 'success', message: 'API 配置可用' }, { resetAfterMs: 3000 })
    status.value = 'API 配置可用'
  }

  async function deployWindows(side: WindowDeploySide) {
    if (!isElectronRuntime || !canUseElectronBridge.value) {
      const message = '请在 Lightyear App 中使用'
      windowDeployState.value = { status: 'error', message }
      status.value = message
      return
    }

    windowDeployState.value = { status: 'deploying', message: '正在部署窗口' }
    status.value = '正在部署窗口'

    try {
      const result = await withTimeout(
        invokeElectronBridge<WindowDeployResult>('app.deployWindows', { side }),
        10000,
        '窗口部署超时'
      )
      const message = result.photoshopAdjusted ? result.message : `App 已部署，${result.message}`
      windowDeployState.value = {
        status: result.photoshopAdjusted ? 'success' : 'error',
        message
      }
      status.value = message
    } catch (error) {
      const message = error instanceof Error ? error.message : '窗口部署失败'
      windowDeployState.value = { status: 'error', message }
      status.value = message
    }
  }

  async function openMacPermissionSettings(pane: MacPermissionPane) {
    if (!isElectronRuntime || !canUseElectronBridge.value) {
      const message = '请在 Lightyear App 中使用'
      status.value = message
      return
    }

    try {
      const result = await invokeElectronBridge<{ message: string }>('app.openMacPermissionSettings', { pane })
      status.value = result.message
      showToast(result.message)
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法打开系统设置'
      status.value = message
      showToast(message)
    }
  }

  async function checkForUpdates() {
    if (!isElectronRuntime || !canUseElectronBridge.value) {
      const message = '请在 Lightyear App 中使用'
      appUpdateState.value = {
        status: 'error',
        message,
        currentVersion: buildInfo.version
      }
      status.value = message
      showToast(message)
      return
    }

    appUpdateState.value = {
      status: 'checking',
      message: '正在检查更新',
      currentVersion: appUpdateState.value.currentVersion ?? buildInfo.version,
      latestVersion: appUpdateState.value.latestVersion,
      checkedAt: appUpdateState.value.checkedAt
    }
    status.value = '正在检查更新'

    try {
      const result = await withTimeout(
        invokeElectronBridge<AppUpdateCheckResult>('app.checkForUpdates'),
        15000,
        '更新检测超时'
      )

      if (result.status === 'available') {
        const message = `v${result.latestVersion} 可下载`
        appUpdateState.value = {
          status: 'available',
          message,
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
          checkedAt: result.checkedAt
        }
        status.value = message
        showToast(message)
        return
      }

      if (result.status === 'current') {
        const message = '已是最新版本'
        appUpdateState.value = {
          status: 'current',
          message,
          currentVersion: result.currentVersion,
          latestVersion: result.latestVersion,
          checkedAt: result.checkedAt
        }
        status.value = message
        showToast(message)
        return
      }

      const message = result.message || '更新检测失败'
      appUpdateState.value = {
        status: 'error',
        message,
        currentVersion: result.currentVersion || buildInfo.version,
        latestVersion: result.latestVersion,
        checkedAt: result.checkedAt
      }
      status.value = message
      showToast(message)
    } catch (error) {
      const message = error instanceof Error ? error.message : '更新检测失败'
      appUpdateState.value = {
        status: 'error',
        message,
        currentVersion: buildInfo.version,
        checkedAt: new Date().toISOString()
      }
      status.value = message
      showToast(message)
    }
  }

  async function exportDiagnostics() {
    if (!isElectronRuntime || !canUseElectronBridge.value) {
      const message = '请在 Lightyear App 中使用'
      diagnosticExportState.value = { status: 'error', message }
      status.value = message
      showToast(message)
      return
    }

    diagnosticExportState.value = {
      status: 'exporting',
      message: '正在整理最近 24 小时的日志'
    }

    try {
      const result = await withTimeout(exportElectronDiagnostics(), 30000, '日志整理超时')
      if (!result.saved) {
        diagnosticExportState.value = { status: 'idle', message: '最近 24 小时' }
        return
      }

      const message = result.recordCount === undefined ? '日志已保存' : `已保存 ${result.recordCount} 条记录`
      diagnosticExportState.value = { status: 'success', message }
      status.value = message
      showToast(message)
    } catch (error) {
      const message = error instanceof Error ? error.message : '日志下载失败'
      diagnosticExportState.value = { status: 'error', message }
      status.value = message
      showToast(message)
    }
  }

  function updateSettingsDraft(patch: Partial<ModelConfig>) {
    if (patch.provider && patch.provider !== settingsDraft.provider) {
      const capability = providerCapabilities[patch.provider]
      patch.model = capability.modelOptions[0] ?? settingsDraft.model
      patch.models = capability.modelOptions.length ? [...capability.modelOptions] : [patch.model]
      patch.baseUrl = readDefaultBaseUrl(patch.provider, settingsDraft.baseUrl)
      patch.usesOfficialBaseUrl = false
      patch.apiKey = readDefaultApiKey(patch.provider, settingsDraft.apiKey)
      patch.customFormat = patch.provider === 'custom-openai' ? normalizeCustomModelFormat(settingsDraft.customFormat) : undefined
      patch.comfyUi = patch.provider === 'comfyui' ? createDefaultComfyUiSettings() : undefined
    }

    if (patch.baseUrl !== undefined && patch.usesOfficialBaseUrl === undefined) {
      patch.usesOfficialBaseUrl = false
    }

    if (patch.models !== undefined) {
      patch.models = normalizeModelList(patch.models, patch.model ?? settingsDraft.model)
    }

    if (patch.customFormat !== undefined) {
      patch.customFormat = normalizeCustomModelFormat(patch.customFormat)
    }

    Object.assign(settingsDraft, patch)
    setSettingsTestState({ status: 'idle', message: '' })

    if (!settingsDraftIsNew.value) {
      configs.value = configs.value.map((config) =>
        config.id === editingConfigId.value ? cloneModelConfig({ ...settingsDraft, id: editingConfigId.value }) : config
      )
    }
  }

  if (isElectronRuntime) {
    refreshElectronDocument()
    bridgeStatusTimer = setInterval(() => {
      void refreshElectronDocument()
    }, 3000)
    removeBridgeListener = onElectronBridgeEvent(() => {
      void refreshElectronDocument()
    })
  } else {
    refreshDocument()
  }

  onUnmounted(() => {
    if (toastTimer) {
      clearTimeout(toastTimer)
    }
    if (bridgeStatusTimer) {
      clearInterval(bridgeStatusTimer)
    }
    clearSettingsTestResetTimer()
    removeBridgeListener?.()
    clearAllGenerationLoading()
  })

  return {
    activeCapability,
    activeConfig,
    activeConfigId,
    activeView,
    appendGeneration,
    busy,
    canvasOperation,
    canAddReference,
    canSend,
    cancelGeneration,
    canUsePhotoshop,
    clearConversationData,
    clearReferences,
    closeSettingsDetail,
    closeSettings,
    connectionStatus,
    configs,
    count,
    createConfig,
    customHeight,
    customWidth,
    deleteConfig,
    documentLabel,
    duplicateConfig,
    editGenerationRequest,
    editConfig,
    editingCapability,
    editingConfigId,
    enabledConfigs,
    generationLoading,
    installPluginUrl,
    appUpdateState,
    checkForUpdates,
    diagnosticExportState,
    exportDiagnostics,
    openMacPermissionSettings,
    openSettings,
    placeImage,
    prompt,
    providerCapabilities,
    quality,
    ratio,
    referenceLimit,
    references,
    refreshDocument,
    removeReference,
    retryGeneration,
    resolutionMode,
    saveConfig,
    saveGeneratedImage,
    selectConfig,
    selectModel,
    sendPrompt,
    settingsDraft,
    settingsDraftIsNew,
    settingsTestState,
    settingsView,
    size,
    testConfig,
    toastMessage,
    toggleConfigEnabled,
    turns,
    addReference,
    deployWindows,
    upscaleImage,
    updateSettingsDraft,
    windowDeployState,
    useResultAsReference
  }
}

import { computed, onUnmounted, reactive, shallowRef, watch } from 'vue'
import { createDefaultComfyUiSettings, normalizeComfyUiSettings } from '../data/comfyUiDefaults'
import { defaultModelConfigs, providerCapabilities, providerRequiresApiKey, readProviderCapability } from '../data/providerCapabilities'
import { generateImagesWithProvider, testImageConfig } from '../services/imageApiClient'
import {
  type AppView,
  type ChatTurn,
  type GeneratedImage,
  type GenerationLoadingState,
  type MacPermissionPane,
  type ModelConfig,
  type PlacementTarget,
  type ReferenceImage,
  type ReferenceSource,
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
  deserializeCanvasImage,
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
}

const settingsStorageKey = 'lightyear-banana.settings.v1'
const retiredBundledConfigIds = new Set([
  'nano-banana-pro',
  'gpt-image-2',
  'seedream-4',
  'qwen-image-edit',
  'kling-v3',
  'flux-2-pro-preview',
  'local-comfyui',
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

function cloneModelConfig(config: ModelConfig): ModelConfig {
  return {
    ...config,
    comfyUi: config.provider === 'comfyui' ? normalizeComfyUiSettings(config.comfyUi) : undefined
  }
}

function cloneDefaultConfigs() {
  return defaultModelConfigs.map(cloneModelConfig)
}

function readDefaultBaseUrl(provider: ModelConfig['provider'], fallback: string) {
  if (provider === 'comfyui') {
    return 'http://127.0.0.1:8000'
  }

  if (provider === 'codex-image-server') {
    return 'http://127.0.0.1:17341'
  }

  return providerCapabilities[provider].supportsBaseUrl ? fallback : ''
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
    config.provider in providerCapabilities &&
    typeof config.model === 'string' &&
    typeof config.apiKey === 'string' &&
    typeof config.baseUrl === 'string' &&
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

function readStoredSettings(): StoredSettings {
  const fallbackConfigs = cloneDefaultConfigs()
  const fallback: StoredSettings = {
    activeConfigId: fallbackConfigs[0]?.id ?? '',
    configs: fallbackConfigs
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
        configs
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
      configs
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
    defaultModelConfigs[0]
  const initialCapability = readProviderCapability(initialConfig)
  const activeView = shallowRef<AppView>('workspace')
  const settingsView = shallowRef<SettingsView>('list')
  const settingsDraftIsNew = shallowRef(false)
  const status = shallowRef(runtime === 'photoshop-uxp' ? 'Photoshop UXP' : isElectronRuntime ? 'Lightyear App' : 'Photoshop 已连接')
  const documentLabel = shallowRef(readActiveDocumentLabel())
  const busy = shallowRef(false)
  const prompt = shallowRef('')
  const references = shallowRef<ReferenceImage[]>([])
  const turns = shallowRef<ChatTurn[]>([])
  const configs = shallowRef<ModelConfig[]>(storedSettings.configs)
  const activeConfigId = shallowRef(storedSettings.activeConfigId)
  const size = shallowRef(readDefaultSize(initialCapability.sizeOptions))
  const quality = shallowRef(readDefaultQuality(initialCapability.qualityOptions))
  const count = shallowRef(initialCapability.countOptions.includes(1) ? 1 : initialCapability.countOptions[0] ?? 1)
  const ratio = shallowRef(initialCapability.ratioOptions.includes('原图比例') ? '原图比例' : initialCapability.ratioOptions[0] ?? '')
  const installPluginUrl = shallowRef('')
  const editingConfigId = shallowRef(activeConfigId.value)
  const settingsTestState = shallowRef<SettingsTestState>({ status: 'idle', message: '' })
  const windowDeployState = shallowRef<WindowDeployState>({ status: 'idle', message: '' })
  const toastMessage = shallowRef('')
  const generationLoading = shallowRef<GenerationLoadingState[]>([])
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
    () => configs.value.find((config) => config.id === activeConfigId.value) ?? configs.value[0] ?? defaultModelConfigs[0]
  )
  const activeCapability = computed(() => readProviderCapability(activeConfig.value))
  const editingCapability = computed(() => readProviderCapability(settingsDraft))
  const enabledConfigs = computed(() => configs.value.filter((config) => config.enabled))
  const referenceLimit = computed(() => activeCapability.value.referenceLimit)
  const canAddReference = computed(() => references.value.length < referenceLimit.value)
  const canSend = computed(() => Boolean(prompt.value.trim()) || references.value.length > 0)

  watch(
    [configs, activeConfigId],
    () => {
      writeStoredSettings({
        activeConfigId: activeConfigId.value,
        configs: configs.value.map(cloneModelConfig)
      })
    },
    { deep: true }
  )

  function readCapabilityForConfig(configId: string) {
    const config = configs.value.find((item) => item.id === configId) ?? activeConfig.value

    return readProviderCapability(config)
  }

  function readDefaultSize(options: string[]): string {
    return (
      options.find((option) => option === 'auto') ??
      options.find((option) => option === '1024x1024') ??
      options.find((option) => option === '1024*1024') ??
      options.find((option) => option === '1K') ??
      options.find((option) => option === '1k') ??
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
    return options.find((option) => option === '自动') ?? options[0] ?? ''
  }

  function readHighestQuality(options: string[]): string {
    return (
      options.find((option) => option === '最高') ??
      options.find((option) => option === '高') ??
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
    generationLoading.value = generationLoading.value.map((task) => ({
      ...task,
      elapsedSeconds: Math.floor((Date.now() - (generationStartedAt.get(task.id) ?? Date.now())) / 1000)
    }))
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
        elapsedSeconds: 0
      }
    ]
    ensureGenerationTimer()
    return id
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
      status.value = hasElectronBridge() ? 'Lightyear App 已连接' : 'Lightyear App 未连接'
      return
    }

    documentLabel.value = readActiveDocumentLabel()
    status.value = canUsePhotoshop.value || runtime === 'browser' ? 'Photoshop 已连接' : '等待 Photoshop 插件'
  }

  async function refreshElectronDocument() {
    if (!canUseElectronBridge.value) {
      status.value = 'Lightyear App 未连接'
      return
    }

    try {
      const bridgeStatus = await getElectronBridgeStatus()
      installPluginUrl.value = bridgeStatus.uxpPackage?.downloadUrl ?? ''
      documentLabel.value = bridgeStatus.photoshop.documentLabel ?? (bridgeStatus.photoshop.connected ? 'Photoshop 已连接' : 'Photoshop 未连接')
      status.value = bridgeStatus.photoshop.connected ? 'Photoshop 已连接' : 'Photoshop 未连接'
    } catch (error) {
      status.value = error instanceof Error ? error.message : 'Lightyear App 未连接'
    }
  }

  async function runAction(action: () => Promise<void>) {
    busy.value = true
    try {
      await action()
      if (isElectronRuntime) {
        await refreshElectronDocument()
      } else {
        refreshDocument()
      }
    } catch (error) {
      status.value = error instanceof Error ? error.message : '操作失败'
    } finally {
      busy.value = false
    }
  }

  function addReferenceImage(source: ReferenceSource, image: CapturedCanvasImage) {
    if (!canAddReference.value) {
      status.value = `当前模型最多 ${referenceLimit.value} 张参考图`
      return
    }

    references.value = [
      ...references.value,
      {
        id: createId('reference'),
        source,
        label: referenceLabels[source],
        image
      }
    ]
    status.value = `已添加${referenceLabels[source]}`
  }

  async function addReference(source: ReferenceSource) {
    await runAction(async () => {
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

  function removeReference(id: string) {
    references.value = references.value.filter((reference) => reference.id !== id)
  }

  function clearReferences() {
    references.value = []
  }

  function selectConfig(configId: string) {
    activeConfigId.value = configId
    const capability = activeCapability.value
    size.value = readDefaultSize(capability.sizeOptions)
    quality.value = capability.qualityOptions.includes(quality.value) ? quality.value : capability.qualityOptions[0] ?? '自动'
    count.value = capability.countOptions.includes(count.value) ? count.value : capability.countOptions[0] ?? 1
    ratio.value = capability.ratioOptions.includes(ratio.value)
      ? ratio.value
      : capability.ratioOptions.includes('原图比例')
        ? '原图比例'
        : capability.ratioOptions[0] ?? ratio.value
  }

  async function buildGeneratedImagesFromApi(apiImages: Array<{ previewUrl: string; label: string }>, modelConfigId: string) {
    return Promise.all(
      apiImages.map((apiImage, index) =>
        createCanvasImageFromApiAsset({
          id: createId(`generated-${index + 1}`),
          label: apiImage.label,
          modelConfigId,
          previewUrl: apiImage.previewUrl
        })
      )
    )
  }

  async function readCanvasSizeForRequest() {
    if (ratio.value !== '画布比例') {
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

  async function sendPrompt() {
    const cleanPrompt = prompt.value.trim()
    const hasReferences = references.value.length > 0
    if (!cleanPrompt && !hasReferences) {
      status.value = '请输入提示词或添加参考图'
      return
    }
    const requestPrompt = cleanPrompt || '根据参考图生成'
    const sentReferences = references.value.map((reference) => ({ ...reference }))
    const requestConfig = cloneModelConfig(activeConfig.value)
    const requestCapability = readProviderCapability(requestConfig)
    const requestCount = count.value
    const requestQuality = quality.value
    const requestRatio = ratio.value
    const requestSize = size.value
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

    try {
      requestCanvasSize = await readCanvasSizeForRequest()
    } catch (error) {
      const message = readErrorMessage(error, '无法读取画布比例')
      status.value = message
      showToast(message)
      return
    }

    prompt.value = ''
    references.value = []
    const startedAt = Date.now()
    const taskId = startGenerationLoading(requestPrompt, sentReferences)
    const abortController = new AbortController()
    generationControllers.set(taskId, abortController)
    status.value = '正在生成'

    void (async () => {
      try {
        const results = await buildGeneratedImagesFromApi(
          await generateImagesWithProvider({
            config: requestConfig,
            count: requestCount,
            canvasSize: requestCanvasSize,
            prompt: requestPrompt,
            quality: requestQuality,
            ratio: requestRatio,
            references: sentReferences,
            signal: abortController.signal,
            size: requestSize
          }),
          requestConfig.id
        )
        const turn: ChatTurn = {
          id: createId('turn'),
          prompt: requestPrompt,
          references: sentReferences,
          responseText: `${requestConfig.name} 已生成 ${results.length} 张图`,
          elapsedLabel: `耗费 ${readGenerationElapsed(taskId, startedAt)}s`,
          results
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
            elapsedLabel: `已取消 · ${readGenerationElapsed(taskId, startedAt)}s`,
            results: []
          }

          turns.value = [...turns.value, canceledTurn]
          return
        }

        const message = `API 请求失败：${readErrorMessage(error, '请检查配置后重试')}`
        const failedTurn: ChatTurn = {
          id: createId('turn'),
          prompt: requestPrompt,
          references: sentReferences,
          responseText: message,
          elapsedLabel: `失败 · ${readGenerationElapsed(taskId, startedAt)}s`,
          results: [],
          tone: 'error'
        }

        turns.value = [...turns.value, failedTurn]
        status.value = message
        showToast(message)
      } finally {
        stopGenerationLoading(taskId)
      }
    })()
  }

  async function placeImage(image: GeneratedImage, target: PlacementTarget) {
    await runAction(async () => {
      if (canUseElectronBridge.value) {
        await invokeElectronBridge('canvas.placeImage', {
          image: serializeCanvasImage(image),
          target: serializePlacementTarget(target, image)
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
        await canvasPrimitiveService.insertImage(image, {
          left: bounds.left,
          top: bounds.top,
          width: bounds.right - bounds.left,
          height: bounds.bottom - bounds.top
        })
        status.value = `已置入参考图片 ${target.referenceIndex + 1} 的选区`
        return
      }

      if (target.type === 'current-selection') {
        await canvasPrimitiveService.insertImageToSelection(image)
        status.value = '已置入当前选区'
        return
      }

      if (target.type === 'original-size') {
        await canvasPrimitiveService.insertImage(image, {
          left: 0,
          top: 0,
          width: image.width,
          height: image.height
        })
        status.value = '已按原尺寸置入'
        return
      }

      await canvasPrimitiveService.insertImageToFullCanvas(image)
      status.value = '已置入全画布'
    })
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
    ratio.value = capability.ratioOptions.includes('原图比例') ? '原图比例' : capability.ratioOptions[0] ?? ratio.value
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
      apiKey: '',
      baseUrl: '',
      enabled: true,
      comfyUi: undefined
    }

    editingConfigId.value = next.id
    Object.assign(settingsDraft, next)
    settingsDraftIsNew.value = true
    settingsView.value = 'detail'
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

    if (configs.value.length <= 1) {
      status.value = '至少保留一个配置'
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
        await testImageConfig({ ...settingsDraft, apiKey: '' })
      } catch (error) {
        const rawMessage = error instanceof Error ? error.message : ''
        const message = /api key|token|unauthorized|401/i.test(rawMessage)
          ? '本机服务未接受当前请求'
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

  function updateSettingsDraft(patch: Partial<ModelConfig>) {
    if (patch.provider && patch.provider !== settingsDraft.provider) {
      const capability = providerCapabilities[patch.provider]
      patch.model = capability.modelOptions[0] ?? settingsDraft.model
      patch.baseUrl = readDefaultBaseUrl(patch.provider, settingsDraft.baseUrl)
      patch.apiKey = providerRequiresApiKey(patch.provider) ? settingsDraft.apiKey : ''
      patch.comfyUi = patch.provider === 'comfyui' ? createDefaultComfyUiSettings() : undefined
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
    busy,
    canAddReference,
    canSend,
    cancelGeneration,
    canUsePhotoshop,
    clearReferences,
    closeSettingsDetail,
    closeSettings,
    configs,
    count,
    createConfig,
    deleteConfig,
    documentLabel,
    editConfig,
    editingCapability,
    editingConfigId,
    enabledConfigs,
    generationLoading,
    installPluginUrl,
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
    saveConfig,
    selectConfig,
    sendPrompt,
    settingsDraft,
    settingsDraftIsNew,
    settingsTestState,
    settingsView,
    size,
    status,
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

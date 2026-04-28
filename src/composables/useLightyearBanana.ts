import { computed, onUnmounted, reactive, shallowRef, watch } from 'vue'
import { defaultModelConfigs, providerCapabilities } from '../data/providerCapabilities'
import { generateImagesWithProvider, testImageConfig } from '../services/imageApiClient'
import {
  type AppView,
  type ChatTurn,
  type GeneratedImage,
  type GenerationLoadingState,
  type MacPermissionPane,
  type ModelConfig,
  type MockServerConfig,
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
import { createMockCanvasImage } from '../utils/mockImages'
import {
  deserializeCanvasImage,
  getElectronBridgeStatus,
  hasElectronBridge,
  invokeElectronBridge,
  onElectronBridgeEvent,
  serializeCanvasImage,
  serializePlacementTarget
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
  mockServer: MockServerConfig
}

const settingsStorageKey = 'lightyear-banana.settings.v1'
const defaultMockServer: MockServerConfig = {
  enabled: false,
  baseUrl: 'http://127.0.0.1:38322'
}

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

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

function cloneDefaultConfigs() {
  return defaultModelConfigs.map((config) => ({ ...config }))
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

  const storedConfigs = value.filter(isModelConfig).map((config) => ({ ...config }))
  if (!storedConfigs.length) {
    return cloneDefaultConfigs()
  }

  const storedById = new Map(storedConfigs.map((config) => [config.id, config]))
  const defaultIds = new Set(defaultModelConfigs.map((config) => config.id))
  const defaults = defaultModelConfigs.map((config) => ({ ...config, ...storedById.get(config.id) }))
  const customConfigs = storedConfigs.filter((config) => !defaultIds.has(config.id))

  return [...defaults, ...customConfigs]
}

function normalizeMockServer(value: unknown): MockServerConfig {
  if (!value || typeof value !== 'object') {
    return { ...defaultMockServer }
  }

  const source = value as Partial<MockServerConfig>
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : defaultMockServer.enabled,
    baseUrl: typeof source.baseUrl === 'string' && source.baseUrl.trim() ? source.baseUrl : defaultMockServer.baseUrl
  }
}

function readStoredSettings(): StoredSettings {
  const fallbackConfigs = cloneDefaultConfigs()
  const fallback: StoredSettings = {
    activeConfigId: fallbackConfigs[0]?.id ?? '',
    configs: fallbackConfigs,
    mockServer: { ...defaultMockServer }
  }

  try {
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
      mockServer: normalizeMockServer(parsed.mockServer)
    }
  } catch {
    return fallback
  }
}

function writeStoredSettings(settings: StoredSettings) {
  try {
    localStorage.setItem(settingsStorageKey, JSON.stringify(settings))
  } catch {
    // localStorage can be unavailable in restricted runtimes.
  }
}

export function useLightyearBanana(runtime: RuntimeName) {
  const storedSettings = readStoredSettings()
  const isElectronRuntime = runtime === 'electron'
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
  const size = shallowRef('4k')
  const quality = shallowRef('高')
  const count = shallowRef(3)
  const ratio = shallowRef('原图比例')
  const installPluginUrl = shallowRef('')
  const editingConfigId = shallowRef(activeConfigId.value)
  const settingsTestState = shallowRef<SettingsTestState>({ status: 'idle', message: '' })
  const windowDeployState = shallowRef<WindowDeployState>({ status: 'idle', message: '' })
  const toastMessage = shallowRef('')
  const generationLoading = reactive<GenerationLoadingState>({
    active: false,
    references: [],
    prompt: '',
    elapsedSeconds: 0
  })
  const mockServer = reactive<MockServerConfig>(storedSettings.mockServer)
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  let bridgeStatusTimer: ReturnType<typeof setInterval> | undefined
  let removeBridgeListener: (() => void) | undefined
  let generationTimer: ReturnType<typeof setInterval> | undefined

  const settingsDraft = reactive<ModelConfig>({
    ...(configs.value.find((config) => config.id === activeConfigId.value) ?? configs.value[0] ?? defaultModelConfigs[0])
  })

  const canUsePhotoshop = computed(() => runtime === 'photoshop-uxp' && Boolean(getHostRequire()))
  const canUseElectronBridge = computed(() => isElectronRuntime && hasElectronBridge())
  const activeConfig = computed(
    () => configs.value.find((config) => config.id === activeConfigId.value) ?? configs.value[0] ?? defaultModelConfigs[0]
  )
  const activeCapability = computed(() => providerCapabilities[activeConfig.value.provider])
  const editingCapability = computed(() => providerCapabilities[settingsDraft.provider])
  const enabledConfigs = computed(() => configs.value.filter((config) => config.enabled))
  const referenceLimit = computed(() => activeCapability.value.referenceLimit)
  const canAddReference = computed(() => references.value.length < referenceLimit.value)
  const canSend = computed(() => Boolean(prompt.value.trim()) || references.value.length > 0)

  watch(
    [configs, activeConfigId, () => mockServer.enabled, () => mockServer.baseUrl],
    () => {
      writeStoredSettings({
        activeConfigId: activeConfigId.value,
        configs: configs.value.map((config) => ({ ...config })),
        mockServer: { ...mockServer }
      })
    },
    { deep: true }
  )

  function readCapabilityForConfig(configId: string) {
    const config = configs.value.find((item) => item.id === configId) ?? activeConfig.value

    return providerCapabilities[config.provider]
  }

  function readUpscaleSize(options: string[]) {
    return (
      options.find((option) => option === '4k') ??
      options.find((option) => option === '2048x2048') ??
      options.find((option) => option === '2048*2048') ??
      options.find((option) => option === '4MP') ??
      options.at(-1) ??
      size.value
    )
  }

  function readHighestQuality(options: string[]) {
    return (
      options.find((option) => option === '最高') ??
      options.find((option) => option === '高') ??
      options.at(-1) ??
      quality.value
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

  function stopGenerationLoading() {
    if (generationTimer) {
      clearInterval(generationTimer)
      generationTimer = undefined
    }

    generationLoading.active = false
    generationLoading.references = []
    generationLoading.prompt = ''
    generationLoading.elapsedSeconds = 0
  }

  function startGenerationLoading(cleanPrompt: string, sentReferences: ReferenceImage[]) {
    stopGenerationLoading()
    const startedAt = Date.now()
    generationLoading.active = true
    generationLoading.references = sentReferences
    generationLoading.prompt = cleanPrompt
    generationLoading.elapsedSeconds = 0
    generationTimer = setInterval(() => {
      generationLoading.elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000)
    }, 250)
  }

  function resetSettingsDraft(configId = editingConfigId.value) {
    const source = configs.value.find((config) => config.id === configId) ?? activeConfig.value
    editingConfigId.value = source.id
    Object.assign(settingsDraft, source)
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
      if (source === 'visible') {
        const image = canUseElectronBridge.value
          ? deserializeCanvasImage(await invokeElectronBridge('canvas.captureVisible'))
          : canUsePhotoshop.value
            ? await canvasPrimitiveService.captureVisibleImage()
            : createMockCanvasImage(createId('visible'), '可见图层', 'blue')
        addReferenceImage(source, image)
        return
      }

      if (source === 'selection') {
        const image = canUseElectronBridge.value
          ? deserializeCanvasImage(await invokeElectronBridge('canvas.captureSelection'))
          : canUsePhotoshop.value
            ? await canvasPrimitiveService.captureSelectionImage()
            : createMockCanvasImage(createId('selection'), '选区', 'green', 280, 220)
        addReferenceImage(source, image)
        return
      }

      if (source === 'layer') {
        const image = canUseElectronBridge.value
          ? deserializeCanvasImage(await invokeElectronBridge('canvas.captureLayer'))
          : canUsePhotoshop.value
            ? await canvasPrimitiveService.captureSelectedLayerImage()
            : createMockCanvasImage(createId('layer'), '选择图层', 'amber', 320, 260)
        addReferenceImage(source, image)
        return
      }

      const tone = source === 'clipboard' ? 'violet' : 'gray'
      addReferenceImage(source, createMockCanvasImage(createId(source), referenceLabels[source], tone))
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
    size.value = capability.sizeOptions.at(-1) ?? size.value
    quality.value = capability.qualityOptions.includes(quality.value) ? quality.value : capability.qualityOptions[0] ?? '自动'
    count.value = capability.countOptions.includes(count.value) ? count.value : capability.countOptions[0] ?? 1
    ratio.value = capability.ratioOptions.includes(ratio.value) ? ratio.value : '原图比例'
  }

  async function buildGeneratedImagesFromApi(apiImages: Array<{ previewUrl: string; label: string }>) {
    return Promise.all(
      apiImages.map((apiImage, index) =>
        createCanvasImageFromApiAsset({
          id: createId(`generated-${index + 1}`),
          label: apiImage.label,
          modelConfigId: activeConfig.value.id,
          previewUrl: apiImage.previewUrl
        })
      )
    )
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

    if (!mockServer.enabled && !activeConfig.value.apiKey.trim()) {
      status.value = '请输入 API Key'
      showToast('请输入 API Key')
      return
    }

    if (activeCapability.value.supportsBaseUrl && !activeConfig.value.baseUrl.trim() && !mockServer.enabled) {
      status.value = '请输入 Base URL'
      showToast('请输入 Base URL')
      return
    }

    prompt.value = ''
    references.value = []
    startGenerationLoading(requestPrompt, sentReferences)
    await runAction(async () => {
      const startedAt = Date.now()
      try {
        const results = await buildGeneratedImagesFromApi(
          await generateImagesWithProvider({
            config: activeConfig.value,
            count: count.value,
            mockServer: { ...mockServer },
            prompt: requestPrompt,
            quality: quality.value,
            ratio: ratio.value,
            references: sentReferences,
            size: size.value
          })
        )
        const turn: ChatTurn = {
          id: createId('turn'),
          prompt: requestPrompt,
          references: sentReferences,
          responseText: `${activeConfig.value.name} 已生成 ${results.length} 张图`,
          elapsedLabel: `耗费 ${Math.max(1, Math.round((Date.now() - startedAt) / 1000))}s`,
          results
        }

        turns.value = [...turns.value, turn]
        status.value = '生成完成'
      } catch (error) {
        const message = `API 请求失败：${readErrorMessage(error, '请检查配置后重试')}`
        const failedTurn: ChatTurn = {
          id: createId('turn'),
          prompt: requestPrompt,
          references: sentReferences,
          responseText: message,
          elapsedLabel: `失败 · ${Math.max(1, Math.round((Date.now() - startedAt) / 1000))}s`,
          results: [],
          tone: 'error'
        }

        turns.value = [...turns.value, failedTurn]
        status.value = message
        showToast(message)
        throw new Error(message)
      } finally {
        stopGenerationLoading()
      }
    })
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
      Object.assign(settingsDraft, source)
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
    Object.assign(settingsDraft, source)
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
      enabled: true
    }

    editingConfigId.value = next.id
    Object.assign(settingsDraft, next)
    settingsDraftIsNew.value = true
    settingsView.value = 'detail'
  }

  function saveConfig() {
    if (settingsDraftIsNew.value) {
      configs.value = [...configs.value, { ...settingsDraft, id: editingConfigId.value }]
      settingsDraftIsNew.value = false
    } else {
      configs.value = configs.value.map((config) =>
        config.id === editingConfigId.value ? { ...settingsDraft, id: editingConfigId.value } : config
      )
    }
    settingsView.value = 'list'
    status.value = '保存成功'
    showToast('保存成功')
  }

  function toggleConfigEnabled(enabled: boolean) {
    settingsDraft.enabled = enabled
    settingsTestState.value = { status: 'idle', message: '' }

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
    if (!mockServer.enabled && !settingsDraft.apiKey.trim()) {
      settingsTestState.value = { status: 'error', message: '请输入 API Key' }
      status.value = '请输入 API Key'
      return
    }

    if (capability.supportsBaseUrl && !settingsDraft.baseUrl.trim() && !mockServer.enabled) {
      settingsTestState.value = { status: 'error', message: '请输入 Base URL' }
      status.value = '请输入 Base URL'
      return
    }

    settingsTestState.value = { status: 'testing', message: '正在测试 API' }
    status.value = '正在测试 API'

    if (mockServer.enabled) {
      try {
        await testImageConfig({ ...settingsDraft }, { ...mockServer })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'API 配置不可用'
        settingsTestState.value = { status: 'error', message }
        status.value = message
        return
      }
    } else {
      await wait(650)

      const mockShouldFail = /fail|error/i.test(`${settingsDraft.apiKey} ${settingsDraft.baseUrl}`)
      if (mockShouldFail) {
        settingsTestState.value = { status: 'error', message: 'API 配置不可用' }
        status.value = 'API 配置不可用'
        return
      }
    }

    settingsTestState.value = { status: 'success', message: 'API 配置可用' }
    status.value = 'API 配置可用'
  }

  function updateMockServer(patch: Partial<MockServerConfig>) {
    Object.assign(mockServer, patch)
    settingsTestState.value = { status: 'idle', message: '' }
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
      patch.baseUrl = capability.supportsBaseUrl ? settingsDraft.baseUrl : ''
    }

    Object.assign(settingsDraft, patch)
    settingsTestState.value = { status: 'idle', message: '' }
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
    removeBridgeListener?.()
    stopGenerationLoading()
  })

  return {
    activeCapability,
    activeConfig,
    activeConfigId,
    activeView,
    busy,
    canAddReference,
    canSend,
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
    mockServer,
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
    updateMockServer,
    windowDeployState,
    useResultAsReference
  }
}

import { computed, reactive, shallowRef, watch } from 'vue'
import { createDefaultComfyUiSettings } from '../../../../src/data/comfyUiDefaults'
import {
  providerCapabilities,
  readProviderCapability
} from '../../../../src/data/providerCapabilities'
import type { MugenController } from '../../../../src/composables/useMugen'
import type {
  AppView,
  CanvasOperationState,
  ChatTurn,
  DiagnosticExportState,
  GeneratedImage,
  GenerationLoadingPhase,
  GenerationLoadingState,
  GenerationRequestSnapshot,
  ImageRequestLogEntry,
  ModelConfig,
  PlacementTarget,
  PromptPreset,
  ReferenceImage,
  ReferenceSource,
  ResolutionInputMode,
  SettingsTestState,
  SettingsView,
} from '../../../../src/types/mugen'
import type { CapturedCanvasImage } from '../../../../src/uxp/canvasPrimitives'
import { normalizePromptPresets, resolvePromptPresetInput } from '../../../../src/utils/promptPresets'
import type {
  GenerationSnapshot,
  HostAssetRef,
  ModelConfig as HostModelConfig,
  ProviderId,
  RequestLog,
  TaskPhase
} from '@mugen/inner-protocol'
import { createMessageId, providerUsesApiKey } from '@mugen/inner-protocol'
import { useWorkspaceStore, type ChatTurn as HostTurn } from '@/stores/workspace'

const storedCredentialPlaceholder = '••••••••'
const presetStorageKey = 'mugen.prompt-presets.v1'

const referenceLabels: Record<ReferenceSource, string> = {
  visible: '可见图层',
  selection: '选区',
  layer: '选择图层',
  upload: '上传图片',
  clipboard: '剪贴板',
  generated: '生成结果'
}

function readStoredPromptPresets() {
  try {
    return normalizePromptPresets(JSON.parse(localStorage.getItem(presetStorageKey) || '[]'))
  } catch {
    return []
  }
}

function hostConfigToUi(config: HostModelConfig): ModelConfig {
  return {
    id: config.id,
    name: config.name,
    provider: config.provider,
    model: config.model,
    models: config.models?.length ? [...config.models] : [config.model],
    apiKey: config.hasCredential || config.credentialState === 'stored' ? storedCredentialPlaceholder : '',
    baseUrl: config.baseUrl,
    usesOfficialBaseUrl: false,
    customFormat: config.customFormat,
    enabled: config.enabled,
    comfyUi: config.comfyUi
      ? {
          workflow: config.comfyUi.workflow,
          workflowNodes: config.comfyUi.workflowNodes as ModelConfig['comfyUi'] extends infer T
            ? T extends { workflowNodes: infer N } ? N : never
            : never,
          timeoutMs: config.comfyUi.timeoutMs,
          pollIntervalMs: config.comfyUi.pollIntervalMs
        }
      : undefined
  }
}

function uiConfigToHost(config: ModelConfig, hasStoredCredential: boolean): HostModelConfig {
  return {
    id: config.id,
    name: config.name.trim(),
    provider: config.provider as ProviderId,
    model: config.model.trim(),
    models: config.models?.map((model) => model.trim()).filter(Boolean),
    baseUrl: config.baseUrl.trim(),
    enabled: config.enabled,
    hasCredential: hasStoredCredential || Boolean(config.apiKey && config.apiKey !== storedCredentialPlaceholder),
    credentialState: hasStoredCredential || Boolean(config.apiKey && config.apiKey !== storedCredentialPlaceholder) ? 'stored' : 'missing',
    customFormat: config.customFormat === 'openai' ? 'openai-images' : config.customFormat,
    comfyUi: config.comfyUi
      ? {
          workflow: config.comfyUi.workflow,
          workflowNodes: config.comfyUi.workflowNodes as Array<Record<string, unknown>>,
          timeoutMs: config.comfyUi.timeoutMs,
          pollIntervalMs: config.comfyUi.pollIntervalMs
        }
      : undefined
  }
}

function sourceBounds(asset: HostAssetRef) {
  const bounds = asset.sourceBounds
  const left = bounds?.left ?? 0
  const top = bounds?.top ?? 0
  return {
    left,
    top,
    right: bounds?.right ?? left + (bounds?.width ?? asset.width),
    bottom: bounds?.bottom ?? top + (bounds?.height ?? asset.height)
  }
}

function assetToCanvasImage(asset: HostAssetRef): CapturedCanvasImage {
  return {
    id: asset.assetId,
    label: asset.label,
    width: asset.width,
    height: asset.height,
    sourceBounds: sourceBounds(asset),
    previewUrl: asset.previewUrl,
    rgba: new Uint8Array()
  }
}

function assetToReference(asset: HostAssetRef): ReferenceImage {
  return {
    id: asset.assetId,
    source: asset.source,
    label: asset.label || referenceLabels[asset.source],
    image: assetToCanvasImage(asset)
  }
}

function assetToGenerated(asset: HostAssetRef, snapshot: GenerationSnapshot, modelName: string): GeneratedImage {
  return {
    ...assetToCanvasImage(asset),
    modelConfigId: snapshot.configId,
    modelName
  }
}

function requestLogToUi(log: RequestLog): ImageRequestLogEntry {
  return {
    id: log.id,
    createdAt: log.createdAt,
    url: log.url,
    method: log.method,
    status: log.status,
    ok: log.status >= 200 && log.status < 400,
    contentLength: '',
    metadata: {},
    stages: { headersMs: 0, bodyParseMs: 0, totalMs: log.durationMs }
  }
}

function phaseToLoading(phase: TaskPhase): GenerationLoadingPhase {
  if (phase === 'retrying') return 'waiting-retry'
  if (phase === 'downloading') return 'downloading'
  if (phase === 'waiting') return 'waiting-connection'
  return 'waiting-generation'
}

function makeEmptyConfig(): ModelConfig {
  const capability = providerCapabilities.openai
  return {
    id: createMessageId('config'),
    name: 'OpenAI',
    provider: 'openai',
    model: capability.modelOptions[0] || 'gpt-image-1',
    models: [...capability.modelOptions],
    apiKey: '',
    baseUrl: capability.officialBaseUrl || 'https://api.openai.com',
    enabled: true
  }
}

function cloneConfig(config: ModelConfig): ModelConfig {
  return {
    ...config,
    models: [...config.models],
    comfyUi: config.comfyUi
      ? {
          ...config.comfyUi,
          workflowNodes: config.comfyUi.workflowNodes.map((node) => ({ ...node, nodeIds: [...node.nodeIds] }))
        }
      : undefined
  }
}

export function useInnerMugen(): MugenController {
  const store = useWorkspaceStore()
  const activeView = shallowRef<AppView>('workspace')
  const settingsView = shallowRef<SettingsView>('list')
  const settingsDraftIsNew = shallowRef(false)
  const busy = shallowRef(false)
  const prompt = shallowRef('')
  const size = shallowRef('')
  const quality = shallowRef('')
  const count = shallowRef(1)
  const ratio = shallowRef('')
  const resolutionMode = shallowRef<ResolutionInputMode>('preset')
  const customWidth = shallowRef(2048)
  const customHeight = shallowRef(2048)
  const editingConfigId = shallowRef('')
  const promptPresets = shallowRef<PromptPreset[]>(readStoredPromptPresets())
  const toastMessage = shallowRef('')
  const canvasOperation = shallowRef<CanvasOperationState>({ type: 'idle', label: '' })
  const settingsTestState = shallowRef<SettingsTestState>({ status: 'idle', message: '' })
  const diagnosticExportState = shallowRef<DiagnosticExportState>({ status: 'idle', message: '最近 24 小时' })
  const settingsDraft = reactive<ModelConfig>(makeEmptyConfig())
  let toastTimer: ReturnType<typeof setTimeout> | undefined

  const configs = computed(() => store.configs.map(hostConfigToUi))
  const activeConfigId = computed({
    get: () => store.selectedConfigId,
    set: (value: string) => { void store.selectConfig(value) }
  })
  const activeConfig = computed(() => configs.value.find((config) => config.id === activeConfigId.value) || configs.value[0] || makeEmptyConfig())
  const activeCapability = computed(() => readProviderCapability(activeConfig.value))
  const editingCapability = computed(() => readProviderCapability(settingsDraft))
  const enabledConfigs = computed(() => configs.value.filter((config) => config.enabled))
  const referenceLimit = computed(() => activeCapability.value.referenceLimit)
  const references = computed(() => store.references.map(assetToReference))
  const canAddReference = computed(() => store.canAddReference)
  const canUsePhotoshop = computed(() => Boolean(store.context?.ready))
  const connectionStatus = computed(() => store.context?.ready ? 'Photoshop 已连接' : 'Photoshop 未连接')
  const documentLabel = computed(() => store.context?.document?.name || connectionStatus.value)
  const canSend = computed(() => {
    const config = store.currentConfig
    if (!config || !config.enabled || (!prompt.value.trim() && !store.references.length)) return false
    return !providerUsesApiKey(config.provider) || config.hasCredential || config.credentialState === 'stored'
  })
  const generationLoading = computed<GenerationLoadingState[]>(() => store.turns
    .filter((turn) => turn.status === 'running')
    .map((turn) => ({
      id: turn.id,
      references: turn.references.map(assetToReference),
      prompt: turn.prompt,
      elapsedSeconds: turn.elapsed,
      phase: phaseToLoading(turn.phase),
      requestLogs: turn.logs.map(requestLogToUi)
    })))
  const turns = computed<ChatTurn[]>(() => store.turns
    .filter((turn) => turn.status !== 'running')
    .map((turn) => hostTurnToUi(turn)))

  function hostTurnToUi(turn: HostTurn): ChatTurn {
    const config = configs.value.find((item) => item.id === turn.snapshot.configId)
    const modelName = config?.model || '模型'
    const snapshot: GenerationRequestSnapshot = {
      config: cloneConfig(config || makeEmptyConfig()),
      count: turn.snapshot.count,
      prompt: turn.snapshot.prompt,
      quality: turn.snapshot.quality,
      ratio: turn.snapshot.ratio,
      references: turn.references.map(assetToReference),
      resolvedSize: turn.snapshot.size,
      selectedSize: turn.snapshot.size,
      summary: [turn.snapshot.size, turn.snapshot.quality].filter(Boolean).join(' · ')
    }
    const responseText = turn.status === 'completed'
      ? `已生成 ${turn.results.length} 张 · ${modelName} · ${snapshot.summary}`
      : turn.status === 'cancelled'
        ? '已取消生成'
        : `API 请求失败：${turn.error || '请检查配置后重试'}`
    return {
      id: turn.id,
      prompt: turn.prompt,
      references: turn.references.map(assetToReference),
      responseText,
      elapsedLabel: turn.status === 'failed' ? `失败 · ${Math.max(1, Math.round(turn.elapsed))}s` : `耗费 ${Math.max(1, Math.round(turn.elapsed))}s`,
      repeatRequest: snapshot,
      requestLogs: turn.logs.map(requestLogToUi),
      results: turn.results.map((asset) => assetToGenerated(asset, turn.snapshot, modelName)),
      tone: turn.status === 'failed' ? 'error' : turn.status === 'cancelled' ? 'canceled' : 'normal'
    }
  }

  function showToast(message: string) {
    toastMessage.value = message
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => { toastMessage.value = '' }, 1800)
  }

  function syncRequestDefaults() {
    const capability = activeCapability.value
    size.value = capability.sizeOptions.includes(size.value) ? size.value : (capability.sizeOptions.find((item) => /^(1k|auto|1024)/i.test(item)) || capability.sizeOptions[0] || '')
    quality.value = capability.qualityOptions.includes(quality.value) ? quality.value : (capability.qualityOptions.find((item) => item === 'auto') || capability.qualityOptions[0] || '')
    count.value = capability.countOptions.includes(count.value) ? count.value : (capability.countOptions.includes(1) ? 1 : capability.countOptions[0] || 1)
    ratio.value = capability.ratioOptions.includes(ratio.value) ? ratio.value : (capability.ratioOptions.find((item) => item === '自动') || capability.ratioOptions[0] || '')
  }

  watch(activeCapability, syncRequestDefaults, { immediate: true })
  watch(() => store.status, (status) => {
    if (status !== 'ready') return
    const config = activeConfig.value
    editingConfigId.value = config.id
    Object.assign(settingsDraft, cloneConfig(config))
    promptPresets.value = store.promptPresets.length ? [...store.promptPresets] : readStoredPromptPresets()
    syncRequestDefaults()
  }, { immediate: true })

  async function withCanvasOperation(operation: CanvasOperationState, action: () => Promise<unknown>) {
    busy.value = true
    canvasOperation.value = operation
    try {
      await action()
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : '操作失败')
    } finally {
      canvasOperation.value = { type: 'idle', label: '' }
      busy.value = false
    }
  }

  function addReference(source: ReferenceSource) {
    if (source === 'generated') return
    return withCanvasOperation({ type: 'capture', label: `正在读取${referenceLabels[source]}` }, async () => {
      await store.addReference(source)
      if (store.error) showToast(store.error)
    })
  }

  function removeReference(id: string) { return store.removeReference(id) }
  function clearReferences() { return store.clearReferences() }

  async function sendPrompt(skipPresetResolution = false) {
    const resolved = resolvePromptPresetInput(prompt.value.trim(), promptPresets.value, { alreadyExpanded: skipPresetResolution })
    if (resolved.kind === 'error') {
      showToast(resolved.message)
      return
    }
    if (!canSend.value) {
      showToast('请输入提示词或添加参考图')
      return
    }
    const requestSize = resolutionMode.value === 'custom' ? `${Math.round(customWidth.value)}x${Math.round(customHeight.value)}` : size.value
    const submitted = await store.generate(resolved.prompt, {
      size: requestSize,
      quality: quality.value,
      count: count.value,
      ratio: resolutionMode.value === 'custom' ? '自定义' : ratio.value
    })
    if (!submitted) return
    prompt.value = ''
    await store.clearReferences()
    showToast('正在生成')
  }

  async function cancelGeneration(taskId: string) {
    const turn = store.turns.find((item) => item.id === taskId)
    if (turn) await store.cancel(turn)
  }

  async function appendGeneration(turnId: string) {
    const turn = store.turns.find((item) => item.id === turnId)
    if (!turn) return
    await store.retry(turn)
    showToast('正在追加生成')
  }

  async function retryGeneration(turnId: string) {
    const turn = store.turns.find((item) => item.id === turnId)
    if (!turn) return
    await store.retry(turn)
    showToast('正在重试生成')
  }

  async function editGenerationRequest(turnId: string) {
    const turn = store.turns.find((item) => item.id === turnId)
    if (!turn) return
    const applied = await store.applySnapshot(turn.snapshot, turn.references)
    if (!applied) return
    prompt.value = turn.snapshot.prompt
    size.value = turn.snapshot.size
    quality.value = turn.snapshot.quality
    count.value = turn.snapshot.count
    ratio.value = turn.snapshot.ratio
    resolutionMode.value = turn.snapshot.ratio === '自定义' ? 'custom' : 'preset'
    if (resolutionMode.value === 'custom') {
      const match = /^(\d+)[x*](\d+)$/i.exec(turn.snapshot.size)
      if (match) {
        customWidth.value = Number(match[1])
        customHeight.value = Number(match[2])
      }
    }
    activeView.value = 'workspace'
    showToast('已填入修改请求')
  }

  function findAsset(assetId: string) {
    return store.references.find((asset) => asset.assetId === assetId)
      || store.turns.flatMap((turn) => [...turn.results, ...turn.references]).find((asset) => asset.assetId === assetId)
  }

  async function placeImage(image: GeneratedImage, target: PlacementTarget) {
    await withCanvasOperation({ type: 'place', label: '正在置入', imageId: image.id }, async () => {
      if (target.type === 'reference-selection') {
        await store.host.placeAsset(image.id, {
          type: 'reference-selection',
          referenceAssetId: target.referenceId,
          bounds: target.bounds
        })
      } else {
        await store.place(image.id, target.type)
      }
      showToast('已置入 Photoshop')
    })
  }

  async function saveGeneratedImage(image: CapturedCanvasImage) {
    try {
      const result = await store.save(image.id)
      if (result.saved) showToast('已保存到本地')
    } catch (reason) {
      showToast(reason instanceof Error ? `保存失败：${reason.message}` : '保存失败')
    }
  }

  async function useResultAsReference(image: GeneratedImage) {
    const asset = findAsset(image.id)
    if (asset) await store.addResultAsReference(asset)
  }

  async function upscaleImage(image: GeneratedImage) {
    await useResultAsReference(image)
    const nextConfig = configs.value.find((config) => config.id === image.modelConfigId)
    if (nextConfig) await store.selectConfig(nextConfig.id)
    const capability = readProviderCapability(nextConfig || activeConfig.value)
    size.value = capability.sizeOptions.find((item) => /^(4k|2048)/i.test(item)) || capability.sizeOptions.at(-1) || ''
    quality.value = capability.qualityOptions.find((item) => /^(high|hd)$/i.test(item)) || capability.qualityOptions.at(-1) || ''
    count.value = capability.countOptions.includes(1) ? 1 : capability.countOptions[0] || 1
    prompt.value = '提升分辨率'
    showToast(`${image.label} 已填入超分参数`)
  }

  function openSettings(configId = activeConfig.value.id) {
    settingsView.value = 'list'
    settingsDraftIsNew.value = false
    const config = configs.value.find((item) => item.id === configId) || activeConfig.value
    editingConfigId.value = config.id
    Object.assign(settingsDraft, cloneConfig(config))
    activeView.value = 'settings'
  }

  function closeSettings() { activeView.value = 'workspace' }
  function closeSettingsDetail() {
    settingsView.value = 'list'
    settingsDraftIsNew.value = false
    const config = configs.value.find((item) => item.id === editingConfigId.value) || activeConfig.value
    Object.assign(settingsDraft, cloneConfig(config))
  }

  function openPromptPresets() {
    settingsView.value = 'presets'
    settingsDraftIsNew.value = false
    activeView.value = 'settings'
  }

  async function updatePromptPresets(next: PromptPreset[]) {
    promptPresets.value = normalizePromptPresets(next)
    try {
      await store.savePromptPresets(promptPresets.value)
      try { localStorage.setItem(presetStorageKey, JSON.stringify(promptPresets.value)) } catch {}
      showToast('预设已更新')
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : '预设保存失败')
    }
  }

  function editConfig(configId: string) {
    const config = configs.value.find((item) => item.id === configId)
    if (!config) return
    editingConfigId.value = config.id
    settingsDraftIsNew.value = false
    Object.assign(settingsDraft, cloneConfig(config))
    settingsView.value = 'detail'
    activeView.value = 'settings'
  }

  function createConfig() {
    const config = makeEmptyConfig()
    editingConfigId.value = config.id
    settingsDraftIsNew.value = true
    Object.assign(settingsDraft, config)
    settingsView.value = 'detail'
  }

  function duplicateConfig() {
    const config = cloneConfig(settingsDraft)
    config.id = createMessageId('config')
    config.name = `${config.name} 副本`
    config.apiKey = ''
    editingConfigId.value = config.id
    settingsDraftIsNew.value = true
    Object.assign(settingsDraft, config)
    showToast('已复制配置')
  }

  function updateSettingsDraft(patch: Partial<ModelConfig>) {
    if (patch.provider && patch.provider !== settingsDraft.provider) {
      const capability = providerCapabilities[patch.provider]
      patch.model = capability.modelOptions[0] || ''
      patch.models = [...capability.modelOptions]
      patch.baseUrl = capability.officialBaseUrl || ''
      patch.apiKey = ''
      patch.customFormat = patch.provider === 'custom-openai' ? 'openai-images' : undefined
      patch.comfyUi = patch.provider === 'comfyui' ? createDefaultComfyUiSettings() : undefined
    }
    Object.assign(settingsDraft, patch)
    settingsTestState.value = { status: 'idle', message: '' }
  }

  function storedCredentialFor(configId: string) {
    const config = store.configs.find((item) => item.id === configId)
    return Boolean(config?.hasCredential || config?.credentialState === 'stored')
  }

  async function saveConfig() {
    const apiKey = settingsDraft.apiKey && settingsDraft.apiKey !== storedCredentialPlaceholder ? settingsDraft.apiKey : undefined
    try {
      const saved = await store.saveConfig(uiConfigToHost(settingsDraft, storedCredentialFor(settingsDraft.id)), apiKey)
      editingConfigId.value = saved.id
      settingsDraftIsNew.value = false
      Object.assign(settingsDraft, hostConfigToUi(saved))
      settingsView.value = 'list'
      showToast('保存成功')
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : '保存失败')
    }
  }

  async function toggleConfigEnabled(enabled: boolean) {
    settingsDraft.enabled = enabled
    if (settingsDraftIsNew.value) return
    await saveConfig()
    editConfig(settingsDraft.id)
    showToast(enabled ? '已启用配置' : '已停用配置')
  }

  async function deleteConfig() {
    if (settingsDraftIsNew.value) {
      closeSettingsDetail()
      return
    }
    try {
      await store.deleteConfig(settingsDraft.id)
      settingsView.value = 'list'
      showToast('配置已删除')
    } catch (reason) {
      showToast(reason instanceof Error ? reason.message : '删除失败')
    }
  }

  async function testConfig() {
    settingsTestState.value = { status: 'testing', message: '正在测试连接' }
    const apiKey = settingsDraft.apiKey && settingsDraft.apiKey !== storedCredentialPlaceholder ? settingsDraft.apiKey : undefined
    try {
      const result = await store.host.testConfig(uiConfigToHost(settingsDraft, storedCredentialFor(settingsDraft.id)), apiKey)
      settingsTestState.value = { status: result.ok ? 'success' : 'error', message: result.message }
    } catch (reason) {
      settingsTestState.value = { status: 'error', message: reason instanceof Error ? reason.message : '连接测试失败' }
    }
  }

  async function selectConfig(configId: string) { await store.selectConfig(configId) }
  async function selectModel(model: string) {
    const config = activeConfig.value
    const next = cloneConfig(config)
    next.model = model
    if (!next.models.includes(model)) next.models.push(model)
    await store.saveConfig(uiConfigToHost(next, storedCredentialFor(next.id)))
  }

  async function clearConversationData() {
    await store.clearHistory()
    showToast('记录已清除')
  }

  async function exportDiagnostics() {
    diagnosticExportState.value = { status: 'exporting', message: '正在整理最近 24 小时的日志' }
    try {
      const result = await store.host.exportDiagnostics()
      diagnosticExportState.value = result.saved ? { status: 'success', message: '日志已保存' } : { status: 'idle', message: '最近 24 小时' }
    } catch (reason) {
      diagnosticExportState.value = { status: 'error', message: reason instanceof Error ? reason.message : '日志下载失败' }
    }
  }

  function refreshDocument() { return store.host.getContext().then((context) => { store.context = context }) }

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
    installPluginUrl: shallowRef(''),
    diagnosticExportState,
    exportDiagnostics,
    openPromptPresets,
    openSettings,
    placeImage,
    prompt,
    promptPresets,
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
    upscaleImage,
    updateSettingsDraft,
    updatePromptPresets,
    useResultAsReference
  } as unknown as MugenController
}

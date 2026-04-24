import { computed, reactive, shallowRef } from 'vue'
import { defaultModelConfigs, providerCapabilities } from '../data/providerCapabilities'
import {
  type AppView,
  type ChatTurn,
  type GeneratedImage,
  type ModelConfig,
  type PreviewMode,
  type ReferenceImage,
  type ReferenceSource,
  type RuntimeName,
  type SettingsView
} from '../types/lightyear'
import { canvasPrimitiveService } from '../uxp/canvasPrimitiveService'
import type { CapturedCanvasImage } from '../uxp/canvasPrimitives'
import { getHostRequire, readActiveDocumentLabel } from '../uxp/photoshopHost'
import { createMockCanvasImage } from '../utils/mockImages'

const referenceLabels: Record<ReferenceSource, string> = {
  visible: '可见图层',
  selection: '选区',
  layer: '选择图层',
  upload: '上传图片',
  clipboard: '剪贴板',
  generated: '生成结果'
}

const generatedTones = ['blue', 'green', 'amber', 'pink'] as const

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function cloneAsGenerated(image: CapturedCanvasImage, modelConfigId: string, index: number): GeneratedImage {
  return {
    ...image,
    id: createId(`generated-${index}`),
    label: `生成图 ${index}`,
    modelConfigId
  }
}

function readRatioSize(ratio: string, references: ReferenceImage[]) {
  if (ratio === '原图比例') {
    const source = references[0]?.image
    if (source) {
      const width = 512
      const height = Math.max(256, Math.round((width * source.height) / source.width))
      return { width, height }
    }
  }

  const [ratioWidth, ratioHeight] = ratio.split(':').map(Number)
  if (ratioWidth && ratioHeight) {
    const longSide = 512
    if (ratioWidth >= ratioHeight) {
      return {
        width: longSide,
        height: Math.max(256, Math.round((longSide * ratioHeight) / ratioWidth))
      }
    }

    return {
      width: Math.max(256, Math.round((longSide * ratioWidth) / ratioHeight)),
      height: longSide
    }
  }

  return { width: 512, height: 512 }
}

export function useLightyearBanana(runtime: RuntimeName) {
  const activeView = shallowRef<AppView>('workspace')
  const settingsView = shallowRef<SettingsView>('list')
  const settingsDraftIsNew = shallowRef(false)
  const status = shallowRef(runtime === 'photoshop-uxp' ? 'Photoshop UXP' : '浏览器预览')
  const documentLabel = shallowRef(readActiveDocumentLabel())
  const busy = shallowRef(false)
  const prompt = shallowRef('请生成一个极简风格的产品海报，保留主体材质和光线层次。')
  const references = shallowRef<ReferenceImage[]>([])
  const turns = shallowRef<ChatTurn[]>([])
  const configs = shallowRef<ModelConfig[]>(defaultModelConfigs.map((config) => ({ ...config })))
  const activeConfigId = shallowRef(configs.value[0]?.id ?? '')
  const selectedPreviewMode = shallowRef<PreviewMode>('full-canvas')
  const size = shallowRef('4k')
  const quality = shallowRef('高')
  const count = shallowRef(3)
  const ratio = shallowRef('原图比例')
  const editingConfigId = shallowRef(activeConfigId.value)

  const settingsDraft = reactive<ModelConfig>({ ...(configs.value[0] ?? defaultModelConfigs[0]) })

  const canUsePhotoshop = computed(() => runtime === 'photoshop-uxp' && Boolean(getHostRequire()))
  const activeConfig = computed(
    () => configs.value.find((config) => config.id === activeConfigId.value) ?? configs.value[0] ?? defaultModelConfigs[0]
  )
  const activeCapability = computed(() => providerCapabilities[activeConfig.value.provider])
  const editingCapability = computed(() => providerCapabilities[settingsDraft.provider])
  const enabledConfigs = computed(() => configs.value.filter((config) => config.enabled))
  const referenceLimit = computed(() => activeCapability.value.referenceLimit)
  const canAddReference = computed(() => references.value.length < referenceLimit.value)

  function resetSettingsDraft(configId = editingConfigId.value) {
    const source = configs.value.find((config) => config.id === configId) ?? activeConfig.value
    editingConfigId.value = source.id
    Object.assign(settingsDraft, source)
  }

  function refreshDocument() {
    documentLabel.value = readActiveDocumentLabel()
    status.value = canUsePhotoshop.value ? 'Photoshop 已连接' : '浏览器预览'
  }

  async function runAction(action: () => Promise<void>) {
    busy.value = true
    try {
      await action()
      refreshDocument()
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
        const image = canUsePhotoshop.value
          ? await canvasPrimitiveService.captureVisibleImage()
          : createMockCanvasImage(createId('visible'), '可见图层', 'blue')
        addReferenceImage(source, image)
        return
      }

      if (source === 'selection') {
        const image = canUsePhotoshop.value
          ? await canvasPrimitiveService.captureSelectionImage()
          : createMockCanvasImage(createId('selection'), '选区', 'green', 280, 220)
        addReferenceImage(source, image)
        selectedPreviewMode.value = 'reference-selection'
        return
      }

      if (source === 'layer') {
        const image = canUsePhotoshop.value
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

  function buildGeneratedImages() {
    const targetCount = Math.min(count.value, activeCapability.value.countOptions.at(-1) ?? count.value)
    const outputSize = readRatioSize(ratio.value, references.value)

    return Array.from({ length: targetCount }, (_, index) => {
      const base = createMockCanvasImage(
        createId('result'),
        `生成图 ${index + 1}`,
        generatedTones[index % generatedTones.length],
        outputSize.width,
        outputSize.height
      )

      return cloneAsGenerated(base, activeConfig.value.id, index + 1)
    })
  }

  async function sendPrompt() {
    const cleanPrompt = prompt.value.trim()
    if (!cleanPrompt) {
      status.value = '请输入提示词'
      return
    }

    await runAction(async () => {
      const results = buildGeneratedImages()
      const turn: ChatTurn = {
        id: createId('turn'),
        prompt: cleanPrompt,
        references: references.value.map((reference) => ({ ...reference })),
        responseText: `${activeConfig.value.name} 已生成 ${results.length} 张图`,
        elapsedLabel: '耗费 1m 12s',
        previewMode: selectedPreviewMode.value,
        results
      }

      turns.value = [...turns.value, turn]
      status.value = '生成完成'
    })
  }

  async function placeImage(image: GeneratedImage, mode: PreviewMode) {
    await runAction(async () => {
      if (!canUsePhotoshop.value) {
        status.value = '浏览器预览无法置入 Photoshop'
        return
      }

      if (mode === 'reference-selection') {
        const referenceSelection = references.value.find((reference) => reference.source === 'selection')
        if (referenceSelection) {
          const bounds = referenceSelection.image.sourceBounds
          await canvasPrimitiveService.insertImage(image, {
            left: bounds.left,
            top: bounds.top,
            width: bounds.right - bounds.left,
            height: bounds.bottom - bounds.top
          })
          status.value = '已置入参考图选区'
          return
        }
      }

      if (mode === 'current-selection') {
        await canvasPrimitiveService.insertImageToSelection(image)
        status.value = '已置入当前选区'
        return
      }

      await canvasPrimitiveService.insertImageToFullCanvas(image)
      status.value = '已置入全图'
    })
  }

  function useResultAsReference(image: GeneratedImage) {
    addReferenceImage('generated', image)
  }

  function previewImage(image: GeneratedImage) {
    status.value = `预览 ${image.label}`
  }

  function upscaleImage(image: GeneratedImage) {
    status.value = `${image.label} 已加入超分队列`
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

  function restoreSettingsDraft() {
    if (settingsDraftIsNew.value) {
      createConfig()
      return
    }

    editConfig(editingConfigId.value)
    status.value = '已还原配置'
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
    status.value = '配置已保存'
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

  function testConfig() {
    status.value = '配置格式可用'
  }

  function updateSettingsDraft(patch: Partial<ModelConfig>) {
    if (patch.provider && patch.provider !== settingsDraft.provider) {
      const capability = providerCapabilities[patch.provider]
      patch.model = capability.modelOptions[0] ?? settingsDraft.model
      patch.baseUrl = capability.supportsBaseUrl ? settingsDraft.baseUrl : ''
    }

    Object.assign(settingsDraft, patch)
  }

  refreshDocument()

  return {
    activeCapability,
    activeConfig,
    activeConfigId,
    activeView,
    busy,
    canAddReference,
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
    openSettings,
    placeImage,
    previewImage,
    prompt,
    providerCapabilities,
    quality,
    ratio,
    referenceLimit,
    references,
    refreshDocument,
    removeReference,
    restoreSettingsDraft,
    saveConfig,
    selectedPreviewMode,
    selectConfig,
    sendPrompt,
    settingsDraft,
    settingsDraftIsNew,
    settingsView,
    size,
    status,
    testConfig,
    turns,
    addReference,
    upscaleImage,
    updateSettingsDraft,
    useResultAsReference
  }
}

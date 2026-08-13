<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import type { CanvasOperationState, ModelConfig, PromptPreset, ReferenceImage, ReferenceSource, ResolutionInputMode } from '@mugen/core'
import type { ProviderCapability } from '@mugen/core'
import { useOutsidePointerDown } from '../../composables/useOutsidePointerDown'
import { providerSupportsQuality, validateProviderConfig } from '@mugen/core'
import BoxIcon from './BoxIcon.vue'
import type { BoxIconName } from './boxIcons'
import ControlSelect from './ControlSelect.vue'
import RatioPicker from './RatioPicker.vue'
import ReferenceThumb from './ReferenceThumb.vue'
import PromptPresetMenu from './PromptPresetMenu.vue'
import { createReferenceImportFromBlob } from '../../utils/referenceImages'

type SelectOption = {
  icon?: BoxIconName
  value: string
  label: string
  meta?: string
  status?: string
  statusTone?: 'ready' | 'warning' | 'muted'
}

type ModelStatus = {
  label: string
  tone: 'ready' | 'warning' | 'muted'
}

const props = defineProps<{
  activeMenuOwner?: string
  activeCapability: ProviderCapability
  activeConfigId: string
  busy: boolean
  canvasOperation: CanvasOperationState
  canAddReference: boolean
  canSend: boolean
  configs: ModelConfig[]
  count: number
  customHeight: number
  customWidth: number
  prompt: string
  promptPresets: PromptPreset[]
  photoshopIntegrationAvailable: boolean
  quality: string
  ratio: string
  references: ReferenceImage[]
  resolutionMode: ResolutionInputMode
  size: string
}>()

const manageModelsValue = '__mugen_manage_models__'

const emit = defineEmits<{
  addReference: [source: ReferenceSource]
  importReference: [input: { name: string; mimeType: string; source: 'upload' | 'clipboard'; width: number; height: number; dataUrl: string; thumbnailUrl: string }]
  clearReferences: []
  manageModels: []
  menuOpen: [owner: string]
  preview: [image: ReferenceImage['image']]
  removeReference: [id: string]
  selectConfig: [id: string]
  selectModel: [model: string]
  send: [skipPresetResolution?: boolean]
  updateCount: [value: number]
  updatePrompt: [value: string]
  updateQuality: [value: string]
  updateRatio: [value: string]
  updateResolutionMode: [value: ResolutionInputMode]
  updateSize: [value: string]
  updateCustomHeight: [value: number]
  updateCustomWidth: [value: number]
}>()

const openPanel = shallowRef('')
const expandedPresetContent = shallowRef<string | null>(null)
const referenceImportError = shallowRef('')
const referenceMenuRef = useTemplateRef<HTMLElement>('referenceMenu')
const promptInputRef = useTemplateRef<HTMLTextAreaElement>('promptInput')
const browserUploadInputRef = useTemplateRef<HTMLInputElement>('browserUploadInput')
const customSizeValue = '__mugen_custom_resolution__'
let shouldRestorePromptFocus = false
let promptFocusFrame: number | undefined

const allReferenceActions: Array<{ icon: BoxIconName; source: ReferenceSource; label: string }> = [
  { icon: 'image', source: 'visible', label: '可见图层' },
  { icon: 'selection', source: 'selection', label: '选区' },
  { icon: 'layer', source: 'layer', label: '当前选中图层' },
  { icon: 'upload', source: 'upload', label: '上传文件' }
]
const photoshopReferenceSources = new Set<ReferenceSource>(['visible', 'selection', 'layer'])
const referenceActions = computed(() => allReferenceActions.filter((action) => (
  props.photoshopIntegrationAvailable || !photoshopReferenceSources.has(action.source)
)))

const referenceCountText = computed(() => `${props.references.length} / ${props.activeCapability.referenceLimit}`)
const hasReferences = computed(() => props.references.length > 0)
const referenceBusy = computed(() => props.canvasOperation.type === 'capture')
const referenceDragActive = shallowRef(false)
const activeConfig = computed(() => props.configs.find((config) => config.id === props.activeConfigId) ?? props.configs[0])
const activeModel = computed(() => activeConfig.value?.model ?? '')
const configOptions = computed<SelectOption[]>(() =>
  props.configs.map((config) => {
    const status = readModelStatus(config)

    return {
      icon: 'key',
      value: config.id,
      label: config.name,
      meta: `${config.provider}${config.customFormat ? ` · ${config.customFormat}` : ''}`,
      status: status.label,
      statusTone: status.tone
    }
  })
)
const modelOptions = computed<SelectOption[]>(() => {
  const models = activeConfig.value?.models?.length ? activeConfig.value.models : activeModel.value ? [activeModel.value] : []

  return [
    ...models.map((model) => ({
      icon: 'slider-alt' as BoxIconName,
      value: model,
      label: model,
      meta: activeConfig.value?.name
    })),
    {
      icon: 'plus' as BoxIconName,
      value: manageModelsValue,
      label: '管理模型',
      meta: '设置'
    }
  ]
})
const sizeOptions = computed<SelectOption[]>(() =>
  [
    ...props.activeCapability.sizeOptions.map((option) => ({ value: option, label: option })),
    {
      icon: 'crop' as BoxIconName,
      value: customSizeValue,
      label: '宽高输入'
    }
  ]
)
const qualityOptions = computed<SelectOption[]>(() =>
  props.activeCapability.qualityOptions.map((option) => ({ value: option, label: option }))
)
const showsQualityControl = computed(() => Boolean(activeConfig.value && providerSupportsQuality(activeConfig.value) && props.activeCapability.qualityOptions.length))
const countOptions = computed<SelectOption[]>(() =>
  props.activeCapability.countOptions.map((option) => ({ value: String(option), label: String(option) }))
)

function addReference(source: ReferenceSource) {
  openPanel.value = ''
  emit('menuOpen', '')
  if (source === 'upload' && !props.photoshopIntegrationAvailable) {
    const input = browserUploadInputRef.value
    if (input) {
      input.value = ''
      input.click()
    }
    return
  }
  emit('addReference', source)
}

function handleBrowserUploadChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) void importImageBlob(file, file.name, 'upload')
}

function togglePanel(panel: string) {
  const nextPanel = openPanel.value === panel ? '' : panel
  openPanel.value = nextPanel
  emit('menuOpen', nextPanel ? `composer:${nextPanel}` : '')
}

function closePanel() {
  if (openPanel.value) {
    emit('menuOpen', '')
  }

  openPanel.value = ''
}

function readDimensionInput(event: Event) {
  return Number((event.target as HTMLInputElement).value)
}

function readModelStatus(config: ModelConfig): ModelStatus {
  if (!config.enabled) {
    return { label: '停用', tone: 'muted' }
  }

  const issue = validateProviderConfig(config).issues[0]
  if (issue) {
    const label = issue.code === 'missing-api-key'
      ? '缺少 Key'
      : issue.code === 'missing-base-url'
        ? '缺少 URL'
        : '不可用'
    return { label, tone: 'warning' }
  }

  return { label: '可用', tone: 'ready' }
}

function handleModelChange(value: string) {
  openPanel.value = ''
  if (value === manageModelsValue) {
    emit('manageModels')
    return
  }

  emit('selectModel', value)
}

function handleSizeChange(value: string) {
  openPanel.value = ''

  if (value === customSizeValue) {
    emit('updateResolutionMode', 'custom')
    return
  }

  emit('updateSize', value)
}

function usePresetResolution() {
  openPanel.value = ''
  emit('menuOpen', '')
  emit('updateResolutionMode', 'preset')
}

function applyPromptPreset(preset: PromptPreset) {
  openPanel.value = ''
  expandedPresetContent.value = preset.content
  emit('menuOpen', '')
  emit('updatePrompt', preset.content)
}

function updatePromptInput(value: string) {
  expandedPresetContent.value = null
  emit('updatePrompt', value)
}

function handlePromptFocus() {
  shouldRestorePromptFocus = true
  closePanel()
}

function handlePromptBlur(event: FocusEvent) {
  if (event.relatedTarget instanceof Node && document.contains(event.relatedTarget)) {
    shouldRestorePromptFocus = false
  }
}

function restorePromptFocus() {
  if (!shouldRestorePromptFocus || promptFocusFrame !== undefined) return
  promptFocusFrame = window.requestAnimationFrame(() => {
    promptFocusFrame = undefined
    const target = promptInputRef.value
    if (!shouldRestorePromptFocus || !target) return
    target.blur()
    promptFocusFrame = window.requestAnimationFrame(() => {
      promptFocusFrame = undefined
      if (shouldRestorePromptFocus && target.isConnected) {
        target.focus({ preventScroll: true })
      }
    })
  })
}

function handleWindowBlur() {
  if (document.activeElement === promptInputRef.value) {
    shouldRestorePromptFocus = true
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') restorePromptFocus()
}

function requestSend() {
  emit('send', expandedPresetContent.value === props.prompt)
}

function handlePromptKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
    return
  }

  event.preventDefault()
  if (props.busy || !props.canSend) {
    return
  }

  closePanel()
  requestSend()
}

function imageFileFromItems(items: DataTransferItemList | undefined) {
  if (!items) return undefined
  for (const item of Array.from(items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile() ?? undefined
  }
  return undefined
}

function hasImageItem(items: DataTransferItemList | undefined) {
  return Boolean(items && Array.from(items).some((item) => item.kind === 'file' && item.type.startsWith('image/')))
}

function imageFileFromTransfer(transfer: DataTransfer | null) {
  return imageFileFromItems(transfer?.items) ?? Array.from(transfer?.files ?? []).find((file) => file.type.startsWith('image/'))
}

type ClipboardTextPayload = {
  html: string
  plain: string
  uriList: string
}

function readImmediateClipboardText(transfer: DataTransfer): ClipboardTextPayload {
  return {
    html: transfer.getData('text/html'),
    plain: transfer.getData('text/plain'),
    uriList: transfer.getData('text/uri-list')
  }
}

function readClipboardStringItem(transfer: DataTransfer, type: string) {
  const immediate = transfer.getData(type)
  if (immediate) return Promise.resolve(immediate)
  const item = Array.from(transfer.items).find((candidate) => candidate.kind === 'string' && candidate.type === type)
  if (!item) return Promise.resolve('')
  return new Promise<string>((resolve) => item.getAsString(resolve))
}

async function readClipboardText(transfer: DataTransfer): Promise<ClipboardTextPayload> {
  const [html, plain, uriList] = await Promise.all([
    readClipboardStringItem(transfer, 'text/html'),
    readClipboardStringItem(transfer, 'text/plain'),
    readClipboardStringItem(transfer, 'text/uri-list')
  ])
  return { html, plain, uriList }
}

function readHtmlImageSource(html: string) {
  if (!html) return ''
  return new DOMParser().parseFromString(html, 'text/html').querySelector('img[src]')?.getAttribute('src')?.trim() ?? ''
}

function readFirstUri(value: string) {
  return value.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith('#')) ?? ''
}

function looksLikeImageUrl(value: string) {
  const source = value.trim()
  if (/^(?:data:image\/|blob:)/i.test(source)) return true
  try {
    return /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(new URL(source).pathname)
  } catch {
    return false
  }
}

function readClipboardImageSource(payload: ClipboardTextPayload) {
  const htmlSource = readHtmlImageSource(payload.html)
  if (htmlSource) return htmlSource
  const uriSource = readFirstUri(payload.uriList)
  if (looksLikeImageUrl(uriSource)) return uriSource
  const plainSource = payload.plain.trim()
  return looksLikeImageUrl(plainSource) ? plainSource : ''
}

function hasDeferredClipboardText(transfer: DataTransfer, payload: ClipboardTextPayload) {
  if (payload.html || payload.plain || payload.uriList) return false
  return Array.from(transfer.items).some((item) => item.kind === 'string' && ['text/html', 'text/plain', 'text/uri-list'].includes(item.type))
}

function readPlainText(payload: ClipboardTextPayload) {
  if (payload.plain) return payload.plain
  if (payload.uriList) return readFirstUri(payload.uriList)
  if (!payload.html) return ''
  return new DOMParser().parseFromString(payload.html, 'text/html').body.textContent ?? ''
}

function insertPlainText(target: HTMLTextAreaElement, value: string) {
  if (!value) return
  target.setRangeText(value, target.selectionStart, target.selectionEnd, 'end')
  updatePromptInput(target.value)
}

async function importImageBlob(blob: Blob, name: string, source: 'upload' | 'clipboard') {
  if (!props.canAddReference) {
    referenceImportError.value = '当前模型无法添加更多参考图'
    return
  }
  referenceImportError.value = ''
  try {
    emit('importReference', await createReferenceImportFromBlob(blob, name, source))
  } catch (reason) {
    referenceImportError.value = reason instanceof Error ? reason.message : '无法读取图片'
  }
}

function readImageDataUrl(source: string) {
  const separator = source.indexOf(',')
  if (separator < 0) throw new Error('invalid clipboard image data')
  const metadata = source.slice(5, separator)
  const mimeType = metadata.split(';')[0]?.toLowerCase() ?? ''
  if (!mimeType.startsWith('image/')) throw new Error('clipboard data is not an image')
  const encoded = source.slice(separator + 1)
  if (!metadata.split(';').some((value) => value.toLowerCase() === 'base64')) return new Blob([decodeURIComponent(encoded)], { type: mimeType })
  const binary = atob(encoded)
  return new Blob([Uint8Array.from(binary, (character) => character.charCodeAt(0))], { type: mimeType })
}

async function importClipboardImageSource(source: string) {
  try {
    const resolvedSource = source.startsWith('//') ? `https:${source}` : source
    const protocol = new URL(resolvedSource).protocol
    if (!['blob:', 'data:', 'http:', 'https:'].includes(protocol)) throw new Error('unsupported clipboard image URL')
    let blob: Blob
    if (protocol === 'data:') {
      blob = readImageDataUrl(resolvedSource)
    } else {
      const response = await fetch(resolvedSource, { credentials: 'omit', referrerPolicy: 'no-referrer' })
      if (!response.ok) throw new Error(`clipboard image returned ${response.status}`)
      blob = await response.blob()
    }
    if (blob.type && !blob.type.toLowerCase().startsWith('image/')) throw new Error('clipboard URL is not an image')
    await importImageBlob(blob, '剪贴板图片.png', 'clipboard')
  } catch {
    referenceImportError.value = '无法读取剪贴板图片，请重新复制图片或保存后拖入'
  }
}

async function handleDeferredClipboardPaste(transfer: DataTransfer, target: HTMLTextAreaElement | undefined) {
  const payload = await readClipboardText(transfer)
  const imageSource = readClipboardImageSource(payload)
  if (imageSource) {
    await importClipboardImageSource(imageSource)
    return
  }
  if (target) insertPlainText(target, readPlainText(payload))
}

function handlePaste(event: ClipboardEvent) {
  const transfer = event.clipboardData
  if (!transfer) return
  const file = imageFileFromTransfer(transfer)
  if (file) {
    event.preventDefault()
    void importImageBlob(file, file.name || '剪贴板图片.png', 'clipboard')
    return
  }

  const payload = readImmediateClipboardText(transfer)
  const imageSource = readClipboardImageSource(payload)
  if (imageSource) {
    event.preventDefault()
    void importClipboardImageSource(imageSource)
    return
  }

  if (!hasDeferredClipboardText(transfer, payload)) return
  event.preventDefault()
  void handleDeferredClipboardPaste(transfer, event.target instanceof HTMLTextAreaElement ? event.target : undefined)
}

function handleDragOver(event: DragEvent) {
  if (!hasImageItem(event.dataTransfer?.items)) return
  event.preventDefault()
  referenceDragActive.value = true
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function handleDragLeave(event: DragEvent) {
  if (event.relatedTarget instanceof Node && event.currentTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
  referenceDragActive.value = false
}

function handleDrop(event: DragEvent) {
  const file = imageFileFromTransfer(event.dataTransfer)
  referenceDragActive.value = false
  if (!file) return
  event.preventDefault()
  void importImageBlob(file, file.name, 'upload')
}

useOutsidePointerDown(referenceMenuRef, closePanel, () => openPanel.value === 'reference')

onMounted(() => {
  window.addEventListener('blur', handleWindowBlur)
  window.addEventListener('focus', restorePromptFocus)
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onBeforeUnmount(() => {
  window.removeEventListener('blur', handleWindowBlur)
  window.removeEventListener('focus', restorePromptFocus)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  if (promptFocusFrame !== undefined) window.cancelAnimationFrame(promptFocusFrame)
})

watch(
  () => props.activeMenuOwner,
  (owner) => {
    if (owner?.startsWith('composer:')) {
      return
    }

    openPanel.value = ''
  }
)

watch(
  () => props.prompt,
  (nextPrompt) => {
    if (expandedPresetContent.value !== null && nextPrompt !== expandedPresetContent.value) {
      expandedPresetContent.value = null
    }
  }
)
</script>

<template>
  <section
    class="composer"
    :class="{ 'is-reference-dragging': referenceDragActive }"
    aria-label="生成输入"
    tabindex="0"
    @dragenter="handleDragOver"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
    @paste="handlePaste"
  >
    <input
      v-if="!photoshopIntegrationAvailable"
      ref="browserUploadInput"
      data-browser-reference-input
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      hidden
      @change="handleBrowserUploadChange"
    />
    <p v-if="referenceImportError" class="reference-import-error" role="alert">{{ referenceImportError }}</p>
    <div class="reference-header">
      <span>参考图 {{ referenceCountText }}</span>
      <div class="reference-actions">
        <button v-if="hasReferences" class="clear-reference" type="button" @click="emit('clearReferences')">
          <BoxIcon name="x" size="13" />
          清空
        </button>

        <div ref="referenceMenu" class="add-wrap is-inline">
          <button
            class="add-reference-inline"
            :class="{ 'is-loading': referenceBusy }"
            type="button"
            :disabled="busy || !canAddReference"
            @click="togglePanel('reference')"
          >
            <span v-if="referenceBusy" class="inline-spinner" aria-hidden="true"></span>
            <BoxIcon v-else name="image-add" size="14" />
            <span>{{ referenceBusy ? '读取中' : '添加参考' }}</span>
          </button>

          <Transition name="menu-pop">
            <div v-if="openPanel === 'reference'" class="floating-menu reference-menu">
              <button
                v-for="action in referenceActions"
                :key="action.source"
                type="button"
                @click="addReference(action.source)"
              >
                <BoxIcon :name="action.icon" size="15" />
                {{ action.label }}
              </button>
            </div>
          </Transition>
        </div>
      </div>
    </div>

    <div v-if="hasReferences" class="reference-strip">
      <ReferenceThumb
        v-for="(reference, index) in references"
        :key="reference.id"
        :index="index + 1"
        :reference="reference"
        removable
        @remove="emit('removeReference', $event)"
        @preview="emit('preview', $event)"
      />
    </div>
    <div v-if="referenceDragActive" class="reference-drop-hint">松开添加参考图</div>

    <div class="prompt-shell">
      <PromptPresetMenu
        :disabled="busy"
        :input="prompt"
        :presets="promptPresets"
        @close="emit('menuOpen', '')"
        @open="emit('menuOpen', 'composer:preset')"
        @select="applyPromptPreset"
      />
      <textarea
        ref="promptInput"
        class="prompt-input"
        :value="prompt"
        placeholder="输入提示词，或输入 / 调用预设"
        rows="3"
        @blur="handlePromptBlur"
        @focus="handlePromptFocus"
        @input="updatePromptInput(($event.target as HTMLTextAreaElement).value)"
        @keydown="handlePromptKeydown"
      />
    </div>

    <div class="control-grid">
      <ControlSelect
        class="config-control"
        icon="key"
        label="接口"
        :options="configOptions"
        :open="openPanel === 'config'"
        :value="activeConfigId"
        wide
        @change="emit('selectConfig', $event); openPanel = ''"
        @close="closePanel"
        @toggle="togglePanel('config')"
      />
      <ControlSelect
        class="model-control"
        icon="slider-alt"
        label="模型"
        :open="openPanel === 'model'"
        :options="modelOptions"
        :value="activeModel"
        wide
        @change="handleModelChange"
        @close="closePanel"
        @toggle="togglePanel('model')"
      />
      <ControlSelect
        v-if="resolutionMode === 'preset'"
        icon="image"
        label="尺寸"
        :open="openPanel === 'size'"
        :options="sizeOptions"
        :value="size"
        @change="handleSizeChange"
        @close="closePanel"
        @toggle="togglePanel('size')"
      />
      <div v-else class="dimension-fields">
        <label class="dimension-field">
          <span>宽</span>
          <input
            inputmode="numeric"
            min="1"
            step="16"
            type="number"
            :value="customWidth"
            @input="emit('updateCustomWidth', readDimensionInput($event))"
          />
        </label>
        <span class="dimension-times">×</span>
        <label class="dimension-field">
          <span>高</span>
          <input
            inputmode="numeric"
            min="1"
            step="16"
            type="number"
            :value="customHeight"
            @input="emit('updateCustomHeight', readDimensionInput($event))"
          />
        </label>
        <button class="dimension-preset-button" type="button" @click="usePresetResolution">预设</button>
      </div>
      <RatioPicker
        v-if="resolutionMode === 'preset'"
        :open="openPanel === 'ratio'"
        :options="activeCapability.ratioOptions"
        :value="ratio"
        @change="emit('updateRatio', $event); openPanel = ''"
        @close="closePanel"
        @toggle="togglePanel('ratio')"
      />
      <ControlSelect
        icon="grid-alt"
        label="数量"
        :open="openPanel === 'count'"
        :options="countOptions"
        :value="String(count)"
        @change="emit('updateCount', Number($event)); openPanel = ''"
        @close="closePanel"
        @toggle="togglePanel('count')"
      />
      <ControlSelect
        v-if="showsQualityControl"
        icon="check-circle"
        label="质量"
        :open="openPanel === 'quality'"
        :options="qualityOptions"
        :value="quality"
        @change="emit('updateQuality', $event); openPanel = ''"
        @close="closePanel"
        @toggle="togglePanel('quality')"
      />
    </div>

    <button class="send-button" :class="{ 'is-sending': busy }" type="button" :disabled="busy || !canSend" @click="requestSend">
      <BoxIcon name="send" size="16" />
      发送
    </button>
  </section>
</template>

<style scoped>
.composer {
  position: relative;
  z-index: 5;
  display: grid;
  flex: 0 0 auto;
  gap: 9px;
  padding: 10px 12px 12px;
  border-top: 1px solid var(--mugen-hairline);
  background: var(--mugen-composer);
}

.composer.is-reference-dragging {
  background: var(--mugen-hover);
}

.reference-drop-hint {
  display: grid;
  min-height: 56px;
  place-items: center;
  border: 1px dashed var(--mugen-border-strong);
  border-radius: 8px;
  color: var(--mugen-secondary);
  font-size: 12px;
}

.reference-import-error {
  margin: 0;
  color: var(--mugen-danger);
  font-size: 11px;
}

.prompt-shell {
  position: relative;
  min-width: 0;
}

.prompt-shell .prompt-input {
  display: block;
  width: 100%;
}

.reference-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--mugen-muted);
  font-size: 11px;
}

.reference-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.clear-reference,
.add-reference-inline {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-height: 22px;
  padding: 0 6px;
  border: 0;
  background: transparent;
  color: var(--mugen-muted);
  font-size: 11px;
  white-space: nowrap;
}

.add-reference-inline {
  border-color: transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--mugen-secondary);
}

.clear-reference:hover,
.add-reference-inline:hover {
  background: var(--mugen-hover);
  color: var(--mugen-text);
}

.add-reference-inline.is-loading {
  color: var(--mugen-secondary);
}

.inline-spinner {
  width: 11px;
  height: 11px;
  border: 1.5px solid var(--mugen-border-strong);
  border-top-color: var(--mugen-accent);
  border-radius: 999px;
  animation: inline-spin 800ms linear infinite;
}

.reference-strip {
  display: flex;
  min-height: 78px;
  align-items: flex-start;
  gap: 8px;
  overflow: visible;
  padding-bottom: 2px;
}

.add-wrap {
  position: relative;
  flex: 0 0 auto;
}

.add-wrap.is-inline {
  display: inline-flex;
}

.floating-menu {
  position: absolute;
  z-index: 50;
  display: grid;
  width: 150px;
  overflow: hidden;
  border: 1px solid var(--mugen-border-strong);
  border-radius: 8px;
  background: var(--mugen-overlay);
  box-shadow: 0 12px 32px var(--mugen-shadow);
}

.reference-menu {
  bottom: calc(100% + 2px);
  left: 0;
}

.add-wrap.is-inline .reference-menu {
  right: 0;
  left: auto;
}

.floating-menu button {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  min-height: 30px;
  justify-content: flex-start;
  padding: 0 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--mugen-secondary);
  font-size: 12px;
  text-align: left;
  white-space: nowrap;
}

.floating-menu button:hover {
  background: var(--mugen-accent-soft);
  color: var(--mugen-text);
}

.menu-pop-enter-active,
.menu-pop-leave-active {
  transition:
    opacity 130ms ease,
    transform 150ms cubic-bezier(0.2, 0.8, 0.2, 1);
  transform-origin: bottom right;
}

.menu-pop-enter-from,
.menu-pop-leave-to {
  opacity: 0;
  transform: translateY(5px) scale(0.98);
}

.prompt-input {
  width: 100%;
  min-height: 54px;
  resize: none;
  border: 0;
  border-radius: 8px;
  background: var(--mugen-field);
  color: var(--mugen-text);
  font: inherit;
  font-size: 12px;
  line-height: 1.45;
  padding: 9px 10px;
}

.control-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
}

.config-control {
  grid-column: span 1;
}

.model-control {
  grid-column: span 2;
}

.dimension-fields {
  display: grid;
  grid-column: span 2;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto;
  align-items: end;
  gap: 7px;
  min-width: 0;
}

.dimension-field {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.dimension-field span,
.dimension-times {
  color: var(--mugen-muted);
  font-size: 10px;
}

.dimension-field input {
  width: 100%;
  min-width: 0;
  height: 28px;
  min-height: 28px;
  padding: 0 8px;
  border: 0;
  border-radius: 6px;
  background: var(--mugen-field);
  color: var(--mugen-text);
  font: inherit;
  font-size: 12px;
}

.dimension-field input:focus {
  outline: 1px solid var(--mugen-accent);
}

.dimension-preset-button {
  height: 28px;
  min-height: 28px;
  align-self: end;
  padding: 0 8px;
  border-color: transparent;
  background: var(--mugen-field);
  color: var(--mugen-secondary);
  font-size: 11px;
  white-space: nowrap;
}

.dimension-preset-button:hover {
  border-color: var(--mugen-accent);
  color: var(--mugen-text);
}

.send-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  border: 0;
  background: var(--mugen-accent);
  color: white;
  font-size: 13px;
  font-weight: 700;
  white-space: nowrap;
  transition:
    background-color 160ms ease,
    opacity 160ms ease,
    transform 120ms ease;
}

.send-button:not(:disabled):active {
  transform: translateY(1px) scale(0.992);
}

.send-button.is-sending :deep(.box-icon) {
  animation: send-icon-lift 520ms ease both;
}

@keyframes send-icon-lift {
  0% {
    opacity: 0.72;
    transform: translate(-1px, 1px) scale(0.94);
  }

  55% {
    opacity: 1;
    transform: translate(3px, -3px) scale(1.08);
  }

  100% {
    opacity: 1;
    transform: translate(0, 0) scale(1);
  }
}

@keyframes inline-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .menu-pop-enter-active,
  .menu-pop-leave-active,
  .send-button {
    transition: none;
  }

  .send-button.is-sending :deep(.box-icon),
  .inline-spinner {
    animation: none;
  }
}
</style>

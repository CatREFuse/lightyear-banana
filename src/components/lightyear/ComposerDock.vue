<script setup lang="ts">
import { computed, shallowRef, useTemplateRef, watch } from 'vue'
import type { CanvasOperationState, ModelConfig, ReferenceImage, ReferenceSource, ResolutionInputMode } from '../../types/lightyear'
import type { ProviderCapability } from '../../types/lightyear'
import { useOutsidePointerDown } from '../../composables/useOutsidePointerDown'
import { providerRequiresApiKey, providerSupportsQuality, readProviderCapability } from '../../data/providerCapabilities'
import BoxIcon from './BoxIcon.vue'
import type { BoxIconName } from './boxIcons'
import ControlSelect from './ControlSelect.vue'
import RatioPicker from './RatioPicker.vue'
import ReferenceThumb from './ReferenceThumb.vue'

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
  quality: string
  ratio: string
  references: ReferenceImage[]
  resolutionMode: ResolutionInputMode
  size: string
}>()

const manageModelsValue = '__lightyear_manage_models__'

const emit = defineEmits<{
  addReference: [source: ReferenceSource]
  clearReferences: []
  manageModels: []
  menuOpen: [owner: string]
  preview: [image: ReferenceImage['image']]
  removeReference: [id: string]
  selectConfig: [id: string]
  selectModel: [model: string]
  send: []
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
const referenceMenuRef = useTemplateRef<HTMLElement>('referenceMenu')
const customSizeValue = '__lightyear_custom_resolution__'

const referenceActions: Array<{ icon: BoxIconName; source: ReferenceSource; label: string }> = [
  { icon: 'image', source: 'visible', label: '可见图层' },
  { icon: 'selection', source: 'selection', label: '选区' },
  { icon: 'layer', source: 'layer', label: '当前选中图层' },
  { icon: 'upload', source: 'upload', label: '上传文件' },
  { icon: 'clipboard', source: 'clipboard', label: '剪贴板' }
]

const referenceCountText = computed(() => `${props.references.length} / ${props.activeCapability.referenceLimit}`)
const hasReferences = computed(() => props.references.length > 0)
const referenceBusy = computed(() => props.canvasOperation.type === 'capture')
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
  emit('addReference', source)
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

  const capability = readProviderCapability(config)
  if (providerRequiresApiKey(config.provider) && !config.apiKey.trim()) {
    return { label: '缺少 Key', tone: 'warning' }
  }

  if (capability.supportsBaseUrl && !config.baseUrl.trim()) {
    return { label: '缺少 URL', tone: 'warning' }
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

function handlePromptKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) {
    return
  }

  event.preventDefault()
  if (props.busy || !props.canSend) {
    return
  }

  closePanel()
  emit('send')
}

useOutsidePointerDown(referenceMenuRef, closePanel, () => openPanel.value === 'reference')

watch(
  () => props.activeMenuOwner,
  (owner) => {
    if (owner?.startsWith('composer:')) {
      return
    }

    openPanel.value = ''
  }
)
</script>

<template>
  <section class="composer" aria-label="生成输入">
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

    <textarea
      class="prompt-input"
      :value="prompt"
      placeholder="输入提示词"
      rows="3"
      @focus="closePanel"
      @input="emit('updatePrompt', ($event.target as HTMLTextAreaElement).value)"
      @keydown="handlePromptKeydown"
    />

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

    <button class="send-button" :class="{ 'is-sending': busy }" type="button" :disabled="busy || !canSend" @click="emit('send')">
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
  border-top: 1px solid var(--lb-hairline);
  background: var(--lb-composer);
}

.reference-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--lb-muted);
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
  color: var(--lb-muted);
  font-size: 11px;
  white-space: nowrap;
}

.add-reference-inline {
  border-color: transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--lb-secondary);
}

.clear-reference:hover,
.add-reference-inline:hover {
  background: var(--lb-hover);
  color: var(--lb-text);
}

.add-reference-inline.is-loading {
  color: var(--lb-secondary);
}

.inline-spinner {
  width: 11px;
  height: 11px;
  border: 1.5px solid var(--lb-border-strong);
  border-top-color: var(--lb-accent);
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
  border: 1px solid var(--lb-border-strong);
  border-radius: 8px;
  background: var(--lb-overlay);
  box-shadow: 0 12px 32px var(--lb-shadow);
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
  color: var(--lb-secondary);
  font-size: 12px;
  text-align: left;
  white-space: nowrap;
}

.floating-menu button:hover {
  background: var(--lb-accent-soft);
  color: var(--lb-text);
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
  background: var(--lb-field);
  color: var(--lb-text);
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
  color: var(--lb-muted);
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
  background: var(--lb-field);
  color: var(--lb-text);
  font: inherit;
  font-size: 12px;
}

.dimension-field input:focus {
  outline: 1px solid var(--lb-accent);
}

.dimension-preset-button {
  height: 28px;
  min-height: 28px;
  align-self: end;
  padding: 0 8px;
  border-color: transparent;
  background: var(--lb-field);
  color: var(--lb-secondary);
  font-size: 11px;
  white-space: nowrap;
}

.dimension-preset-button:hover {
  border-color: var(--lb-accent);
  color: var(--lb-text);
}

.send-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-height: 34px;
  border: 0;
  background: var(--lb-accent);
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

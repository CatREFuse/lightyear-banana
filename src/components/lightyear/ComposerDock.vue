<script setup lang="ts">
import { computed, shallowRef, useTemplateRef } from 'vue'
import type { ModelConfig, PreviewMode, ReferenceImage, ReferenceSource } from '../../types/lightyear'
import type { ProviderCapability } from '../../types/lightyear'
import { useOutsidePointerDown } from '../../composables/useOutsidePointerDown'
import ControlSelect from './ControlSelect.vue'
import RatioPicker from './RatioPicker.vue'
import ReferenceThumb from './ReferenceThumb.vue'

type SelectOption = {
  value: string
  label: string
  meta?: string
}

const props = defineProps<{
  activeCapability: ProviderCapability
  activeConfigId: string
  busy: boolean
  canAddReference: boolean
  configs: ModelConfig[]
  count: number
  prompt: string
  quality: string
  ratio: string
  references: ReferenceImage[]
  selectedPreviewMode: PreviewMode
  size: string
}>()

const emit = defineEmits<{
  addReference: [source: ReferenceSource]
  clearReferences: []
  removeReference: [id: string]
  selectConfig: [id: string]
  send: []
  updateCount: [value: number]
  updatePreviewMode: [value: PreviewMode]
  updatePrompt: [value: string]
  updateQuality: [value: string]
  updateRatio: [value: string]
  updateSize: [value: string]
}>()

const openPanel = shallowRef('')
const referenceMenuRef = useTemplateRef<HTMLElement>('referenceMenu')

const referenceActions: Array<{ source: ReferenceSource; label: string }> = [
  { source: 'visible', label: '可见图层' },
  { source: 'selection', label: '选区' },
  { source: 'layer', label: '当前选中图层' },
  { source: 'upload', label: '上传文件' },
  { source: 'clipboard', label: '剪贴板' }
]

const previewModes: Array<{ value: PreviewMode; label: string }> = [
  { value: 'reference-selection', label: '图 1 的选区' },
  { value: 'current-selection', label: '当前选区' },
  { value: 'full-canvas', label: '全图' }
]

const referenceCountText = computed(() => `${props.references.length} / ${props.activeCapability.referenceLimit}`)
const modelOptions = computed<SelectOption[]>(() =>
  props.configs.map((config) => ({
    value: config.id,
    label: config.name,
    meta: config.model
  }))
)
const sizeOptions = computed<SelectOption[]>(() =>
  props.activeCapability.sizeOptions.map((option) => ({ value: option, label: option }))
)
const qualityOptions = computed<SelectOption[]>(() =>
  props.activeCapability.qualityOptions.map((option) => ({ value: option, label: option }))
)
const countOptions = computed<SelectOption[]>(() =>
  props.activeCapability.countOptions.map((option) => ({ value: String(option), label: String(option) }))
)
const previewModeOptions = computed<SelectOption[]>(() =>
  previewModes.map((mode) => ({ value: mode.value, label: mode.label }))
)

function addReference(source: ReferenceSource) {
  openPanel.value = ''
  emit('addReference', source)
}

function togglePanel(panel: string) {
  openPanel.value = openPanel.value === panel ? '' : panel
}

function closePanel() {
  openPanel.value = ''
}

useOutsidePointerDown(referenceMenuRef, closePanel, () => openPanel.value === 'reference')
</script>

<template>
  <section class="composer" aria-label="生成输入">
    <div class="reference-header">
      <span>参考图 {{ referenceCountText }}</span>
      <button type="button" @click="emit('clearReferences')">清空</button>
    </div>

    <div class="reference-strip">
      <div ref="referenceMenu" class="add-wrap">
        <button
          class="add-reference"
          type="button"
          :disabled="busy || !canAddReference"
          @click="togglePanel('reference')"
        >
          + 添加参考
        </button>

        <div v-if="openPanel === 'reference'" class="floating-menu reference-menu">
          <button
            v-for="action in referenceActions"
            :key="action.source"
            type="button"
            @click="addReference(action.source)"
          >
            {{ action.label }}
          </button>
        </div>
      </div>

      <ReferenceThumb
        v-for="(reference, index) in references"
        :key="reference.id"
        :index="index + 1"
        :reference="reference"
        removable
        @remove="emit('removeReference', $event)"
      />
    </div>

    <textarea
      class="prompt-input"
      :value="prompt"
      rows="3"
      @input="emit('updatePrompt', ($event.target as HTMLTextAreaElement).value)"
    />

    <div class="control-grid">
      <ControlSelect
        label="模型"
        :options="modelOptions"
        :open="openPanel === 'model'"
        :value="activeConfigId"
        wide
        @change="emit('selectConfig', $event); openPanel = ''"
        @close="closePanel"
        @toggle="togglePanel('model')"
      />
      <ControlSelect
        label="尺寸"
        :open="openPanel === 'size'"
        :options="sizeOptions"
        :value="size"
        @change="emit('updateSize', $event); openPanel = ''"
        @close="closePanel"
        @toggle="togglePanel('size')"
      />
      <ControlSelect
        label="质量"
        :open="openPanel === 'quality'"
        :options="qualityOptions"
        :value="quality"
        @change="emit('updateQuality', $event); openPanel = ''"
        @close="closePanel"
        @toggle="togglePanel('quality')"
      />
      <ControlSelect
        label="数量"
        :open="openPanel === 'count'"
        :options="countOptions"
        :value="String(count)"
        @change="emit('updateCount', Number($event)); openPanel = ''"
        @close="closePanel"
        @toggle="togglePanel('count')"
      />
      <RatioPicker
        :open="openPanel === 'ratio'"
        :options="activeCapability.ratioOptions"
        :value="ratio"
        @change="emit('updateRatio', $event); openPanel = ''"
        @close="closePanel"
        @toggle="togglePanel('ratio')"
      />
      <ControlSelect
        label="预览"
        :open="openPanel === 'preview'"
        :options="previewModeOptions"
        :value="selectedPreviewMode"
        wide
        @change="emit('updatePreviewMode', $event as PreviewMode); openPanel = ''"
        @close="closePanel"
        @toggle="togglePanel('preview')"
      />
    </div>

    <button class="send-button" type="button" :disabled="busy" @click="emit('send')">发送</button>
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
  border-top: 1px solid var(--lb-border);
  background: #121418;
}

.reference-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--lb-muted);
  font-size: 11px;
}

.reference-header button {
  min-height: 22px;
  padding: 0 6px;
  border: 0;
  background: transparent;
  color: var(--lb-muted);
  font-size: 11px;
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

.add-reference {
  width: 56px;
  height: 56px;
  min-height: 56px;
  padding: 0 6px;
  border: 1px dashed var(--lb-border-strong);
  background: transparent;
  color: var(--lb-secondary);
  font-size: 11px;
  line-height: 1.25;
}

.floating-menu {
  position: absolute;
  z-index: 50;
  display: grid;
  width: 150px;
  overflow: hidden;
  border: 1px solid var(--lb-border);
  border-radius: 8px;
  background: var(--lb-surface-2);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.36);
}

.reference-menu {
  bottom: calc(100% + 2px);
  left: 0;
}

.floating-menu button {
  min-height: 30px;
  justify-content: flex-start;
  padding: 0 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--lb-secondary);
  font-size: 12px;
  text-align: left;
}

.floating-menu button:hover {
  background: var(--lb-accent-soft);
  color: var(--lb-text);
}

.prompt-input {
  width: 100%;
  min-height: 54px;
  resize: none;
  border: 1px solid var(--lb-border);
  border-radius: 8px;
  background: var(--lb-surface);
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

.send-button {
  min-height: 34px;
  border: 0;
  background: var(--lb-accent);
  color: white;
  font-size: 13px;
  font-weight: 700;
}
</style>

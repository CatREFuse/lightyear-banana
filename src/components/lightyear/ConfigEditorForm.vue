<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { normalizeComfyUiSettings } from '../../data/comfyUiDefaults'
import { providerRequiresApiKey } from '../../data/providerCapabilities'
import type {
  ComfyUiNodeMapping,
  ComfyUiNodeMappingType,
  ComfyUiSettings,
  ImageProviderId,
  ModelConfig,
  ProviderCapability,
  SettingsTestState
} from '../../types/lightyear'
import BoxIcon from './BoxIcon.vue'
import type { BoxIconName } from './boxIcons'
import ControlSelect from './ControlSelect.vue'

type SelectOption = {
  value: string
  label: string
  meta?: string
}

const props = defineProps<{
  activeConfigName?: string
  editingCapability: ProviderCapability
  providerCapabilities: Record<ImageProviderId, ProviderCapability>
  settingsDraft: ModelConfig
  settingsDraftIsNew: boolean
  settingsTestState: SettingsTestState
}>()

const emit = defineEmits<{
  delete: []
  save: []
  test: []
  toggleEnabled: [enabled: boolean]
  updateDraft: [patch: Partial<ModelConfig>]
}>()

const openField = shallowRef('')

const comfyNodeTypeOptions: SelectOption[] = [
  { value: 'prompt', label: '提示词', meta: '正向文本' },
  { value: 'negative_prompt', label: '负向词', meta: '负向文本' },
  { value: 'image', label: '参考图', meta: '上传图片' },
  { value: 'width', label: '宽度', meta: '画布宽度' },
  { value: 'height', label: '高度', meta: '画布高度' },
  { value: 'batch_size', label: '批量', meta: '出图数量' },
  { value: 'steps', label: '步数', meta: '采样步数' },
  { value: 'seed', label: 'Seed', meta: '随机种子' },
  { value: 'model', label: '模型', meta: '模型字段' },
  { value: 'custom', label: '固定值', meta: '自定义字段' }
]

const providerOptions = computed<SelectOption[]>(() =>
  Object.values(props.providerCapabilities).map((capability) => ({
    value: capability.id,
    label: capability.name,
    meta: `${capability.referenceLimit} 张参考图`
  }))
)
const modelOptions = computed<SelectOption[]>(() =>
  props.editingCapability.modelOptions.map((model) => ({ value: model, label: model }))
)
const codexImageServerGuideUrl =
  'https://github.com/CatREFuse/lightyear-banana/tree/codex/fix-api-provider-config#codex-image-server-skill'
const subtitle = computed(() => (props.settingsDraftIsNew ? '保存后可在输入区选择' : props.activeConfigName ?? '当前配置'))
const isComfyUi = computed(() => props.settingsDraft.provider === 'comfyui')
const isCodexImageServer = computed(() => props.settingsDraft.provider === 'codex-image-server')
const showApiKeyField = computed(() => props.settingsDraft.provider === 'comfyui' || providerRequiresApiKey(props.settingsDraft.provider))
const baseUrlPlaceholder = computed(() => {
  if (isComfyUi.value) {
    return 'http://127.0.0.1:8000'
  }

  if (isCodexImageServer.value) {
    return 'http://127.0.0.1:17341'
  }

  return props.editingCapability.supportsBaseUrl ? 'https://api.example.com/v1' : '官方默认'
})
const comfyUiSettings = computed(() => normalizeComfyUiSettings(props.settingsDraft.comfyUi))
const testIsRunning = computed(() => props.settingsTestState.status === 'testing')
const testButtonIcon = computed<BoxIconName>(() => {
  if (props.settingsTestState.status === 'testing') {
    return 'refresh'
  }

  if (props.settingsTestState.status === 'error') {
    return 'x'
  }

  return 'check-circle'
})
const testButtonLabel = computed(() => {
  if (props.settingsTestState.status === 'testing') {
    return '测试中'
  }

  if (props.settingsTestState.status === 'success') {
    return 'API 可用'
  }

  if (props.settingsTestState.status === 'error') {
    if (props.settingsTestState.message === '请输入 API Key') {
      return '缺少 Key'
    }

    if (props.settingsTestState.message.includes('Base URL')) {
      return '缺少 Base URL'
    }

    return 'API 不可用'
  }

  return '测试 API'
})

function toggleField(field: string) {
  openField.value = openField.value === field ? '' : field
}

function updateProvider(value: string) {
  openField.value = ''
  emit('updateDraft', { provider: value as ImageProviderId })
}

function updateComfyUiSettings(patch: Partial<ComfyUiSettings>) {
  emit('updateDraft', {
    comfyUi: {
      ...comfyUiSettings.value,
      ...patch
    }
  })
}

function updateComfyUiNode(index: number, patch: Partial<ComfyUiNodeMapping>) {
  const workflowNodes = comfyUiSettings.value.workflowNodes.map((node, nodeIndex) =>
    nodeIndex === index ? { ...node, ...patch } : node
  )
  updateComfyUiSettings({ workflowNodes })
}

function addComfyUiNode() {
  updateComfyUiSettings({
    workflowNodes: [...comfyUiSettings.value.workflowNodes, { type: 'custom', nodeIds: [], key: '', value: '' }]
  })
}

function removeComfyUiNode(index: number) {
  updateComfyUiSettings({
    workflowNodes: comfyUiSettings.value.workflowNodes.filter((_, nodeIndex) => nodeIndex !== index)
  })
}

function parseNodeIds(value: string) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}
</script>

<template>
  <section class="config-form" aria-label="配置详情">
    <div class="form-title">
      <h2>{{ settingsDraftIsNew ? '新建配置' : '配置详情' }}</h2>
      <small>{{ subtitle }}</small>
    </div>

    <label class="toggle-row">
      <span class="toggle-copy">
        <strong>配置启用</strong>
        <small>开启后可在输入区选择</small>
      </span>
      <input
        class="toggle-input"
        :checked="settingsDraft.enabled"
        type="checkbox"
        @change="emit('toggleEnabled', ($event.target as HTMLInputElement).checked)"
      />
      <span class="toggle-track" aria-hidden="true">
        <span class="toggle-thumb"></span>
      </span>
    </label>

    <div class="field-card">
      <label>
        <span class="label-heading">
          <BoxIcon name="key" size="14" />
          配置名称
        </span>
        <input
          :value="settingsDraft.name"
          type="text"
          @input="emit('updateDraft', { name: ($event.target as HTMLInputElement).value })"
        />
      </label>

      <div class="form-control">
        <ControlSelect
          direction="down"
          icon="grid-alt"
          label="供应商"
          :open="openField === 'provider'"
          :options="providerOptions"
          :value="settingsDraft.provider"
          wide
          @change="updateProvider"
          @close="openField = ''"
          @toggle="toggleField('provider')"
        />
      </div>

      <div v-if="!editingCapability.supportsBaseUrl" class="form-control">
        <ControlSelect
          direction="down"
          icon="slider-alt"
          label="模型"
          :open="openField === 'model'"
          :options="modelOptions"
          :value="settingsDraft.model"
          wide
          @change="emit('updateDraft', { model: $event }); openField = ''"
          @close="openField = ''"
          @toggle="toggleField('model')"
        />
      </div>

      <label v-else-if="!isComfyUi">
        <span class="label-heading">
          <BoxIcon name="slider-alt" size="14" />
          模型
        </span>
        <input
          :value="settingsDraft.model"
          type="text"
          placeholder="custom-image-model"
          @input="emit('updateDraft', { model: ($event.target as HTMLInputElement).value })"
        />
      </label>

      <label v-else>
        <span class="label-heading">
          <BoxIcon name="slider-alt" size="14" />
          调用方式
        </span>
        <input value="Workflow API JSON" type="text" disabled />
      </label>

      <label>
        <span class="label-heading">
          <BoxIcon name="grid-alt" size="14" />
          Base URL
        </span>
        <input
          :value="settingsDraft.baseUrl"
          type="text"
          :disabled="!editingCapability.supportsBaseUrl"
          :placeholder="baseUrlPlaceholder"
          @input="emit('updateDraft', { baseUrl: ($event.target as HTMLInputElement).value })"
        />
      </label>

      <label v-if="showApiKeyField">
        <span class="label-heading">
          <BoxIcon name="key" size="14" />
          {{ isComfyUi ? 'API Key（可选）' : 'API Key' }}
        </span>
        <input
          :value="settingsDraft.apiKey"
          type="password"
          placeholder="••••••••••••••••"
          @input="emit('updateDraft', { apiKey: ($event.target as HTMLInputElement).value })"
        />
      </label>

      <a v-if="isCodexImageServer" class="guide-link" :href="codexImageServerGuideUrl" target="_blank" rel="noreferrer">
        <BoxIcon name="copy-alt" size="14" />
        Codex Image Server 改造说明
      </a>

      <section v-if="isComfyUi" class="comfy-panel" aria-label="ComfyUI">
        <div class="comfy-heading">
          <strong>
            <BoxIcon name="grid-alt" size="14" />
            Workflow 绑定
          </strong>
          <button type="button" @click="addComfyUiNode">
            <BoxIcon name="plus" size="14" />
            添加绑定
          </button>
        </div>

        <label>
          <span class="label-heading">
            <BoxIcon name="copy-alt" size="14" />
            API Workflow JSON
          </span>
          <textarea
            :value="comfyUiSettings.workflow"
            placeholder="粘贴 ComfyUI 导出的 API JSON"
            rows="6"
            @input="updateComfyUiSettings({ workflow: ($event.target as HTMLTextAreaElement).value })"
          ></textarea>
        </label>

        <div class="comfy-node-list">
          <section
            v-for="(node, index) in comfyUiSettings.workflowNodes"
            :key="`${index}-${node.type}`"
            class="comfy-node-row"
            :class="{ 'has-custom-value': node.type === 'custom' }"
            aria-label="Workflow Node"
          >
            <ControlSelect
              direction="down"
              icon="slider-alt"
              label="类型"
              :open="openField === `comfy-type-${index}`"
              :options="comfyNodeTypeOptions"
              :value="node.type"
              @change="updateComfyUiNode(index, { type: $event as ComfyUiNodeMappingType }); openField = ''"
              @close="openField = ''"
              @toggle="toggleField(`comfy-type-${index}`)"
            />
            <label>
              <span>节点 ID</span>
              <input
                :value="node.nodeIds.join(', ')"
                type="text"
                placeholder="留空则不写入"
                @input="updateComfyUiNode(index, { nodeIds: parseNodeIds(($event.target as HTMLInputElement).value) })"
              />
            </label>
            <label>
              <span>字段</span>
              <input
                :value="node.key"
                type="text"
                placeholder="inputs 字段名"
                @input="updateComfyUiNode(index, { key: ($event.target as HTMLInputElement).value })"
              />
            </label>
            <label v-if="node.type === 'custom'">
              <span>值</span>
              <input
                :value="node.value ?? ''"
                type="text"
                placeholder="写入值"
                @input="updateComfyUiNode(index, { value: ($event.target as HTMLInputElement).value })"
              />
            </label>
            <button class="node-remove" type="button" @click="removeComfyUiNode(index)">
              <BoxIcon name="trash" size="14" />
            </button>
          </section>
        </div>

        <div class="comfy-timing-grid">
          <label>
            <span>超时（ms）</span>
            <input
              :value="comfyUiSettings.timeoutMs"
              type="number"
              min="1000"
              step="1000"
              @input="updateComfyUiSettings({ timeoutMs: Number(($event.target as HTMLInputElement).value) })"
            />
          </label>
          <label>
            <span>轮询间隔（ms）</span>
            <input
              :value="comfyUiSettings.pollIntervalMs"
              type="number"
              min="250"
              step="250"
              @input="updateComfyUiSettings({ pollIntervalMs: Number(($event.target as HTMLInputElement).value) })"
            />
          </label>
        </div>
      </section>

      <div class="capability-box">
        <div>
          <span><BoxIcon name="image-add" size="13" />参考图</span>
          <strong>{{ editingCapability.referenceLimit }} 张</strong>
        </div>
        <div>
          <span><BoxIcon name="image" size="13" />尺寸</span>
          <strong>{{ editingCapability.sizeOptions.join(' / ') }}</strong>
        </div>
        <div>
          <span><BoxIcon name="check-circle" size="13" />质量</span>
          <strong>{{ editingCapability.qualityOptions.join(' / ') }}</strong>
        </div>
        <div>
          <span><BoxIcon name="grid-alt" size="13" />数量</span>
          <strong>{{ editingCapability.countOptions.join(' / ') }}</strong>
        </div>
        <div>
          <span><BoxIcon name="crop" size="13" />比例</span>
          <strong>{{ editingCapability.ratioOptions.join(' / ') }}</strong>
        </div>
      </div>

      <div class="form-actions">
        <button
          class="test-button"
          :class="`is-${settingsTestState.status}`"
          type="button"
          :disabled="testIsRunning"
          @click="emit('test')"
        >
          <Transition name="test-button-content" mode="out-in">
            <span :key="`${settingsTestState.status}-${testButtonLabel}`" class="test-button-content">
              <BoxIcon :class="{ spinning: testIsRunning }" :name="testButtonIcon" size="15" />
              {{ testButtonLabel }}
            </span>
          </Transition>
        </button>
        <button class="primary" type="button" @click="emit('save')">
          <BoxIcon name="check-circle" size="15" />
          保存
        </button>
        <button class="danger" type="button" @click="emit('delete')">
          <BoxIcon v-if="settingsDraftIsNew" name="x" size="15" />
          <BoxIcon v-else name="trash" size="15" />
          {{ settingsDraftIsNew ? '取消' : '删除' }}
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.config-form {
  display: grid;
  gap: 10px;
}

.field-card {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--lb-border);
  border-radius: 8px;
  background: var(--lb-card);
}

.form-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: center;
  gap: 8px;
}

.form-title {
  display: grid;
  gap: 3px;
  min-width: 0;
}

h2 {
  margin: 0;
  color: var(--lb-text);
  font-size: 13px;
}

.form-title small {
  overflow: hidden;
  color: var(--lb-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 42px;
  padding: 10px;
  border: 1px solid var(--lb-border);
  border-radius: 8px;
  background: var(--lb-card);
  cursor: pointer;
}

.toggle-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.toggle-copy strong {
  overflow: hidden;
  color: var(--lb-text);
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toggle-copy small {
  overflow: hidden;
  color: var(--lb-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toggle-input {
  position: absolute;
  width: 1px;
  min-height: 1px;
  opacity: 0;
  pointer-events: none;
}

.toggle-track {
  position: relative;
  flex: 0 0 auto;
  width: 42px;
  height: 24px;
  border-radius: 999px;
  background: var(--lb-surface-2);
  cursor: pointer;
  box-shadow: inset 0 0 0 1px var(--lb-hairline);
  transition:
    background-color 160ms ease,
    box-shadow 160ms ease;
}

.toggle-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: white;
  box-shadow: 0 2px 6px var(--lb-shadow);
  transition: transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.toggle-input:checked + .toggle-track {
  background: var(--lb-accent);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.16);
}

.toggle-input:checked + .toggle-track .toggle-thumb {
  transform: translateX(18px);
}

.toggle-input:focus-visible + .toggle-track {
  box-shadow:
    0 0 0 2px var(--lb-accent-soft),
    inset 0 0 0 1px var(--lb-accent);
}

label {
  display: grid;
  gap: 5px;
}

.form-control {
  display: grid;
}

.guide-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 32px;
  padding: 0 8px;
  border-radius: 6px;
  background: var(--lb-field);
  color: var(--lb-secondary);
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
}

.guide-link:hover {
  background: var(--lb-hover);
  color: var(--lb-text);
}

label span,
.capability-box span {
  color: var(--lb-muted);
  font-size: 11px;
}

.label-heading,
.capability-box span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  white-space: nowrap;
}

input {
  width: 100%;
  min-height: 32px;
  border: 0;
  border-radius: 6px;
  background: var(--lb-field);
  color: var(--lb-text);
  font: inherit;
  font-size: 12px;
  padding: 0 8px;
}

textarea {
  width: 100%;
  min-height: 116px;
  resize: vertical;
  border: 0;
  border-radius: 6px;
  background: var(--lb-field);
  color: var(--lb-text);
  font: inherit;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 11px;
  line-height: 1.45;
  padding: 8px;
}

input:disabled {
  color: var(--lb-muted);
  opacity: 0.7;
}

.comfy-panel {
  display: grid;
  gap: 9px;
  padding: 9px;
  border-radius: 8px;
  background: var(--lb-surface);
}

.comfy-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.comfy-heading strong {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  color: var(--lb-text);
  font-size: 12px;
  font-weight: 600;
}

.comfy-heading button,
.node-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 28px;
  padding: 0 8px;
  border-color: transparent;
  background: var(--lb-field);
  font-size: 11px;
}

.comfy-node-list {
  display: grid;
  gap: 7px;
}

.comfy-node-row {
  display: grid;
  grid-template-columns: minmax(82px, 0.9fr) minmax(0, 1fr) minmax(56px, 0.7fr) auto;
  align-items: end;
  gap: 6px;
  min-width: 0;
}

.comfy-node-row.has-custom-value {
  grid-template-columns: minmax(82px, 0.9fr) minmax(0, 1fr) minmax(56px, 0.7fr) minmax(64px, 0.8fr) auto;
}

.comfy-node-row label {
  min-width: 0;
}

.comfy-node-row input {
  min-height: 28px;
  font-size: 11px;
}

.node-remove {
  width: 30px;
  padding: 0;
  color: var(--lb-danger);
}

.comfy-timing-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.capability-box {
  display: grid;
  gap: 8px;
  padding: 9px;
  border: 0;
  border-radius: 8px;
  background: var(--lb-surface);
}

.capability-box div {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  gap: 8px;
}

.capability-box strong {
  color: var(--lb-secondary);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.35;
  overflow-wrap: normal;
  word-break: normal;
}

.form-actions {
  justify-content: stretch;
}

.form-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  flex: 1 1 0;
  min-height: 28px;
  min-width: 0;
  padding: 0 6px;
  border-color: transparent;
  font-size: 12px;
  white-space: nowrap;
}

.form-actions button:disabled {
  opacity: 0.72;
}

.form-actions .test-button {
  color: var(--lb-secondary);
  transition:
    background-color 220ms ease,
    color 220ms ease,
    border-color 220ms ease,
    box-shadow 220ms ease;
}

.test-button-content {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-width: 0;
}

.test-button-content-enter-active,
.test-button-content-leave-active {
  transition:
    opacity 160ms ease,
    transform 160ms ease;
}

.test-button-content-enter-from,
.test-button-content-leave-to {
  opacity: 0;
  transform: translateY(2px);
}

.form-actions .test-button.is-testing {
  background: var(--lb-accent-soft);
  color: var(--lb-accent);
}

.form-actions .test-button.is-success {
  background: rgba(31, 156, 91, 0.14);
  color: #42d17b;
}

.form-actions .test-button.is-error {
  background: rgba(236, 81, 93, 0.14);
  color: #ff6f7e;
}

.form-actions .test-button:disabled {
  opacity: 1;
}

.form-actions .primary {
  border-color: var(--lb-accent);
  background: var(--lb-accent);
  color: white;
}

.form-actions .danger {
  border-color: transparent;
  color: var(--lb-danger);
}

.spinning {
  animation: spin 780ms linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinning {
    animation: none;
  }

  .toggle-track,
  .toggle-thumb,
  .form-actions .test-button,
  .test-button-content-enter-active,
  .test-button-content-leave-active {
    transition: none;
  }
}
</style>

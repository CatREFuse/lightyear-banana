<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { ImageProviderId, ModelConfig, ProviderCapability, SettingsTestState } from '../../types/lightyear'
import { mockApiKeyPresets } from '../../data/mockApiKeys'
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
  mockServerEnabled: boolean
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
const subtitle = computed(() => (props.settingsDraftIsNew ? '保存后可在输入区选择' : props.activeConfigName ?? '当前配置'))
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
    if (props.settingsTestState.message.includes('API Key')) {
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

      <label v-else>
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

      <label>
        <span class="label-heading">
          <BoxIcon name="grid-alt" size="14" />
          Base URL
        </span>
        <input
          :value="settingsDraft.baseUrl"
          type="text"
          :disabled="!editingCapability.supportsBaseUrl"
          :placeholder="editingCapability.supportsBaseUrl ? 'https://api.example.com/v1' : '官方默认'"
          @input="emit('updateDraft', { baseUrl: ($event.target as HTMLInputElement).value })"
        />
      </label>

      <label>
        <span class="label-heading">
          <BoxIcon name="key" size="14" />
          API Key
        </span>
        <input
          :value="settingsDraft.apiKey"
          type="password"
          placeholder="••••••••••••••••"
          :title="
            mockServerEnabled
              ? 'Mock Server 可使用 mock-good，也可使用 mock-bad-key、mock-expired、mock-permission-denied、mock-rate-limited、mock-quota-exceeded、mock-server-error、mock-timeout 测试失败路径'
              : undefined
          "
          @input="emit('updateDraft', { apiKey: ($event.target as HTMLInputElement).value })"
        />
      </label>

      <section v-if="mockServerEnabled" class="mock-key-panel" aria-label="Mock Keys">
        <span class="label-heading">
          <BoxIcon name="key" size="14" />
          Mock Keys
        </span>
        <div class="mock-key-grid">
          <button
            v-for="preset in mockApiKeyPresets"
            :key="preset.key"
            type="button"
            :title="preset.title"
            @click="emit('updateDraft', { apiKey: preset.key })"
          >
            <strong>{{ preset.key }}</strong>
            <small>{{ preset.label }}</small>
          </button>
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
          <BoxIcon :class="{ spinning: testIsRunning }" :name="testButtonIcon" size="15" />
          {{ testButtonLabel }}
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

.mock-key-panel {
  display: grid;
  gap: 6px;
}

.mock-key-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.mock-key-grid button {
  display: grid;
  min-width: 0;
  gap: 2px;
  padding: 7px 8px;
  border-color: transparent;
  background: var(--lb-field);
  text-align: left;
}

.mock-key-grid button:hover {
  background: var(--lb-hover);
}

.mock-key-grid strong,
.mock-key-grid small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mock-key-grid strong {
  color: var(--lb-text);
  font-size: 11px;
  font-weight: 600;
}

.mock-key-grid small {
  color: var(--lb-muted);
  font-size: 10px;
}

.form-control {
  display: grid;
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

input:disabled {
  color: var(--lb-muted);
  opacity: 0.7;
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
  .toggle-thumb {
    transition: none;
  }
}
</style>

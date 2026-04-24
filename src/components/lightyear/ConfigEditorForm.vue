<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { ImageProviderId, ModelConfig, ProviderCapability } from '../../types/lightyear'
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
}>()

const emit = defineEmits<{
  delete: []
  restore: []
  save: []
  test: []
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

    <label>
      <span>配置名称</span>
      <input
        :value="settingsDraft.name"
        type="text"
        @input="emit('updateDraft', { name: ($event.target as HTMLInputElement).value })"
      />
    </label>

    <div class="form-control">
      <ControlSelect
        direction="down"
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

    <div class="form-control">
      <ControlSelect
        direction="down"
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

    <label>
      <span>Base URL</span>
      <input
        :value="settingsDraft.baseUrl"
        type="text"
        :disabled="!editingCapability.supportsBaseUrl"
        :placeholder="editingCapability.supportsBaseUrl ? 'https://api.example.com/v1' : '官方默认'"
        @input="emit('updateDraft', { baseUrl: ($event.target as HTMLInputElement).value })"
      />
    </label>

    <label>
      <span>API Key</span>
      <input
        :value="settingsDraft.apiKey"
        type="password"
        placeholder="••••••••••••••••"
        @input="emit('updateDraft', { apiKey: ($event.target as HTMLInputElement).value })"
      />
    </label>

    <label class="switch-row">
      <span>启用配置</span>
      <input
        :checked="settingsDraft.enabled"
        type="checkbox"
        @change="emit('updateDraft', { enabled: ($event.target as HTMLInputElement).checked })"
      />
    </label>

    <div class="capability-box">
      <div>
        <span>参考图</span>
        <strong>{{ editingCapability.referenceLimit }} 张</strong>
      </div>
      <div>
        <span>尺寸</span>
        <strong>{{ editingCapability.sizeOptions.join(' / ') }}</strong>
      </div>
      <div>
        <span>质量</span>
        <strong>{{ editingCapability.qualityOptions.join(' / ') }}</strong>
      </div>
      <div>
        <span>数量</span>
        <strong>{{ editingCapability.countOptions.join(' / ') }}</strong>
      </div>
      <div>
        <span>比例</span>
        <strong>{{ editingCapability.ratioOptions.join(' / ') }}</strong>
      </div>
    </div>

    <div class="form-actions">
      <button type="button" @click="emit('test')">测试连接</button>
      <button type="button" @click="emit('restore')">{{ settingsDraftIsNew ? '重置' : '还原' }}</button>
      <button class="primary" type="button" @click="emit('save')">保存</button>
      <button class="danger" type="button" @click="emit('delete')">
        {{ settingsDraftIsNew ? '取消' : '删除' }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.config-form {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--lb-border);
  border-radius: 8px;
  background: var(--lb-card);
}

.form-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
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

label {
  display: grid;
  gap: 5px;
}

.form-control {
  display: grid;
}

label span,
.capability-box span {
  color: var(--lb-muted);
  font-size: 11px;
}

input {
  width: 100%;
  min-height: 32px;
  border: 1px solid var(--lb-border);
  border-radius: 6px;
  background: var(--lb-surface);
  color: var(--lb-text);
  font: inherit;
  font-size: 12px;
  padding: 0 8px;
}

input:disabled {
  color: var(--lb-muted);
  opacity: 0.7;
}

.switch-row {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.switch-row input {
  width: 18px;
  min-height: 18px;
}

.capability-box {
  display: grid;
  gap: 8px;
  padding: 9px;
  border: 1px solid var(--lb-border);
  border-radius: 8px;
  background: var(--lb-surface);
}

.capability-box div {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  gap: 8px;
}

.capability-box strong {
  overflow-wrap: anywhere;
  color: var(--lb-secondary);
  font-size: 12px;
  font-weight: 500;
}

.form-actions {
  justify-content: stretch;
}

.form-actions button {
  flex: 1 1 0;
  min-height: 28px;
  padding: 0 9px;
  font-size: 12px;
}

.form-actions .primary {
  border-color: var(--lb-accent);
  background: var(--lb-accent);
  color: white;
}

.form-actions .danger {
  border-color: #7f3b48;
  color: #ffb4c0;
}
</style>

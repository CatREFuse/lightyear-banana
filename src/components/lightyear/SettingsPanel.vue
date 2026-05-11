<script setup lang="ts">
import { computed, onUnmounted, shallowRef } from 'vue'
import { buildInfo } from '../../buildInfo'
import type {
  ImageProviderId,
  MacPermissionPane,
  ModelConfig,
  ProviderCapability,
  SettingsTestState,
  SettingsView
} from '../../types/lightyear'
import { providerRequiresApiKey } from '../../data/providerCapabilities'
import BoxIcon from './BoxIcon.vue'
import ConfigEditorForm from './ConfigEditorForm.vue'

type ConfigStatus = {
  icon: 'check-circle' | 'x'
  label: string
  tone: 'enabled' | 'disabled' | 'unavailable'
}

const props = defineProps<{
  configs: ModelConfig[]
  editingCapability: ProviderCapability
  editingConfigId: string
  macPermissionSettingsAvailable: boolean
  providerCapabilities: Record<ImageProviderId, ProviderCapability>
  settingsDraftIsNew: boolean
  settingsDraft: ModelConfig
  settingsTestState: SettingsTestState
  settingsView: SettingsView
}>()

const emit = defineEmits<{
  clearConversationData: []
  closeDetail: []
  create: []
  delete: []
  duplicate: []
  edit: [id: string]
  openMacPermissionSettings: [pane: MacPermissionPane]
  save: []
  test: []
  toggleEnabled: [enabled: boolean]
  updateDraft: [patch: Partial<ModelConfig>]
}>()

const activeConfig = computed(() => props.configs.find((config) => config.id === props.editingConfigId))
const clearConversationArmed = shallowRef(false)
let clearConversationTimer: ReturnType<typeof setTimeout> | undefined
const configRows = computed(() =>
  props.configs.map((config) => ({
    config,
    status: readConfigStatus(config)
  }))
)
const transitionName = computed(() => (props.settingsView === 'detail' ? 'settings-forward' : 'settings-back'))
const clearConversationLabel = computed(() => (clearConversationArmed.value ? '再次清空' : '清空'))

function readConfigStatus(config: ModelConfig): ConfigStatus {
  if (!config.enabled) {
    return {
      icon: 'check-circle',
      label: '未启用',
      tone: 'disabled'
    }
  }

  const capability = props.providerCapabilities[config.provider]
  const apiLooksUnavailable =
    (providerRequiresApiKey(config.provider) && !config.apiKey.trim()) ||
    (capability.supportsBaseUrl && !config.baseUrl.trim()) ||
    /fail|error/i.test(`${config.apiKey} ${config.baseUrl}`)

  if (apiLooksUnavailable) {
    return {
      icon: 'x',
      label: 'API 不可用',
      tone: 'unavailable'
    }
  }

  return {
    icon: 'check-circle',
    label: '启用',
    tone: 'enabled'
  }
}

function requestClearConversationData() {
  if (!clearConversationArmed.value) {
    clearConversationArmed.value = true
    clearConversationTimer = setTimeout(() => {
      clearConversationArmed.value = false
      clearConversationTimer = undefined
    }, 2400)
    return
  }

  if (clearConversationTimer) {
    clearTimeout(clearConversationTimer)
    clearConversationTimer = undefined
  }
  clearConversationArmed.value = false
  emit('clearConversationData')
}

onUnmounted(() => {
  if (clearConversationTimer) {
    clearTimeout(clearConversationTimer)
  }
})
</script>

<template>
  <main class="settings-panel">
    <Transition :name="transitionName" mode="out-in">
      <section v-if="settingsView === 'list'" key="list" class="settings-page" aria-label="配置列表">
        <section class="version-card" aria-label="版本信息">
          <div>
            <strong>Lightyear Banana</strong>
            <small>v{{ buildInfo.version }}</small>
          </div>
          <em>Build {{ buildInfo.buildNumber }}</em>
        </section>

        <section v-if="macPermissionSettingsAvailable" class="permission-card" aria-label="macOS 权限">
          <div class="permission-heading">
            <strong>
              <BoxIcon name="selection" size="14" />
              macOS 权限
            </strong>
            <small>允许 App 调整 Photoshop 窗口</small>
          </div>

          <div class="permission-actions">
            <button type="button" @click="emit('openMacPermissionSettings', 'accessibility')">辅助功能</button>
            <button type="button" @click="emit('openMacPermissionSettings', 'automation')">自动化</button>
            <button type="button" @click="emit('openMacPermissionSettings', 'screenCapture')">屏幕录制</button>
          </div>
        </section>

        <section class="data-card" aria-label="对话记录">
          <div>
            <strong>
              <BoxIcon name="trash" size="14" />
              对话记录
            </strong>
            <small>清除生成消息和图片记录</small>
          </div>
          <button type="button" @click="requestClearConversationData">
            {{ clearConversationLabel }}
          </button>
        </section>

        <div class="config-list">
          <div class="section-header">
            <h2>配置列表</h2>
            <button type="button" @click="emit('create')">
              <BoxIcon name="plus" size="15" />
              <span>新建配置</span>
            </button>
          </div>

          <button
            v-for="row in configRows"
            :key="row.config.id"
            class="config-row"
            :class="{ selected: row.config.id === editingConfigId }"
            type="button"
            @click="emit('edit', row.config.id)"
          >
            <BoxIcon class="config-icon" name="key" size="17" />
            <span>
              <strong>{{ row.config.name }}</strong>
              <small>
                {{ providerCapabilities[row.config.provider].name }} ·
                {{ row.config.model }}
              </small>
            </span>
            <em class="status-badge" :class="`is-${row.status.tone}`">
              <BoxIcon :name="row.status.icon" size="13" />
              {{ row.status.label }}
            </em>
            <BoxIcon class="row-arrow" name="chevron-right" size="16" />
          </button>
        </div>
      </section>

      <section v-else key="detail" class="settings-page">
        <ConfigEditorForm
          :active-config-name="activeConfig?.name"
          :editing-capability="editingCapability"
          :provider-capabilities="providerCapabilities"
          :settings-draft-is-new="settingsDraftIsNew"
          :settings-draft="settingsDraft"
          :settings-test-state="settingsTestState"
          @delete="emit('delete')"
          @duplicate="emit('duplicate')"
          @save="emit('save')"
          @test="emit('test')"
          @toggle-enabled="emit('toggleEnabled', $event)"
          @update-draft="emit('updateDraft', $event)"
        />
      </section>
    </Transition>
  </main>
</template>

<style scoped>
.settings-panel {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  background: var(--lb-workspace);
}

.settings-page {
  display: grid;
  align-content: start;
  gap: 12px;
  min-height: min-content;
  padding: 12px;
}

.settings-intro {
  margin: 0;
  color: var(--lb-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.permission-card {
  display: grid;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--lb-border);
  border-radius: 8px;
  background: var(--lb-card);
}

.version-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--lb-border);
  border-radius: 8px;
  background: var(--lb-card);
}

.version-card div {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.version-card strong,
.version-card small,
.version-card em {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.version-card strong {
  color: var(--lb-text);
  font-size: 12px;
  font-weight: 600;
}

.version-card small,
.version-card em {
  color: var(--lb-muted);
  font-size: 11px;
  font-style: normal;
}

.permission-heading {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.permission-heading strong {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  color: var(--lb-text);
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.permission-heading small {
  overflow: hidden;
  color: var(--lb-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.permission-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 7px;
}

.permission-actions button {
  min-width: 0;
  min-height: 32px;
  padding: 0 8px;
  border: 1px solid var(--lb-border);
  border-radius: 8px;
  background: var(--lb-surface-2);
  color: var(--lb-text);
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.permission-actions button:hover {
  background: var(--lb-hover);
}

.data-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--lb-border);
  border-radius: 8px;
  background: var(--lb-card);
}

.data-card div {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.data-card strong {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  color: var(--lb-text);
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.data-card small {
  overflow: hidden;
  color: var(--lb-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.data-card button {
  flex: 0 0 auto;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid var(--lb-danger-border);
  border-radius: 8px;
  background: var(--lb-danger-bg);
  color: var(--lb-danger-text);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}

.data-card button:hover {
  background: rgba(236, 81, 93, 0.18);
}

.config-list {
  display: grid;
  border: 1px solid var(--lb-border);
  border-radius: 8px;
  background: var(--lb-card);
  overflow: hidden;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px;
  box-shadow: inset 0 -1px var(--lb-hairline);
}

h2 {
  margin: 0;
  color: var(--lb-text);
  font-size: 13px;
}

.section-header button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: 0 0 auto;
  min-height: 28px;
  padding: 0 9px;
  border-color: transparent;
  font-size: 12px;
  white-space: nowrap;
}

.config-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  min-height: 52px;
  padding: 9px 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
  text-align: left;
}

.config-icon {
  color: var(--lb-muted);
}

.section-header + .config-row {
  box-shadow: none;
}

.config-row + .config-row {
  box-shadow: inset 0 1px var(--lb-hairline);
}

.config-row:hover {
  background: var(--lb-hover);
}

.config-row.selected {
  background: var(--lb-accent-soft);
}

.config-row span {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.config-row strong,
.config-row small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.config-row small {
  color: var(--lb-muted);
}

.config-row em {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  min-width: max-content;
  font-size: 11px;
  font-style: normal;
  white-space: nowrap;
}

.status-badge {
  padding: 2px 5px;
  border-radius: 999px;
}

.status-badge.is-enabled {
  background: var(--lb-success-bg);
  color: var(--lb-success);
}

.status-badge.is-disabled {
  background: rgba(143, 151, 163, 0.12);
  color: var(--lb-muted);
}

.status-badge.is-unavailable {
  background: var(--lb-danger-bg);
  color: var(--lb-danger-muted);
}

.row-arrow {
  color: var(--lb-muted);
}

.settings-forward-enter-active,
.settings-forward-leave-active,
.settings-back-enter-active,
.settings-back-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}

.settings-forward-enter-from {
  opacity: 0;
  transform: translateX(26px);
}

.settings-forward-leave-to {
  opacity: 0;
  transform: translateX(-26px);
}

.settings-back-enter-from {
  opacity: 0;
  transform: translateX(-26px);
}

.settings-back-leave-to {
  opacity: 0;
  transform: translateX(26px);
}

@media (prefers-reduced-motion: reduce) {
  .settings-forward-enter-active,
  .settings-forward-leave-active,
  .settings-back-enter-active,
  .settings-back-leave-active {
    transition: none;
  }
}
</style>

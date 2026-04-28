<script setup lang="ts">
import { computed } from 'vue'
import type {
  ImageProviderId,
  MacPermissionPane,
  MockServerConfig,
  ModelConfig,
  ProviderCapability,
  SettingsTestState,
  SettingsView
} from '../../types/lightyear'
import { mockApiKeyPresets } from '../../data/mockApiKeys'
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
  mockServer: MockServerConfig
  providerCapabilities: Record<ImageProviderId, ProviderCapability>
  settingsDraftIsNew: boolean
  settingsDraft: ModelConfig
  settingsTestState: SettingsTestState
  settingsView: SettingsView
}>()

const emit = defineEmits<{
  closeDetail: []
  create: []
  delete: []
  edit: [id: string]
  openMacPermissionSettings: [pane: MacPermissionPane]
  save: []
  test: []
  toggleEnabled: [enabled: boolean]
  updateDraft: [patch: Partial<ModelConfig>]
  updateMockServer: [patch: Partial<MockServerConfig>]
}>()

const activeConfig = computed(() => props.configs.find((config) => config.id === props.editingConfigId))
const configRows = computed(() =>
  props.configs.map((config) => ({
    config,
    status: readConfigStatus(config)
  }))
)
const transitionName = computed(() => (props.settingsView === 'detail' ? 'settings-forward' : 'settings-back'))

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
    (!props.mockServer.enabled && !config.apiKey.trim()) ||
    (capability.supportsBaseUrl && !config.baseUrl.trim() && !props.mockServer.enabled) ||
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
</script>

<template>
  <main class="settings-panel">
    <Transition :name="transitionName" mode="out-in">
      <section v-if="settingsView === 'list'" key="list" class="settings-page" aria-label="配置列表">
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

        <section class="mock-server-card" aria-label="Mock Server">
          <label class="mock-toggle">
            <span>
              <strong>
                <BoxIcon name="cog" size="14" />
                Mock Server
              </strong>
              <small>{{ mockServer.enabled ? '本地端口已启用' : '发送到真实 API' }}</small>
            </span>
            <input
              class="mock-toggle-input"
              :checked="mockServer.enabled"
              type="checkbox"
              @change="emit('updateMockServer', { enabled: ($event.target as HTMLInputElement).checked })"
            />
            <span class="mock-toggle-track" aria-hidden="true">
              <span class="mock-toggle-thumb"></span>
            </span>
          </label>

          <label v-if="mockServer.enabled" class="mock-url">
            <span>
              <BoxIcon name="key" size="14" />
              本地地址
            </span>
            <input
              :value="mockServer.baseUrl"
              type="text"
              @input="emit('updateMockServer', { baseUrl: ($event.target as HTMLInputElement).value })"
            />
          </label>

          <section v-if="mockServer.enabled" class="mock-key-summary" aria-label="Mock Keys">
            <span>
              <BoxIcon name="key" size="14" />
              Mock Keys
            </span>
            <div class="mock-key-row">
              <code v-for="preset in mockApiKeyPresets" :key="preset.key" :title="preset.title">
                {{ preset.key }}
              </code>
            </div>
          </section>
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
              <small>{{ providerCapabilities[row.config.provider].name }} · {{ row.config.model }}</small>
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
          :mock-server-enabled="mockServer.enabled"
          :settings-draft-is-new="settingsDraftIsNew"
          :settings-draft="settingsDraft"
          :settings-test-state="settingsTestState"
          @delete="emit('delete')"
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

.mock-server-card {
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--lb-border);
  border-radius: 8px;
  background: var(--lb-card);
}

.mock-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  cursor: pointer;
}

.mock-toggle span:first-child {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.mock-toggle strong {
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

.mock-toggle small {
  overflow: hidden;
  color: var(--lb-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mock-toggle-input {
  position: absolute;
  width: 1px;
  min-height: 1px;
  opacity: 0;
  pointer-events: none;
}

.mock-toggle-track {
  position: relative;
  flex: 0 0 auto;
  width: 42px;
  height: 24px;
  border-radius: 999px;
  background: var(--lb-surface-2);
  cursor: pointer;
  box-shadow: inset 0 0 0 1px var(--lb-border);
}

.mock-toggle-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 3px 8px var(--lb-shadow);
  transition: transform 160ms ease;
}

.mock-toggle-input:checked + .mock-toggle-track {
  background: var(--lb-accent);
}

.mock-toggle-input:checked + .mock-toggle-track .mock-toggle-thumb {
  transform: translateX(18px);
}

.mock-url {
  display: grid;
  gap: 5px;
}

.mock-url span,
.mock-key-summary > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--lb-muted);
  font-size: 11px;
}

.mock-url input {
  min-height: 30px;
  border: 0;
  background: var(--lb-field);
}

.mock-key-summary {
  display: grid;
  gap: 6px;
}

.mock-key-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.mock-key-row code {
  max-width: 100%;
  overflow: hidden;
  padding: 3px 6px;
  border-radius: 6px;
  background: var(--lb-field);
  color: var(--lb-secondary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  background: rgba(31, 156, 91, 0.14);
  color: #42d17b;
}

.status-badge.is-disabled {
  background: rgba(143, 151, 163, 0.12);
  color: var(--lb-muted);
}

.status-badge.is-unavailable {
  background: rgba(236, 81, 93, 0.14);
  color: #ff6f7e;
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

<script setup lang="ts">
import { computed, onUnmounted, shallowRef } from 'vue'
import type {
  DiagnosticExportState,
  ImageProviderId,
  ModelConfig,
  PromptPreset,
  ProviderCapability,
  SettingsTestState,
  SettingsView
} from '@mugen/core'
import { validateProviderConfig } from '@mugen/core'
import AppIcon from './AppIcon.vue'
import ConfigEditorForm from './ConfigEditorForm.vue'
import DiagnosticLogCard from './DiagnosticLogCard.vue'
import PromptPresetSettings from './PromptPresetSettings.vue'

type ConfigStatus = {
  icon: 'checkbox-circle-fill' | 'close-line'
  label: string
  tone: 'enabled' | 'disabled' | 'unavailable'
}

const props = defineProps<{
  configs: ModelConfig[]
  editingCapability: ProviderCapability
  editingConfigId: string
  diagnosticExportAvailable: boolean
  diagnosticExportState: DiagnosticExportState
  providerCapabilities: Record<ImageProviderId, ProviderCapability>
  promptPresets: PromptPreset[]
  settingsDraftIsNew: boolean
  settingsDraft: ModelConfig
  settingsTestState: SettingsTestState
  settingsView: SettingsView
  version: string
}>()

const emit = defineEmits<{
  clearConversationData: []
  closeDetail: []
  create: []
  delete: []
  duplicate: []
  edit: [id: string]
  downloadDiagnostics: []
  openPromptPresets: []
  save: []
  configureIMini: [apiKey: string]
  test: []
  toggleEnabled: [enabled: boolean]
  updateDraft: [patch: Partial<ModelConfig>]
  updatePromptPresets: [presets: PromptPreset[]]
}>()

const activeConfig = computed(() => props.configs.find((config) => config.id === props.editingConfigId))
const iMiniConfig = computed(() => props.configs.find((config) => config.provider === 'iMini'))
const iMiniApiKey = shallowRef('')
const clearConversationArmed = shallowRef(false)
const customApiExpanded = shallowRef(false)
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
      icon: 'checkbox-circle-fill',
      label: '未启用',
      tone: 'disabled'
    }
  }

  if (!validateProviderConfig(config).valid) {
    return {
      icon: 'close-line',
      label: 'API 不可用',
      tone: 'unavailable'
    }
  }

  return {
    icon: 'checkbox-circle-fill',
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

function submitIMiniQuickAccess() {
  const apiKey = iMiniApiKey.value.trim()
  if (!apiKey) {
    return
  }

  emit('configureIMini', apiKey)
  iMiniApiKey.value = ''
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
        <section class="settings-group" aria-labelledby="common-settings-title">
          <h2 id="common-settings-title">常用设置</h2>
          <button class="data-card settings-card-row preset-entry" type="button" @click="emit('openPromptPresets')">
            <AppIcon class="settings-row-icon" name="text-block" size="16" />
            <span class="settings-row-copy">
              <strong>常用提示词</strong>
              <small>可在提示词中使用 / 进行调用</small>
            </span>
            <AppIcon class="settings-row-arrow" name="arrow-right-s-line" size="16" />
          </button>
        </section>

        <section class="settings-group" aria-labelledby="history-settings-title">
          <h2 id="history-settings-title">对话记录</h2>
          <section class="data-card history-card" aria-label="对话记录">
            <div class="settings-card-row history-summary">
              <AppIcon class="settings-row-icon" name="list-ordered" size="16" />
              <span class="settings-row-copy">
                <strong>生成记录</strong>
                <small>保存生成消息和图片记录</small>
              </span>
            </div>
            <button class="danger-action" type="button" @click="requestClearConversationData">
              <AppIcon name="delete-bin-6-line" size="16" />
              {{ clearConversationLabel }}生成记录
            </button>
          </section>
        </section>

        <DiagnosticLogCard
          v-if="diagnosticExportAvailable"
          :state="diagnosticExportState"
          @download="emit('downloadDiagnostics')"
        />

        <section class="settings-group" aria-labelledby="api-settings-title">
          <h2 id="api-settings-title">生图 API</h2>
          <section class="api-card" aria-label="生图 API 配置">
            <section class="imini-quick-card" aria-labelledby="imini-api-key-title">
              <AppIcon class="imini-quick-icon" name="shining-fill" size="16" />
              <div class="imini-quick-body">
                <div class="imini-quick-heading">
                  <strong id="imini-api-key-title">iMini API Key</strong>
                  <span>推荐</span>
                </div>
                <p>在 iMini → 个人设置 → API 中可找到</p>
                <form class="imini-quick-form" @submit.prevent="submitIMiniQuickAccess">
                  <input
                    v-model="iMiniApiKey"
                    data-imini-quick-access
                    type="password"
                    autocomplete="new-password"
                    spellcheck="false"
                    :placeholder="iMiniConfig ? '输入新 Key 可替换' : '输入 iMini API Key'"
                    aria-label="iMini API Key"
                  />
                  <button
                    type="submit"
                    :disabled="!iMiniApiKey.trim()"
                  >
                    继续
                  </button>
                </form>
                <div class="imini-quick-footer">
                  <a href="https://imini.ai/pricing" target="_blank" rel="noopener noreferrer">
                    订阅 iMini，享受 7.9 折起折扣
                    <AppIcon name="arrow-right-s-line" size="16" />
                  </a>
                  <small v-if="iMiniConfig" class="is-success" role="status">
                    已配置
                  </small>
                </div>
              </div>
            </section>

            <button
              class="custom-api-entry settings-card-row"
              type="button"
              :aria-expanded="customApiExpanded"
              aria-controls="custom-api-configs"
              @click="customApiExpanded = !customApiExpanded"
            >
              <AppIcon class="settings-row-icon" name="code-s-fill" size="16" />
              <span class="settings-row-copy">
                <strong>自定义 API</strong>
                <small>已有 {{ configs.length }} 个</small>
              </span>
              <AppIcon
                class="settings-row-arrow custom-api-arrow"
                :class="{ 'is-expanded': customApiExpanded }"
                name="arrow-right-s-line"
                size="16"
              />
            </button>

            <div v-show="customApiExpanded" id="custom-api-configs" class="config-list">
              <div class="section-header">
                <span>接口配置</span>
                <button type="button" @click="emit('create')">
                  <AppIcon name="add-large-fill" size="15" />
                  <span>添加</span>
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
                <AppIcon class="config-icon" name="key-2-line" size="17" />
                <span>
                  <strong>{{ row.config.name }}</strong>
                  <small>
                    {{ providerCapabilities[row.config.provider].name }} ·
                    {{ row.config.model }}
                  </small>
                </span>
                <em class="status-badge" :class="`is-${row.status.tone}`">
                  {{ row.status.label }}
                </em>
                <AppIcon class="row-arrow" name="arrow-right-s-line" size="16" />
              </button>
            </div>
          </section>
        </section>

        <footer class="settings-meta" aria-label="版本信息">
          <span>iMini PS · WebUI {{ version }}</span>
        </footer>
      </section>

      <section v-else-if="settingsView === 'presets'" key="presets" class="settings-page">
        <PromptPresetSettings
          :presets="promptPresets"
          @update:presets="emit('updatePromptPresets', $event)"
        />
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
  background: var(--mugen-workspace);
}

.settings-page {
  position: relative;
  z-index: 1;
  display: grid;
  align-content: start;
  gap: 12px;
  min-height: 100%;
  width: min(100%, 402px);
  margin: 0 auto;
  padding: 12px;
  box-sizing: border-box;
}

.settings-intro {
  margin: 0;
  color: var(--mugen-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.permission-card {
  display: grid;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--mugen-border);
  border-radius: 8px;
  background: var(--mugen-card);
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
  color: var(--mugen-text);
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.permission-heading small {
  overflow: hidden;
  color: var(--mugen-muted);
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
  border: 1px solid var(--mugen-border);
  border-radius: 8px;
  background: var(--mugen-surface-2);
  color: var(--mugen-text);
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.permission-actions button:hover {
  background: var(--mugen-hover);
}

.data-card {
  display: flex;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--mugen-border);
  border-radius: 8px;
  background: var(--mugen-card);
}

.settings-card-row {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr) 16px;
  align-items: center;
  gap: 4px;
  width: 100%;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--mugen-text);
  text-align: left;
}

.settings-row-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.settings-row-copy strong {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
  color: var(--mugen-text);
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-row-copy small {
  overflow: hidden;
  color: var(--mugen-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-row-icon {
  align-self: start;
  color: var(--mugen-text);
}

.settings-row-arrow {
  color: var(--mugen-muted);
}

.history-card {
  display: grid;
  gap: 16px;
}

.history-summary {
  grid-template-columns: 16px minmax(0, 1fr);
}

.history-card .danger-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  width: max-content;
  min-height: 16px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--mugen-danger-text);
  cursor: pointer;
  font-size: 12px;
  line-height: 16px;
}

.api-card {
  display: grid;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--mugen-border);
  border-radius: 16px;
  background: var(--mugen-card);
}

.imini-quick-card {
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  align-items: start;
  gap: 4px;
  min-width: 0;
}

.imini-quick-icon {
  color: var(--mugen-accent);
}

.imini-quick-body {
  display: grid;
  gap: 4px;
  width: min(100%, 304px);
  min-width: 0;
}

.imini-quick-heading {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  gap: 2px;
  color: var(--mugen-text);
}

.imini-quick-heading strong {
  min-width: 0;
  font-size: 12px;
  font-weight: 400;
  line-height: 16px;
}

.imini-quick-heading > span {
  padding: 2px 4px;
  border-radius: 4px;
  background: var(--mugen-accent-soft);
  color: var(--mugen-accent);
  font-size: 10px;
  font-weight: 400;
  line-height: 1;
}

.imini-quick-card p {
  margin: 0;
  color: var(--mugen-muted);
  font-size: 10px;
  line-height: 1;
}

.imini-quick-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px;
}

.imini-quick-form:has(button:disabled) {
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
}

.imini-quick-form input {
  min-width: 0;
  height: 35px;
  padding: 8px;
  border: 0;
  border-radius: 8px;
  background: var(--mugen-field);
  color: var(--mugen-text);
  font-family: inherit;
  font-size: 12px;
  line-height: 16px;
}

.imini-quick-form input::placeholder {
  color: var(--mugen-muted);
}

.imini-quick-form button {
  min-width: 54px;
  height: 35px;
  padding: 0 10px;
  border: 0;
  border-radius: 7px;
  background: var(--mugen-accent);
  color: var(--mugen-on-accent);
  cursor: pointer;
  font-size: 12px;
  font-weight: 650;
}

.imini-quick-form button:disabled {
  display: none;
}

.imini-quick-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}

.imini-quick-footer a {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  color: var(--mugen-accent);
  font-size: 12px;
  line-height: 16px;
  text-decoration: none;
}

.imini-quick-footer a:hover {
  color: var(--mugen-text);
}

.imini-quick-footer small {
  flex: 0 0 auto;
  font-size: 10px;
}

.imini-quick-footer small.is-success {
  color: var(--mugen-success);
}

.imini-quick-footer small.is-error {
  color: var(--mugen-danger-muted);
}

.custom-api-entry {
  min-height: 28px;
  padding: 0;
  cursor: pointer;
}

.custom-api-arrow {
  transition: transform 160ms ease;
}

.custom-api-arrow.is-expanded {
  transform: rotate(90deg);
}

.config-list {
  display: grid;
  margin: 0 -16px -16px;
  border: 0;
  border-radius: 0 0 16px 16px;
  background: transparent;
  overflow: hidden;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px;
  border-bottom: 1px solid var(--mugen-hairline);
}

h2 {
  margin: 0;
  color: var(--mugen-text);
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
  color: var(--mugen-muted);
}

.section-header + .config-row {
  border-top: 0;
}

.config-row + .config-row {
  border-top: 1px solid var(--mugen-hairline);
}

.config-row:hover {
  background: var(--mugen-hover);
}

.config-row.selected {
  background: var(--mugen-accent-soft);
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
  color: var(--mugen-muted);
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
  background: var(--mugen-success-bg);
  color: var(--mugen-success);
}

.status-badge.is-disabled {
  background: rgba(143, 151, 163, 0.12);
  color: var(--mugen-muted);
}

.status-badge.is-unavailable {
  background: var(--mugen-danger-bg);
  color: var(--mugen-danger-muted);
}

.settings-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  margin-top: auto;
  padding: 2px 2px 0;
  color: var(--mugen-muted);
  font-size: 11px;
  line-height: 1.4;
}

.settings-meta span,
.settings-meta button {
  min-width: 0;
  color: var(--mugen-muted);
  font: inherit;
  white-space: nowrap;
}

.settings-meta span.is-available {
  color: var(--mugen-success);
}

.settings-meta span.is-error {
  color: var(--mugen-danger-muted);
}

.settings-meta button {
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  cursor: pointer;
}

.settings-meta button:hover:not(:disabled) {
  color: var(--mugen-text);
}

.settings-meta button:disabled {
  cursor: default;
  opacity: 0.62;
}

.row-arrow {
  color: var(--mugen-muted);
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

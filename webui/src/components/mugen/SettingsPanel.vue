<script setup lang="ts">
import { computed, onUnmounted, shallowRef, watch } from 'vue'
import type {
  DiagnosticExportState,
  ImageProviderId,
  ModelConfig,
  PromptPreset,
  ProviderCapability,
  SettingsTestState,
  SettingsView
} from '@mugen/core'
import { MAX_HISTORY_LIMIT, MIN_HISTORY_LIMIT, normalizeHistoryLimit } from '@mugen/inner-protocol'
import AppIcon from './AppIcon.vue'
import ConfigEditorForm from './ConfigEditorForm.vue'
import CustomApiSettings from './CustomApiSettings.vue'
import DiagnosticLogCard from './DiagnosticLogCard.vue'
import PromptPresetSettings from './PromptPresetSettings.vue'

const props = defineProps<{
  configs: ModelConfig[]
  editingCapability: ProviderCapability
  editingConfigId: string
  diagnosticExportAvailable: boolean
  diagnosticExportState: DiagnosticExportState
  historyLimit: number
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
  openCustomApis: []
  save: []
  configureIMini: [apiKey: string]
  test: []
  toggleEnabled: [enabled: boolean]
  updateDraft: [patch: Partial<ModelConfig>]
  updateHistoryLimit: [value: number]
  updatePromptPresets: [presets: PromptPreset[]]
}>()

const activeConfig = computed(() => props.configs.find((config) => config.id === props.editingConfigId))
const iMiniConfig = computed(() => props.configs.find((config) => config.provider === 'iMini'))
const iMiniApiKey = shallowRef('')
const clearConversationArmed = shallowRef(false)
const transitionName = shallowRef('settings-forward')
let clearConversationTimer: ReturnType<typeof setTimeout> | undefined
const clearConversationLabel = computed(() => (clearConversationArmed.value ? '再次清空' : '清空'))

const settingsDepth: Record<SettingsView, number> = {
  list: 0,
  apis: 1,
  presets: 1,
  detail: 2
}

watch(
  () => props.settingsView,
  (nextView, previousView) => {
    transitionName.value = settingsDepth[nextView] > settingsDepth[previousView]
      ? 'settings-forward'
      : 'settings-back'
  }
)

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

function adjustHistoryLimit(delta: number) {
  emit('updateHistoryLimit', normalizeHistoryLimit(props.historyLimit + delta))
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
                <strong>生成记录保存条数</strong>
                <small>超过设定上限的生成记录会被删除</small>
              </span>
              <span class="history-stepper" role="group" aria-label="生成记录保存条数">
                <button
                  class="history-stepper-button is-decrease"
                  type="button"
                  aria-label="减少生成记录保存条数"
                  :disabled="historyLimit <= MIN_HISTORY_LIMIT"
                  @click="adjustHistoryLimit(-1)"
                >
                  <AppIcon name="arrow-right-s-line" size="24" />
                </button>
                <output class="history-stepper-value" aria-live="polite">{{ historyLimit }}</output>
                <button
                  class="history-stepper-button"
                  type="button"
                  aria-label="增加生成记录保存条数"
                  :disabled="historyLimit >= MAX_HISTORY_LIMIT"
                  @click="adjustHistoryLimit(1)"
                >
                  <AppIcon name="arrow-right-s-line" size="24" />
                </button>
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
              @click="emit('openCustomApis')"
            >
              <AppIcon class="settings-row-icon" name="code-s-fill" size="16" />
              <span class="settings-row-copy">
                <strong>自定义 API</strong>
                <small>已有 {{ configs.length }} 个</small>
              </span>
              <AppIcon class="settings-row-arrow" name="arrow-right-s-line" size="16" />
            </button>
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

      <section v-else-if="settingsView === 'apis'" key="apis" class="settings-page">
        <CustomApiSettings
          :configs="configs"
          :editing-config-id="editingConfigId"
          :provider-capabilities="providerCapabilities"
          @create="emit('create')"
          @edit="emit('edit', $event)"
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
  margin-top: 1px;
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
  grid-template-columns: 16px minmax(0, 1fr) 72px;
  min-height: 32px;
}

.history-stepper {
  display: inline-flex;
  height: 32px;
  align-items: center;
  justify-content: end;
  gap: 3px;
  overflow: hidden;
}

.history-stepper .history-stepper-button {
  display: inline-flex;
  width: 24px;
  height: 24px;
  min-height: 24px;
  max-height: 24px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--mugen-muted);
  cursor: pointer;
}

.history-stepper .history-stepper-button:hover,
.history-stepper .history-stepper-button:focus-visible {
  color: var(--mugen-text);
  outline: none;
}

.history-stepper .history-stepper-button:disabled {
  color: var(--mugen-border-strong);
  cursor: default;
}

.history-stepper-button.is-decrease {
  transform: rotate(180deg);
}

.history-stepper-value {
  display: inline-flex;
  width: 18px;
  height: 24px;
  align-items: center;
  justify-content: center;
  border-radius: 2px;
  background: var(--mugen-field);
  color: var(--mugen-text);
  font-size: 12px;
  line-height: 16px;
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

h2 {
  margin: 0;
  color: var(--mugen-text);
  font-size: 13px;
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

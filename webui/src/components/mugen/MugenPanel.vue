<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import type { MugenController } from '../../types/mugenController'
import { useThemePreferences, type ThemePreferencesController } from '../../composables/useThemePreferences'
import type { DesktopPlatform, RuntimeName } from '@mugen/core'
import type { CapturedCanvasImage } from '@mugen/core'
import ComposerDock from './ComposerDock.vue'
import BoxIcon from './BoxIcon.vue'
import MessageThread from './MessageThread.vue'
import PanelHeader from './PanelHeader.vue'
import SettingsPanel from './SettingsPanel.vue'

const props = defineProps<{
  runtime: RuntimeName
  desktopPlatform: DesktopPlatform
  showWindowControls?: boolean
  controller: MugenController
  version: string
  diagnosticExportAvailable?: boolean
  photoshopIntegrationAvailable?: boolean
  themeController?: ThemePreferencesController
}>()

const localThemeController = props.themeController ? undefined : useThemePreferences()
const {
  activeCapability,
  activeConfigId,
  activeView,
  appendGeneration,
  busy,
  canvasOperation,
  canAddReference,
  canSend,
  cancelGeneration,
  clearConversationData,
  clearReferences,
  closeSettingsDetail,
  closeSettings,
  connectionStatus,
  configs,
  count,
  createConfig,
  customHeight,
  customWidth,
  deleteConfig,
  diagnosticExportState,
  duplicateConfig,
  editConfig,
  editGenerationRequest,
  exportDiagnostics,
  editingCapability,
  editingConfigId,
  enabledConfigs,
  generationLoading,
  installPluginUrl,
  openPromptPresets,
  openSettings,
  placeImage,
  prompt,
  promptPresets,
  providerCapabilities,
  quality,
  ratio,
  references,
  removeReference,
  retryGeneration,
  resolutionMode,
  saveConfig,
  saveGeneratedImage,
  selectConfig,
  selectModel,
  sendPrompt,
  settingsDraft,
  settingsDraftIsNew,
  settingsTestState,
  settingsView,
  size,
  testConfig,
  toastMessage,
  turns,
  addReference,
  importReferenceImage,
  toggleConfigEnabled,
  upscaleImage,
  updateSettingsDraft,
  updatePromptPresets,
  upgradeGeneratedThumbnail,
  useResultAsReference
} = props.controller

const {
  colorMode,
  resolvedColorMode,
  setColorMode,
  setVisualTheme,
  visualTheme
} = props.themeController ?? localThemeController!
const activeWorkspaceMenu = shallowRef('')
const previewImage = shallowRef<CapturedCanvasImage | null>(null)
const previewLoading = shallowRef(false)
const previewError = shallowRef('')
let previewRequest = 0
const photoshopIntegrationAvailable = computed(() => (
  props.photoshopIntegrationAvailable ?? props.runtime !== 'browser'
))
const previewDialogStyle = computed(() => {
  const image = previewImage.value
  if (!image) {
    return {}
  }

  const width = Math.max(1, Math.round(image.width))
  const height = Math.max(1, Math.round(image.height))
  const ratio = width / height

  return {
    '--preview-aspect': `${width} / ${height}`,
    '--preview-width': ratio >= 1
      ? 'min(calc(100vw - 28px), 900px)'
      : `min(calc(100vw - 28px), calc((100vh - 96px) * ${ratio.toFixed(5)}))`
  }
})
const activeVersion = computed(() => props.version)
const navigationTitle = computed(() => {
  if (activeView.value !== 'settings') {
    return `无幻 v${activeVersion.value}`
  }

  if (settingsView.value === 'list') {
    return '设置'
  }

  if (settingsView.value === 'presets') {
    return '预设提示词'
  }

  if (settingsDraftIsNew.value) {
    return '新建配置'
  }

  return settingsDraft.name || '配置详情'
})

function setWorkspaceMenu(owner: string) {
  activeWorkspaceMenu.value = owner
}

async function openPreview(image: CapturedCanvasImage) {
  const request = ++previewRequest
  activeWorkspaceMenu.value = ''
  previewImage.value = image
  previewError.value = ''
  if (!props.controller.loadOriginalImage) return
  previewLoading.value = true
  try {
    const loaded = await props.controller.loadOriginalImage(image)
    if (request === previewRequest) previewImage.value = loaded
  } catch (reason) {
    if (request === previewRequest) previewError.value = reason instanceof Error ? reason.message : '原图无法载入'
  } finally {
    if (request === previewRequest) previewLoading.value = false
  }
}

function closePreview() {
  previewRequest += 1
  previewImage.value = null
  previewError.value = ''
  previewLoading.value = false
}

function readPreviewFileName(image: CapturedCanvasImage) {
  const cleanLabel = image.label
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim() || 'mugen-image'

  return `${cleanLabel}-${image.width}x${image.height}.png`
}

async function downloadPreviewImage() {
  const image = previewImage.value
  if (!image) {
    return
  }

  if (props.runtime === 'photoshop-ccx') {
    await saveGeneratedImage(image)
    return
  }

  const link = document.createElement('a')
  link.href = image.previewUrl
  link.download = readPreviewFileName(image)
  link.rel = 'noopener'
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function handleHeaderBack() {
  activeWorkspaceMenu.value = ''
  if (activeView.value === 'settings' && settingsView.value !== 'list') {
    closeSettingsDetail()
    return
  }

  closeSettings()
}

function handleOpenSettings() {
  activeWorkspaceMenu.value = ''
  openSettings()
}

function handleManageModels() {
  activeWorkspaceMenu.value = ''
  openSettings()
  editConfig(activeConfigId.value)
}
</script>

<template>
  <main
    class="mugen-shell"
    :class="[
      `theme-${resolvedColorMode}`,
      `design-${visualTheme}`,
      `mode-${resolvedColorMode}`
    ]"
  >
    <PanelHeader
      :active-menu-owner="activeWorkspaceMenu"
      :in-settings="activeView === 'settings'"
      :install-plugin-url="installPluginUrl"
      :status="connectionStatus"
      :titlebar-inset="props.showWindowControls"
      :desktop-platform="props.desktopPlatform"
      :show-window-controls="props.showWindowControls"
      :color-mode="colorMode"
      :resolved-color-mode="resolvedColorMode"
      :visual-theme="visualTheme"
      :title="navigationTitle"
      @back="handleHeaderBack"
      @menu-open="setWorkspaceMenu"
      @open-settings="handleOpenSettings"
      @set-color-mode="setColorMode"
      @set-visual-theme="setVisualTheme"
    />

    <div class="route-shell" :class="{ 'is-settings-active': activeView === 'settings' }">
      <SettingsPanel
        class="route-page settings-route"
        :class="{ 'is-active': activeView === 'settings' }"
        :aria-hidden="activeView !== 'settings'"
        :inert="activeView !== 'settings' || undefined"
        :configs="configs"
        :editing-capability="editingCapability"
        :editing-config-id="editingConfigId"
        :diagnostic-export-available="props.diagnosticExportAvailable ?? false"
        :diagnostic-export-state="diagnosticExportState"
        :provider-capabilities="providerCapabilities"
        :prompt-presets="promptPresets"
        :settings-draft-is-new="settingsDraftIsNew"
        :settings-draft="settingsDraft"
        :settings-test-state="settingsTestState"
        :settings-view="settingsView"
        :version="activeVersion"
        @close-detail="closeSettingsDetail"
        @clear-conversation-data="clearConversationData"
        @create="createConfig"
        @delete="deleteConfig"
        @duplicate="duplicateConfig"
        @download-diagnostics="exportDiagnostics"
        @edit="editConfig"
        @open-prompt-presets="openPromptPresets"
        @save="saveConfig"
        @test="testConfig"
        @toggle-enabled="toggleConfigEnabled"
        @update-draft="updateSettingsDraft"
        @update-prompt-presets="updatePromptPresets"
      />

      <section
        class="route-page workspace-route"
        :class="{ 'is-active': activeView === 'workspace' }"
        :aria-hidden="activeView !== 'workspace'"
        :inert="activeView !== 'workspace' || undefined"
        aria-label="生成工作区"
      >
        <MessageThread
          :active-menu-owner="activeWorkspaceMenu"
          :canvas-operation="canvasOperation"
          :loading="generationLoading"
          :photoshop-integration-available="photoshopIntegrationAvailable"
          :turns="turns"
          @append="appendGeneration"
          @cancel="cancelGeneration"
          @edit="editGenerationRequest"
          @menu-open="setWorkspaceMenu"
          @place="placeImage"
          @preview="openPreview"
          @reference="useResultAsReference"
          @retry="retryGeneration"
          @save="saveGeneratedImage"
          @thumbnail-low-resolution="upgradeGeneratedThumbnail?.($event)"
          @upscale="upscaleImage"
        />

        <div v-if="toastMessage" class="operation-status" aria-live="polite" role="status">
          <span>[STATUS]</span>
          <strong>{{ toastMessage }}</strong>
        </div>

        <ComposerDock
          :active-menu-owner="activeWorkspaceMenu"
          :active-capability="activeCapability"
          :active-config-id="activeConfigId"
          :busy="busy"
          :canvas-operation="canvasOperation"
          :can-add-reference="canAddReference"
          :can-send="canSend"
          :configs="enabledConfigs"
          :count="count"
          :custom-height="customHeight"
          :custom-width="customWidth"
          :prompt="prompt"
          :prompt-presets="promptPresets"
          :photoshop-integration-available="photoshopIntegrationAvailable"
          :quality="quality"
          :ratio="ratio"
          :references="references"
          :resolution-mode="resolutionMode"
          :size="size"
          @add-reference="addReference"
          @import-reference="importReferenceImage"
          @clear-references="clearReferences"
          @manage-models="handleManageModels"
          @menu-open="setWorkspaceMenu"
          @preview="openPreview"
          @remove-reference="removeReference"
          @select-config="selectConfig"
          @select-model="selectModel"
          @send="sendPrompt"
          @update-count="count = $event"
          @update-prompt="prompt = $event"
          @update-quality="quality = $event"
          @update-ratio="ratio = $event"
          @update-resolution-mode="resolutionMode = $event"
          @update-size="size = $event"
          @update-custom-height="customHeight = $event"
          @update-custom-width="customWidth = $event"
        />

        <Transition name="preview-fade">
          <section v-if="previewImage" class="preview-window" aria-label="图片预览" @click="closePreview">
            <div class="preview-dialog" :style="previewDialogStyle" role="dialog" aria-modal="true" @click.stop>
              <header class="preview-header">
                <span>{{ previewImage.label }} · {{ previewImage.width }} × {{ previewImage.height }}</span>
                <div class="preview-actions">
                  <button v-if="props.runtime === 'browser'" type="button" @click="downloadPreviewImage">下载</button>
                  <button v-else type="button" @click="downloadPreviewImage">下载</button>
                  <button type="button" aria-label="关闭预览" @click="closePreview">
                    <BoxIcon name="x" size="16" />
                  </button>
                </div>
              </header>
              <div class="preview-media">
                <p v-if="previewLoading" class="preview-state" role="status">正在载入原图</p>
                <p v-else-if="previewError" class="preview-state is-error" role="alert">{{ previewError }}</p>
                <img v-else :src="previewImage.previewUrl" :alt="previewImage.label" @error="previewError = '原图无法显示'" />
              </div>
            </div>
          </section>
        </Transition>
      </section>
    </div>
  </main>
</template>

<style scoped>
.mugen-shell {
  --mugen-accent: #2f8cff;
  --mugen-accent-soft: rgba(47, 140, 255, 0.14);
  --mugen-danger: #ffb4c0;
  --mugen-danger-bg: rgba(236, 81, 93, 0.11);
  --mugen-danger-border: rgba(255, 111, 126, 0.32);
  --mugen-danger-muted: #ff9aa8;
  --mugen-danger-text: #ffd7dc;
  --mugen-success: #43d17a;
  --mugen-success-bg: rgba(31, 156, 91, 0.14);
  --mugen-success-ring: rgba(67, 209, 122, 0.16);
  --mugen-warning: #ffbd2e;
  --mugen-warning-ring: rgba(255, 189, 46, 0.16);
  --mugen-neutral-ring: rgba(116, 128, 147, 0.13);
  position: relative;
  display: flex;
  width: 100%;
  min-width: 260px;
  height: 100%;
  min-height: 100%;
  flex-direction: column;
  overflow: hidden;
  background: var(--mugen-bg);
  color: var(--mugen-text);
}

.operation-status {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  min-height: 28px;
  padding: 4px 12px;
  border-top: 1px solid var(--mugen-hairline);
  background: var(--mugen-composer);
  color: var(--mugen-secondary);
  font-size: 11px;
}

.operation-status > span {
  color: var(--mugen-muted);
}

.operation-status > strong {
  overflow: hidden;
  color: var(--mugen-text);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toast-anchor {
  position: relative;
  z-index: 80;
  display: flex;
  height: 0;
  justify-content: center;
  pointer-events: none;
}

.toast {
  position: absolute;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: calc(100% - 24px);
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--mugen-border-strong);
  border-radius: 8px;
  background: var(--mugen-overlay);
  color: var(--mugen-text);
  box-shadow: 0 12px 32px var(--mugen-shadow);
  font-size: 12px;
  white-space: nowrap;
}

.toast :deep(.box-icon) {
  color: var(--mugen-accent);
}

.toast-pop-enter-active,
.toast-pop-leave-active {
  transition:
    opacity 170ms ease,
    transform 170ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.toast-pop-enter-from,
.toast-pop-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.98);
}

.preview-window {
  position: absolute;
  inset: 0;
  z-index: 120;
  display: grid;
  place-items: center;
  padding: 14px;
  background: rgba(5, 8, 12, 0.72);
}

.preview-dialog {
  display: grid;
  grid-template-rows: auto auto;
  width: var(--preview-width, min(100%, 720px));
  max-width: calc(100vw - 28px);
  max-height: calc(100vh - 28px);
  overflow: hidden;
  border: 1px solid var(--mugen-border-strong);
  border-radius: 10px;
  background: var(--mugen-overlay);
  box-shadow: 0 20px 54px var(--mugen-shadow);
}

.preview-header {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 10px 8px;
  border-bottom: 1px solid var(--mugen-hairline);
  color: var(--mugen-secondary);
  font-size: 12px;
}

.preview-header span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-actions {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
}

.preview-header button {
  display: inline-flex;
  height: 26px;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--mugen-muted);
  font-size: 12px;
}

.preview-header button:hover {
  background: var(--mugen-hover);
  color: var(--mugen-text);
}

.preview-media {
  display: grid;
  width: 100%;
  max-height: calc(100vh - 84px);
  aspect-ratio: var(--preview-aspect, 1 / 1);
  place-items: center;
  overflow: hidden;
  background: var(--mugen-thread-image-bg);
}

.preview-state {
  display: grid;
  min-height: 240px;
  place-content: center;
  margin: 0;
  padding: 24px;
  color: var(--mugen-secondary);
  text-align: center;
}

.preview-state.is-error {
  color: var(--mugen-danger-text);
}

.preview-media img {
  width: 100%;
  height: 100%;
  min-height: 0;
  object-fit: contain;
}

.preview-fade-enter-active,
.preview-fade-leave-active {
  transition: opacity 140ms ease;
}

.preview-fade-enter-from,
.preview-fade-leave-to {
  opacity: 0;
}

.mugen-shell,
.route-shell,
.route-page,
.workspace-route,
.mugen-shell :deep(.panel-header),
.mugen-shell :deep(.thread),
.mugen-shell :deep(.composer),
.mugen-shell :deep(.icon-button),
.mugen-shell :deep(.empty-state),
.mugen-shell :deep(.user-message p),
.mugen-shell :deep(.select-button),
.mugen-shell :deep(.result-card),
.mugen-shell :deep(.result-actions),
.mugen-shell :deep(.result-actions button),
.mugen-shell :deep(.add-reference-inline),
.mugen-shell :deep(.clear-reference),
.mugen-shell :deep(.prompt-input),
.mugen-shell :deep(.select-trigger),
.mugen-shell :deep(.ratio-trigger) {
  transition:
    background-color 180ms ease,
    border-color 180ms ease,
    box-shadow 180ms ease,
    color 180ms ease;
}

.mugen-shell.theme-dark {
  color-scheme: dark;
  --mugen-bg: #1a2028;
  --mugen-workspace: #151b23;
  --mugen-thread-bg: #0d1218;
  --mugen-thread-surface: #202733;
  --mugen-thread-surface-2: #252d39;
  --mugen-thread-card: #1b222c;
  --mugen-thread-card-deep: #171e27;
  --mugen-thread-image-bg: #111720;
  --mugen-composer: #171e27;
  --mugen-surface: #242b36;
  --mugen-surface-2: #2c3440;
  --mugen-field: #1e2630;
  --mugen-card: #202733;
  --mugen-card-deep: #1b222c;
  --mugen-overlay: #242b36;
  --mugen-border: rgba(168, 179, 196, 0.15);
  --mugen-border-strong: rgba(180, 190, 205, 0.24);
  --mugen-hairline: rgba(168, 179, 196, 0.12);
  --mugen-hover: rgba(255, 255, 255, 0.045);
  --mugen-text: #f3f4f6;
  --mugen-secondary: #aeb5c2;
  --mugen-muted: #7e8795;
  --mugen-empty-bg: rgba(255, 255, 255, 0.045);
  --mugen-shadow: rgba(0, 0, 0, 0.38);
}

.mugen-shell.theme-light {
  color-scheme: light;
  --mugen-bg: #ffffff;
  --mugen-workspace: #f6f6f4;
  --mugen-thread-bg: #eef0f3;
  --mugen-thread-surface: #ffffff;
  --mugen-thread-surface-2: #ffffff;
  --mugen-thread-card: #ffffff;
  --mugen-thread-card-deep: #ffffff;
  --mugen-thread-image-bg: #e8ebf0;
  --mugen-composer: #ffffff;
  --mugen-surface: #f4f4f2;
  --mugen-surface-2: #ececea;
  --mugen-field: #f7f7f5;
  --mugen-card: #ffffff;
  --mugen-card-deep: #f5f5f3;
  --mugen-overlay: #ffffff;
  --mugen-border: rgba(48, 43, 35, 0.12);
  --mugen-border-strong: rgba(48, 43, 35, 0.2);
  --mugen-hairline: rgba(48, 43, 35, 0.1);
  --mugen-hover: rgba(48, 43, 35, 0.055);
  --mugen-text: #22211e;
  --mugen-secondary: #5d5a53;
  --mugen-muted: #8a857c;
  --mugen-empty-bg: rgba(48, 43, 35, 0.055);
  --mugen-shadow: rgba(67, 57, 39, 0.18);
  --mugen-accent-soft: rgba(47, 140, 255, 0.13);
  --mugen-danger: #a63b4a;
  --mugen-danger-bg: #fff0f2;
  --mugen-danger-border: rgba(185, 48, 65, 0.3);
  --mugen-danger-muted: #b33446;
  --mugen-danger-text: #7f1d2d;
  --mugen-success: #1b7f4d;
  --mugen-success-bg: rgba(27, 127, 77, 0.12);
  --mugen-success-ring: rgba(27, 127, 77, 0.16);
  --mugen-warning: #936300;
  --mugen-warning-ring: rgba(147, 99, 0, 0.16);
  --mugen-neutral-ring: rgba(99, 95, 88, 0.14);
}

.route-shell {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  background: var(--mugen-workspace);
}

.route-page {
  position: absolute;
  inset: 0;
  z-index: 1;
  min-width: 0;
  opacity: 0;
  pointer-events: none;
  transform: translateX(22px);
  transition:
    opacity 190ms ease,
    transform 210ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.route-page.is-active {
  z-index: 2;
  opacity: 1;
  pointer-events: auto;
  transform: translateX(0);
}

.workspace-route {
  transform: translateX(0);
}

.route-shell.is-settings-active .workspace-route {
  transform: translateX(-22px);
}

.route-shell:not(.is-settings-active) .settings-route {
  transform: translateX(22px);
}

.workspace-route {
  display: flex;
  min-height: 0;
  flex-direction: column;
  background: var(--mugen-workspace);
}

@media (prefers-reduced-motion: reduce) {
  .mugen-shell,
  .route-shell,
  .route-page,
  .workspace-route,
  .mugen-shell :deep(.panel-header),
  .mugen-shell :deep(.thread),
  .mugen-shell :deep(.composer),
  .mugen-shell :deep(.icon-button),
  .mugen-shell :deep(.empty-state),
  .mugen-shell :deep(.user-message p),
  .mugen-shell :deep(.select-button),
  .mugen-shell :deep(.result-card),
  .mugen-shell :deep(.result-actions),
  .mugen-shell :deep(.result-actions button),
  .mugen-shell :deep(.add-reference-inline),
  .mugen-shell :deep(.clear-reference),
  .mugen-shell :deep(.prompt-input),
  .mugen-shell :deep(.select-trigger),
  .mugen-shell :deep(.ratio-trigger) {
    transition: none;
  }

}
</style>

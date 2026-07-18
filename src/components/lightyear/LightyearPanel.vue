<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { buildInfo } from '../../buildInfo'
import { useLightyearBanana } from '../../composables/useLightyearBanana'
import { hasElectronBridge, openElectronPreviewImage } from '../../services/electronBridge'
import type { DesktopPlatform, RuntimeName } from '../../types/lightyear'
import type { CapturedCanvasImage } from '../../uxp/canvasPrimitives'
import ComposerDock from './ComposerDock.vue'
import BoxIcon from './BoxIcon.vue'
import MessageThread from './MessageThread.vue'
import PanelHeader from './PanelHeader.vue'
import SettingsPanel from './SettingsPanel.vue'

const props = defineProps<{
  runtime: RuntimeName
  desktopPlatform: DesktopPlatform
  showWindowControls?: boolean
}>()

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
  deployWindows,
  diagnosticExportState,
  crxLogExportState,
  duplicateConfig,
  editConfig,
  editGenerationRequest,
  exportDiagnostics,
  exportCrxLogs,
  editingCapability,
  editingConfigId,
  enabledConfigs,
  generationLoading,
  installPluginUrl,
  appUpdateState,
  checkForUpdates,
  openMacPermissionSettings,
  openSettings,
  placeImage,
  prompt,
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
  toggleConfigEnabled,
  upscaleImage,
  updateSettingsDraft,
  windowDeployState,
  useResultAsReference
} = useLightyearBanana(props.runtime)

const themeMode = shallowRef<'dark' | 'light'>('dark')
const activeWorkspaceMenu = shallowRef('')
const previewImage = shallowRef<CapturedCanvasImage | null>(null)
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
const navigationTitle = computed(() => {
  if (activeView.value !== 'settings') {
    return `Lightyear Banana v${buildInfo.version}`
  }

  if (settingsView.value === 'list') {
    return '设置'
  }

  if (settingsDraftIsNew.value) {
    return '新建配置'
  }

  return settingsDraft.name || '配置详情'
})

function toggleTheme() {
  activeWorkspaceMenu.value = ''
  themeMode.value = themeMode.value === 'dark' ? 'light' : 'dark'
}

function setWorkspaceMenu(owner: string) {
  activeWorkspaceMenu.value = owner
}

async function openPreview(image: CapturedCanvasImage) {
  activeWorkspaceMenu.value = ''
  if (props.runtime === 'electron' && hasElectronBridge()) {
    try {
      await openElectronPreviewImage(image)
      return
    } catch {
    }
  }

  previewImage.value = image
}

function closePreview() {
  previewImage.value = null
}

function readPreviewFileName(image: CapturedCanvasImage) {
  const cleanLabel = image.label
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim() || 'lightyear-image'

  return `${cleanLabel}-${image.width}x${image.height}.png`
}

function downloadPreviewImage() {
  const image = previewImage.value
  if (!image) {
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

async function savePreviewImage() {
  if (!previewImage.value) {
    return
  }

  await saveGeneratedImage(previewImage.value)
}

function handleHeaderBack() {
  activeWorkspaceMenu.value = ''
  if (activeView.value === 'settings' && settingsView.value === 'detail') {
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
  <main class="lightyear-shell" :class="`theme-${themeMode}`">
    <PanelHeader
      :active-menu-owner="activeWorkspaceMenu"
      :in-settings="activeView === 'settings'"
      :install-plugin-url="installPluginUrl"
      :status="connectionStatus"
      :titlebar-inset="props.runtime === 'electron' || props.showWindowControls"
      :desktop-platform="props.desktopPlatform"
      :show-window-controls="props.showWindowControls"
      :theme-mode="themeMode"
      :title="navigationTitle"
      :window-deploy-state="windowDeployState"
      @back="handleHeaderBack"
      @deploy-window="deployWindows"
      @menu-open="setWorkspaceMenu"
      @open-settings="handleOpenSettings"
      @toggle-theme="toggleTheme"
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
        :mac-permission-settings-available="props.runtime === 'electron' && props.desktopPlatform === 'darwin'"
        :app-update-check-available="props.runtime === 'electron'"
        :diagnostic-export-available="props.runtime === 'electron'"
        :diagnostic-export-state="diagnosticExportState"
        :crx-log-export-state="crxLogExportState"
        :provider-capabilities="providerCapabilities"
        :app-update-state="appUpdateState"
        :settings-draft-is-new="settingsDraftIsNew"
        :settings-draft="settingsDraft"
        :settings-test-state="settingsTestState"
        :settings-view="settingsView"
        @close-detail="closeSettingsDetail"
        @clear-conversation-data="clearConversationData"
        @create="createConfig"
        @delete="deleteConfig"
        @duplicate="duplicateConfig"
        @download-diagnostics="exportDiagnostics"
        @download-crx-logs="exportCrxLogs"
        @edit="editConfig"
        @open-mac-permission-settings="openMacPermissionSettings"
        @check-for-updates="checkForUpdates"
        @save="saveConfig"
        @test="testConfig"
        @toggle-enabled="toggleConfigEnabled"
        @update-draft="updateSettingsDraft"
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
          @upscale="upscaleImage"
        />

        <div class="toast-anchor" aria-live="polite">
          <Transition name="toast-pop">
            <div v-if="toastMessage" class="toast" role="status">
              <BoxIcon name="check-circle" size="15" />
              <span>{{ toastMessage }}</span>
            </div>
          </Transition>
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
          :quality="quality"
          :ratio="ratio"
          :references="references"
          :resolution-mode="resolutionMode"
          :size="size"
          @add-reference="addReference"
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
                  <button type="button" @click="downloadPreviewImage">下载</button>
                  <button type="button" @click="savePreviewImage">保存</button>
                  <button type="button" aria-label="关闭预览" @click="closePreview">
                    <BoxIcon name="x" size="16" />
                  </button>
                </div>
              </header>
              <div class="preview-media">
                <img :src="previewImage.previewUrl" :alt="previewImage.label" />
              </div>
            </div>
          </section>
        </Transition>
      </section>
    </div>
  </main>
</template>

<style scoped>
.lightyear-shell {
  --lb-accent: #2f8cff;
  --lb-accent-soft: rgba(47, 140, 255, 0.14);
  --lb-danger: #ffb4c0;
  --lb-danger-bg: rgba(236, 81, 93, 0.11);
  --lb-danger-border: rgba(255, 111, 126, 0.32);
  --lb-danger-muted: #ff9aa8;
  --lb-danger-text: #ffd7dc;
  --lb-success: #43d17a;
  --lb-success-bg: rgba(31, 156, 91, 0.14);
  --lb-success-ring: rgba(67, 209, 122, 0.16);
  --lb-warning: #ffbd2e;
  --lb-warning-ring: rgba(255, 189, 46, 0.16);
  --lb-neutral-ring: rgba(116, 128, 147, 0.13);
  position: relative;
  display: flex;
  width: 100%;
  min-width: 280px;
  height: 100%;
  min-height: 100%;
  flex-direction: column;
  overflow: hidden;
  background: var(--lb-bg);
  color: var(--lb-text);
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
  border: 1px solid var(--lb-border-strong);
  border-radius: 8px;
  background: var(--lb-overlay);
  color: var(--lb-text);
  box-shadow: 0 12px 32px var(--lb-shadow);
  font-size: 12px;
  white-space: nowrap;
}

.toast :deep(.box-icon) {
  color: var(--lb-accent);
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
  border: 1px solid var(--lb-border-strong);
  border-radius: 10px;
  background: var(--lb-overlay);
  box-shadow: 0 20px 54px var(--lb-shadow);
}

.preview-header {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 10px 8px;
  border-bottom: 1px solid var(--lb-hairline);
  color: var(--lb-secondary);
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
  color: var(--lb-muted);
  font-size: 12px;
}

.preview-header button:hover {
  background: var(--lb-hover);
  color: var(--lb-text);
}

.preview-media {
  display: grid;
  width: 100%;
  max-height: calc(100vh - 84px);
  aspect-ratio: var(--preview-aspect, 1 / 1);
  place-items: center;
  overflow: hidden;
  background: var(--lb-thread-image-bg);
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

.lightyear-shell,
.route-shell,
.route-page,
.workspace-route,
.lightyear-shell :deep(.panel-header),
.lightyear-shell :deep(.thread),
.lightyear-shell :deep(.composer),
.lightyear-shell :deep(.icon-button),
.lightyear-shell :deep(.empty-state),
.lightyear-shell :deep(.user-message p),
.lightyear-shell :deep(.select-button),
.lightyear-shell :deep(.result-card),
.lightyear-shell :deep(.result-actions),
.lightyear-shell :deep(.result-actions button),
.lightyear-shell :deep(.add-reference-inline),
.lightyear-shell :deep(.clear-reference),
.lightyear-shell :deep(.prompt-input),
.lightyear-shell :deep(.select-trigger),
.lightyear-shell :deep(.ratio-trigger) {
  transition:
    background-color 180ms ease,
    border-color 180ms ease,
    box-shadow 180ms ease,
    color 180ms ease;
}

.lightyear-shell.theme-dark {
  color-scheme: dark;
  --lb-bg: #1a2028;
  --lb-workspace: #151b23;
  --lb-thread-bg: #0d1218;
  --lb-thread-surface: #202733;
  --lb-thread-surface-2: #252d39;
  --lb-thread-card: #1b222c;
  --lb-thread-card-deep: #171e27;
  --lb-thread-image-bg: #111720;
  --lb-composer: #171e27;
  --lb-surface: #242b36;
  --lb-surface-2: #2c3440;
  --lb-field: #1e2630;
  --lb-card: #202733;
  --lb-card-deep: #1b222c;
  --lb-overlay: #242b36;
  --lb-border: rgba(168, 179, 196, 0.15);
  --lb-border-strong: rgba(180, 190, 205, 0.24);
  --lb-hairline: rgba(168, 179, 196, 0.12);
  --lb-hover: rgba(255, 255, 255, 0.045);
  --lb-text: #f3f4f6;
  --lb-secondary: #aeb5c2;
  --lb-muted: #7e8795;
  --lb-empty-bg: rgba(255, 255, 255, 0.045);
  --lb-shadow: rgba(0, 0, 0, 0.38);
}

.lightyear-shell.theme-light {
  color-scheme: light;
  --lb-bg: #ffffff;
  --lb-workspace: #f6f6f4;
  --lb-thread-bg: #eef0f3;
  --lb-thread-surface: #ffffff;
  --lb-thread-surface-2: #ffffff;
  --lb-thread-card: #ffffff;
  --lb-thread-card-deep: #ffffff;
  --lb-thread-image-bg: #e8ebf0;
  --lb-composer: #ffffff;
  --lb-surface: #f4f4f2;
  --lb-surface-2: #ececea;
  --lb-field: #f7f7f5;
  --lb-card: #ffffff;
  --lb-card-deep: #f5f5f3;
  --lb-overlay: #ffffff;
  --lb-border: rgba(48, 43, 35, 0.12);
  --lb-border-strong: rgba(48, 43, 35, 0.2);
  --lb-hairline: rgba(48, 43, 35, 0.1);
  --lb-hover: rgba(48, 43, 35, 0.055);
  --lb-text: #22211e;
  --lb-secondary: #5d5a53;
  --lb-muted: #8a857c;
  --lb-empty-bg: rgba(48, 43, 35, 0.055);
  --lb-shadow: rgba(67, 57, 39, 0.18);
  --lb-accent-soft: rgba(47, 140, 255, 0.13);
  --lb-danger: #a63b4a;
  --lb-danger-bg: #fff0f2;
  --lb-danger-border: rgba(185, 48, 65, 0.3);
  --lb-danger-muted: #b33446;
  --lb-danger-text: #7f1d2d;
  --lb-success: #1b7f4d;
  --lb-success-bg: rgba(27, 127, 77, 0.12);
  --lb-success-ring: rgba(27, 127, 77, 0.16);
  --lb-warning: #936300;
  --lb-warning-ring: rgba(147, 99, 0, 0.16);
  --lb-neutral-ring: rgba(99, 95, 88, 0.14);
}

.route-shell {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  background: var(--lb-workspace);
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
  background: var(--lb-workspace);
}

@media (prefers-reduced-motion: reduce) {
  .lightyear-shell,
  .route-shell,
  .route-page,
  .workspace-route,
  .lightyear-shell :deep(.panel-header),
  .lightyear-shell :deep(.thread),
  .lightyear-shell :deep(.composer),
  .lightyear-shell :deep(.icon-button),
  .lightyear-shell :deep(.empty-state),
  .lightyear-shell :deep(.user-message p),
  .lightyear-shell :deep(.select-button),
  .lightyear-shell :deep(.result-card),
  .lightyear-shell :deep(.result-actions),
  .lightyear-shell :deep(.result-actions button),
  .lightyear-shell :deep(.add-reference-inline),
  .lightyear-shell :deep(.clear-reference),
  .lightyear-shell :deep(.prompt-input),
  .lightyear-shell :deep(.select-trigger),
  .lightyear-shell :deep(.ratio-trigger) {
    transition: none;
  }

}
</style>

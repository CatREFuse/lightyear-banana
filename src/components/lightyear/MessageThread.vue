<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue'
import type {
  CanvasOperationState,
  ChatTurn,
  GeneratedImage,
  GenerationLoadingPhase,
  GenerationLoadingState,
  PlacementTarget
} from '../../types/lightyear'
import type { CapturedCanvasImage } from '../../uxp/canvasPrimitives'
import BoxIcon from './BoxIcon.vue'
import ReferenceThumb from './ReferenceThumb.vue'

const props = defineProps<{
  activeMenuOwner?: string
  canvasOperation: CanvasOperationState
  loading: GenerationLoadingState[]
  turns: ChatTurn[]
}>()

const emit = defineEmits<{
  append: [turnId: string]
  cancel: [taskId: string]
  edit: [turnId: string]
  menuOpen: [owner: string]
  place: [image: GeneratedImage, target: PlacementTarget]
  preview: [image: CapturedCanvasImage]
  reference: [image: GeneratedImage]
  retry: [turnId: string]
  save: [image: GeneratedImage]
  upscale: [image: GeneratedImage]
}>()

type PlacementOption = {
  icon: 'selection' | 'image' | 'crop' | 'expand-alt'
  id: string
  label: string
  triggerLabel: string
  target: PlacementTarget
}

type RequestLogOwner = {
  id: string
  requestLogs?: ChatTurn['requestLogs']
}

const threadRef = useTemplateRef<HTMLElement>('thread')
const openPlacementMenuId = shallowRef('')
const imageContextMenu = shallowRef<{ id: string; image: GeneratedImage; x: number; y: number } | null>(null)
const placementOptionIds = shallowRef<Record<string, string>>({})
const visibleRequestLogs = shallowRef<Record<string, boolean>>({})
const elapsedClickState = shallowRef<Record<string, { count: number; lastAt: number }>>({})
const renderedImageRatios = shallowRef<Record<string, string>>({})

function readResultAspectRatio(image: GeneratedImage) {
  return renderedImageRatios.value[image.id] ?? `${image.width} / ${image.height}`
}

function handleResultImageLoad(event: Event, image: GeneratedImage) {
  const element = event.currentTarget as HTMLImageElement | null
  const width = element?.naturalWidth ?? 0
  const height = element?.naturalHeight ?? 0
  if (width <= 0 || height <= 0) {
    return
  }

  renderedImageRatios.value = {
    ...renderedImageRatios.value,
    [image.id]: `${width} / ${height}`
  }
  image.width = width
  image.height = height
  image.sourceBounds = { left: 0, top: 0, right: width, bottom: height }
}

function closePlacementMenu() {
  if (openPlacementMenuId.value) {
    emit('menuOpen', '')
  }

  openPlacementMenuId.value = ''
}

function closeImageContextMenu() {
  if (imageContextMenu.value) {
    emit('menuOpen', '')
  }

  imageContextMenu.value = null
}

function closeThreadMenus() {
  closePlacementMenu()
  closeImageContextMenu()
}

function readPlacementMenuId(turnId: string, imageId: string) {
  return `${turnId}:${imageId}`
}

function togglePlacementMenu(turnId: string, imageId: string) {
  const id = readPlacementMenuId(turnId, imageId)
  if (openPlacementMenuId.value === id) {
    closePlacementMenu()
    return
  }

  openPlacementMenuId.value = id
  imageContextMenu.value = null
  emit('menuOpen', `thread:${id}`)
}

function openImageContextMenu(event: MouseEvent, image: GeneratedImage) {
  const thread = threadRef.value
  if (!thread) {
    return
  }

  const menuWidth = 148
  const menuHeight = 34
  const margin = 8
  const rect = thread.getBoundingClientRect()
  const localX = event.clientX - rect.left
  const localY = event.clientY - rect.top
  const maxX = Math.max(margin, thread.clientWidth - menuWidth - margin)
  const maxY = Math.max(margin, thread.clientHeight - menuHeight - margin)
  const x = Math.min(Math.max(margin, localX), maxX) + thread.scrollLeft
  const y = Math.min(Math.max(margin, localY), maxY) + thread.scrollTop

  openPlacementMenuId.value = ''
  imageContextMenu.value = {
    id: image.id,
    image,
    x,
    y
  }
  emit('menuOpen', `thread:image:${image.id}`)
}

function readReferenceSelectionOption(reference: ChatTurn['references'][number], index: number): PlacementOption {
  return {
    icon: 'selection',
    id: `reference-selection-${reference.id}`,
    label: `参考图片 ${index + 1} 的选区`,
    triggerLabel: index === 0 ? '首图选区' : `参考 ${index + 1} 选区`,
    target: {
      type: 'reference-selection',
      referenceId: reference.id,
      referenceIndex: index,
      bounds: reference.image.sourceBounds
    }
  }
}

function readDefaultPlacementOption(turn: ChatTurn): PlacementOption {
  const firstReference = turn.references[0]
  if (!firstReference) {
    return {
      icon: 'image',
      id: 'default',
      label: '默认置入',
      triggerLabel: '默认置入',
      target: { type: 'default' }
    }
  }

  if (firstReference.source === 'visible' || firstReference.source === 'layer') {
    return {
      icon: 'image',
      id: 'full-canvas',
      label: '全画布置入',
      triggerLabel: '全画布置入',
      target: { type: 'full-canvas' }
    }
  }

  if (firstReference.source === 'selection') {
    return readReferenceSelectionOption(firstReference, 0)
  }

  return {
    icon: 'expand-alt',
    id: 'original-size',
    label: '原尺寸置入',
    triggerLabel: '原尺寸置入',
    target: { type: 'original-size' }
  }
}

function readPlacementOptions(turn: ChatTurn): PlacementOption[] {
  const referenceOptions: PlacementOption[] = turn.references
    .map((reference, index) => ({ reference, index }))
    .filter(({ reference }) => reference.source === 'selection')
    .map(({ reference, index }) => readReferenceSelectionOption(reference, index))

  const options: PlacementOption[] = [
    readDefaultPlacementOption(turn),
    {
      icon: 'image',
      id: 'full-canvas',
      label: '全画布置入',
      triggerLabel: '全画布置入',
      target: { type: 'full-canvas' }
    },
    {
      icon: 'expand-alt',
      id: 'original-size',
      label: '原尺寸（置入）',
      triggerLabel: '原尺寸置入',
      target: { type: 'original-size' }
    },
    {
      icon: 'crop',
      id: 'current-selection',
      label: '当前选区',
      triggerLabel: '当前选区',
      target: { type: 'current-selection' }
    },
    ...referenceOptions
  ]
  const seen = new Set<string>()

  return options.filter((option) => {
    if (seen.has(option.id)) {
      return false
    }
    seen.add(option.id)
    return true
  })
}

function readActivePlacementOption(turn: ChatTurn, image: GeneratedImage) {
  const key = readPlacementMenuId(turn.id, image.id)
  const options = readPlacementOptions(turn)

  return options.find((option) => option.id === placementOptionIds.value[key]) ?? readDefaultPlacementOption(turn)
}

function selectPlacementOption(turn: ChatTurn, image: GeneratedImage, option: PlacementOption) {
  const key = readPlacementMenuId(turn.id, image.id)
  placementOptionIds.value = {
    ...placementOptionIds.value,
    [key]: option.id
  }
  closePlacementMenu()
}

function placeImage(image: GeneratedImage, target: PlacementTarget) {
  closeThreadMenus()
  emit('place', image, target)
}

function saveContextMenuImage() {
  const image = imageContextMenu.value?.image
  closeImageContextMenu()
  if (image) {
    emit('save', image)
  }
}

function isPlacingImage(image: GeneratedImage) {
  return props.canvasOperation.type === 'place' && props.canvasOperation.imageId === image.id
}

function readTurnModel(turn: ChatTurn) {
  const snapshotModel = turn.repeatRequest?.config.model.trim()
  if (snapshotModel) {
    return snapshotModel
  }

  const resultModel = turn.results.find((image) => image.modelName.trim())?.modelName.trim()
  if (resultModel) {
    return resultModel
  }

  const logModel = turn.requestLogs?.find((log) => typeof log.metadata.model === 'string')?.metadata.model

  return typeof logModel === 'string' ? logModel.trim() : ''
}

function readResponseText(turn: ChatTurn) {
  const model = readTurnModel(turn)
  if (!model || turn.responseText.includes(model)) {
    return turn.responseText
  }

  return turn.responseText.replace(/^(已生成\s+\d+\s+张)(\s*·\s*)?/, `$1 · ${model} · `)
}

function hasRequestLogs(source: RequestLogOwner) {
  return Boolean(source.requestLogs?.length)
}

function toggleRequestLogs(id: string) {
  const nextVisible = !visibleRequestLogs.value[id]
  visibleRequestLogs.value = {
    ...visibleRequestLogs.value,
    [id]: nextVisible
  }
}

function handleLogTriggerClick(id: string) {
  const now = Date.now()
  const previous = elapsedClickState.value[id]
  const count = previous && now - previous.lastAt < 1200 ? previous.count + 1 : 1
  if (count >= 3) {
    elapsedClickState.value = {
      ...elapsedClickState.value,
      [id]: { count: 0, lastAt: now }
    }
    toggleRequestLogs(id)
    return
  }

  elapsedClickState.value = {
    ...elapsedClickState.value,
    [id]: { count, lastAt: now }
  }
}

function formatLogValue(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return '-'
  }

  return String(value)
}

function readMetadataRows(turnLog: NonNullable<ChatTurn['requestLogs']>[number]) {
  return Object.entries(turnLog.metadata).map(([key, value]) => ({
    key,
    value: formatLogValue(value)
  }))
}

function readStageRows(turnLog: NonNullable<ChatTurn['requestLogs']>[number]) {
  return [
    { key: '响应头', value: formatLogSeconds(turnLog.stages.headersMs) },
    { key: '正文解析', value: formatLogSeconds(turnLog.stages.bodyParseMs) },
    { key: '总耗时', value: formatLogSeconds(turnLog.stages.totalMs) }
  ]
}

function readLoadingPhaseLabel(phase: GenerationLoadingPhase) {
  const labels: Record<GenerationLoadingPhase, string> = {
    'waiting-connection': '正在等待连接...',
    'waiting-generation': '正在等待生图...',
    downloading: '下载图片中',
    'waiting-retry': '正在等待重试...'
  }

  return labels[phase]
}

function readLoadingPhaseRows(task: GenerationLoadingState) {
  return [
    { key: '当前阶段', value: readLoadingPhaseLabel(task.phase) },
    { key: '已用时间', value: `${task.elapsedSeconds}s` },
    { key: '请求日志', value: task.requestLogs?.length ? `${task.requestLogs.length} 条` : '等待返回' }
  ]
}

function formatLogSeconds(ms: number) {
  if (!Number.isFinite(ms)) {
    return '-'
  }

  const seconds = Math.max(0, ms / 1000)
  const text = seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2)

  return `${text.replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1')}s`
}

async function scrollThreadToBottom(behavior: ScrollBehavior = 'smooth') {
  await nextTick()
  const thread = threadRef.value
  if (!thread) {
    return
  }

  thread.scrollTo({
    top: thread.scrollHeight,
    behavior
  })
}

onMounted(() => {
  void scrollThreadToBottom('auto')
  window.addEventListener('blur', closeImageContextMenu)
  window.addEventListener('scroll', closeImageContextMenu, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('blur', closeImageContextMenu)
  window.removeEventListener('scroll', closeImageContextMenu, true)
})

watch(
  [() => props.turns.length, () => props.loading.length],
  () => {
    void scrollThreadToBottom()
  }
)

watch(
  () => props.activeMenuOwner,
  (owner) => {
    if (owner?.startsWith('thread:')) {
      return
    }

    openPlacementMenuId.value = ''
    imageContextMenu.value = null
  }
)
</script>

<template>
  <section ref="thread" class="thread" aria-label="当前对话" @click="closeThreadMenus">
    <Transition name="empty-fade">
      <div v-if="turns.length === 0 && loading.length === 0" class="empty-state">
        <BoxIcon name="image" size="15" />
        <span>暂无生成结果</span>
      </div>
    </Transition>

    <TransitionGroup name="turn-list" tag="div" class="turn-list">
      <article v-for="turn in turns" :key="turn.id" class="turn">
        <section class="user-message">
          <div v-if="turn.references.length" class="sent-reference-row">
            <ReferenceThumb
              v-for="(reference, index) in turn.references"
              :key="reference.id"
              :index="index + 1"
              :reference="reference"
              size="small"
              @preview="emit('preview', $event)"
            />
          </div>
          <p>{{ turn.prompt }}</p>
        </section>

        <section
          class="assistant-message"
          :class="{ 'is-error': turn.tone === 'error', 'is-canceled': turn.tone === 'canceled' }"
        >
          <p v-if="turn.tone === 'canceled'" class="canceled-text">{{ turn.responseText }} · {{ turn.elapsedLabel }}</p>
          <template v-else>
            <div class="response-header">
              <button
                class="elapsed-trigger"
                :class="{ 'has-logs': hasRequestLogs(turn), 'is-open': visibleRequestLogs[turn.id] }"
                type="button"
                aria-label="查看请求日志"
                title="查看请求日志"
                @click.stop="handleLogTriggerClick(turn.id)"
              >
                {{ turn.elapsedLabel }}
              </button>
            </div>
            <p class="response-text">{{ readResponseText(turn) }}</p>
            <div v-if="turn.repeatRequest && (turn.results.length || turn.tone === 'error')" class="response-actions">
              <button class="append-button" type="button" @click="emit('edit', turn.id)">
                修改请求
              </button>
              <button v-if="turn.results.length" class="append-button" type="button" @click="emit('append', turn.id)">
                追加
              </button>
              <button v-else class="append-button" type="button" @click="emit('retry', turn.id)">
                重试
              </button>
            </div>
            <section v-if="visibleRequestLogs[turn.id]" class="request-log-stack" aria-label="请求日志">
              <p v-if="!turn.requestLogs?.length" class="request-log-empty">暂无请求日志</p>
              <article v-for="(requestLog, index) in turn.requestLogs" :key="requestLog.id" class="request-log-item">
                <div class="request-log-title">
                  <strong>{{ index + 1 }} · {{ requestLog.method }} · {{ requestLog.status }}</strong>
                  <small>{{ requestLog.createdAt }}</small>
                </div>
                <code>{{ requestLog.url }}</code>
                <div class="request-log-grid">
                  <div>
                    <span>元数据</span>
                    <dl>
                      <template v-for="row in readMetadataRows(requestLog)" :key="row.key">
                        <dt>{{ row.key }}</dt>
                        <dd>{{ row.value }}</dd>
                      </template>
                    </dl>
                  </div>
                  <div>
                    <span>用时</span>
                    <dl>
                      <template v-for="row in readStageRows(requestLog)" :key="row.key">
                        <dt>{{ row.key }}</dt>
                        <dd>{{ row.value }}</dd>
                      </template>
                      <dt>下载量</dt>
                      <dd>{{ requestLog.contentLength || '-' }}</dd>
                    </dl>
                  </div>
                </div>
              </article>
            </section>
          </template>
          <div v-if="turn.results.length" class="result-grid">
            <article v-for="image in turn.results" :key="image.id" class="result-card">
              <button
                class="thumbnail-button"
                type="button"
                @click="emit('preview', image)"
                @contextmenu.prevent.stop="openImageContextMenu($event, image)"
              >
                <img
                  :src="image.previewUrl"
                  :alt="image.label"
                  :style="{ aspectRatio: readResultAspectRatio(image) }"
                  @load="handleResultImageLoad($event, image)"
                />
              </button>
              <div class="result-actions">
                <div class="place-control">
                  <button
                    class="place-primary action-tooltip"
                    type="button"
                    :data-tooltip="readActivePlacementOption(turn, image).triggerLabel"
                    :disabled="isPlacingImage(image)"
                    :title="readActivePlacementOption(turn, image).triggerLabel"
                    @click="placeImage(image, readActivePlacementOption(turn, image).target)"
                  >
                    <span v-if="isPlacingImage(image)" class="action-spinner" aria-hidden="true"></span>
                    <BoxIcon v-else :name="readActivePlacementOption(turn, image).icon" size="14" />
                    <span class="place-label">{{ isPlacingImage(image) ? '置入中' : readActivePlacementOption(turn, image).triggerLabel }}</span>
                  </button>
                  <div class="place-menu-wrap">
                    <button
                      class="place-more action-tooltip"
                      type="button"
                      aria-label="切换置入方式"
                      data-tooltip="切换置入方式"
                      :disabled="isPlacingImage(image)"
                      title="切换置入方式"
                      @click.stop="togglePlacementMenu(turn.id, image.id)"
                    >
                      <BoxIcon name="chevron-down" size="16" />
                    </button>
                    <Transition name="menu-pop">
                      <div
                        v-if="openPlacementMenuId === readPlacementMenuId(turn.id, image.id)"
                        class="place-menu"
                        @click.stop
                      >
                        <button
                          v-for="option in readPlacementOptions(turn)"
                          :key="option.id"
                          type="button"
                          :class="{ selected: option.id === readActivePlacementOption(turn, image).id }"
                          @click="selectPlacementOption(turn, image, option)"
                        >
                          <BoxIcon :name="option.icon" size="14" />
                          {{ option.label }}
                        </button>
                      </div>
                    </Transition>
                  </div>
                </div>
                <button class="result-icon-action action-tooltip" type="button" aria-label="超分" data-tooltip="超分" title="超分" @click="emit('upscale', image)">
                  <BoxIcon name="zoom-in" size="15" />
                </button>
                <button class="result-icon-action action-tooltip" type="button" aria-label="添加参考" data-tooltip="添加参考" title="添加参考" @click="emit('reference', image)">
                  <BoxIcon name="image-add" size="15" />
                </button>
              </div>
            </article>
          </div>
        </section>
      </article>
    </TransitionGroup>

    <article v-for="task in loading" :key="task.id" class="turn loading-turn" aria-live="polite">
      <section class="user-message">
        <div v-if="task.references.length" class="sent-reference-row">
          <ReferenceThumb
            v-for="(reference, index) in task.references"
            :key="reference.id"
            :index="index + 1"
            :reference="reference"
            size="small"
            @preview="emit('preview', $event)"
          />
        </div>
        <p>{{ task.prompt }}</p>
      </section>

      <section class="assistant-message loading-message">
        <div class="loading-row">
          <button
            class="loading-log-trigger"
            :class="{ 'is-open': visibleRequestLogs[task.id], 'has-logs': hasRequestLogs(task) }"
            type="button"
            aria-label="查看请求日志"
            @click.stop="handleLogTriggerClick(task.id)"
          >
            <span class="loading-spinner" aria-hidden="true"></span>
          </button>
          <span>{{ readLoadingPhaseLabel(task.phase) }} {{ task.elapsedSeconds }}s</span>
          <button class="cancel-generation" type="button" @click="emit('cancel', task.id)">取消</button>
        </div>
        <section v-if="visibleRequestLogs[task.id]" class="request-log-stack loading-log-stack" aria-label="请求日志">
          <p v-if="!task.requestLogs?.length" class="request-log-empty">
            {{ readLoadingPhaseRows(task).map((row) => `${row.key}：${row.value}`).join(' · ') }}
          </p>
          <article v-for="(requestLog, index) in task.requestLogs" :key="requestLog.id" class="request-log-item">
            <div class="request-log-title">
              <strong>{{ index + 1 }} · {{ requestLog.method }} · {{ requestLog.status }}</strong>
              <small>{{ requestLog.createdAt }}</small>
            </div>
            <code>{{ requestLog.url }}</code>
            <div class="request-log-grid">
              <div>
                <span>元数据</span>
                <dl>
                  <template v-for="row in readMetadataRows(requestLog)" :key="row.key">
                    <dt>{{ row.key }}</dt>
                    <dd>{{ row.value }}</dd>
                  </template>
                </dl>
              </div>
              <div>
                <span>用时</span>
                <dl>
                  <template v-for="row in readStageRows(requestLog)" :key="row.key">
                    <dt>{{ row.key }}</dt>
                    <dd>{{ row.value }}</dd>
                  </template>
                  <dt>下载量</dt>
                  <dd>{{ requestLog.contentLength || '-' }}</dd>
                </dl>
              </div>
            </div>
          </article>
        </section>
      </section>
    </article>

    <Transition name="menu-pop">
      <div
        v-if="imageContextMenu"
        class="image-context-menu"
        :style="{ left: `${imageContextMenu.x}px`, top: `${imageContextMenu.y}px` }"
        role="menu"
        @click.stop
      >
        <button type="button" role="menuitem" @click="saveContextMenuImage">
          <BoxIcon name="download" size="14" />
          下载到本地
        </button>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.thread {
  position: relative;
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 18px;
  overflow-y: auto;
  padding: 12px 12px 16px;
  background: var(--lb-thread-bg);
  scroll-behavior: smooth;
}

.turn-list {
  display: grid;
  gap: 18px;
}

.empty-state {
  display: inline-flex;
  width: fit-content;
  max-width: 100%;
  align-items: center;
  gap: 6px;
  margin: 4px auto 0;
  padding: 5px 8px;
  border-radius: 999px;
  background: var(--lb-empty-bg);
  color: var(--lb-secondary);
  font-size: 11px;
  white-space: nowrap;
}

.turn {
  display: grid;
  gap: 12px;
}

.user-message {
  display: grid;
  max-width: 88%;
  justify-self: end;
  gap: 8px;
  justify-items: end;
}

.sent-reference-row {
  display: flex;
  max-width: 100%;
  justify-content: flex-end;
  gap: 6px;
}

.user-message p {
  margin: 0;
  padding: 9px 10px;
  border: 0;
  border-radius: 8px;
  background: var(--lb-thread-surface-2);
  color: var(--lb-text);
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.assistant-message {
  display: grid;
  gap: 8px;
}

.loading-message {
  width: fit-content;
  max-width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--lb-border);
  border-radius: 999px;
  background: var(--lb-thread-card);
  box-sizing: border-box;
}

.loading-row {
  display: inline-flex;
  height: 16px;
  align-items: center;
  gap: 6px;
  color: var(--lb-secondary);
  font-size: 12px;
  line-height: 16px;
  white-space: nowrap;
}

.cancel-generation {
  display: inline-flex;
  height: 14px;
  max-height: 14px;
  align-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--lb-muted);
  font-size: 12px;
  line-height: 16px;
  cursor: pointer;
}

.cancel-generation:hover {
  color: var(--lb-text);
}

.loading-log-trigger {
  position: relative;
  display: inline-flex;
  width: 20px;
  height: 20px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--lb-secondary);
  cursor: pointer;
}

.loading-log-trigger:hover,
.loading-log-trigger:focus-visible,
.loading-log-trigger.is-open {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
  color: var(--lb-secondary);
  outline: none;
}

.loading-log-trigger.has-logs .loading-spinner {
  border-top-color: var(--lb-success, #65d48a);
}

.loading-spinner {
  width: 12px;
  height: 12px;
  border: 1.5px solid var(--lb-border-strong);
  border-top-color: var(--lb-accent);
  border-radius: 999px;
  animation: loading-spin 800ms linear infinite;
}

.canceled-text {
  margin: 0;
  color: var(--lb-muted);
  font-size: 12px;
  line-height: 16px;
  white-space: nowrap;
}

.response-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--lb-muted);
  font-size: 11px;
}

.elapsed-trigger {
  min-height: 22px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    background 140ms ease,
    border-color 140ms ease,
    box-shadow 140ms ease,
    color 140ms ease;
}

.elapsed-trigger:focus-visible,
.elapsed-trigger.is-open {
  border-color: var(--lb-border-strong);
  background: var(--lb-surface-2);
  box-shadow: 0 0 0 3px rgba(86, 140, 255, 0.1);
  color: var(--lb-text);
  outline: none;
}

.elapsed-trigger.has-logs {
  color: var(--lb-secondary);
}

.append-button {
  min-height: 22px;
  padding: 0 7px;
  border-color: transparent;
  background: var(--lb-field);
  color: var(--lb-secondary);
  font-size: 11px;
}

.append-button:hover {
  background: var(--lb-surface-2);
  color: var(--lb-text);
}

.response-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-start;
}

.response-text {
  margin: 0;
  color: var(--lb-secondary);
  font-size: 12px;
}

.request-log-stack {
  display: grid;
  gap: 8px;
  max-width: 100%;
}

.loading-log-stack {
  width: min(560px, calc(100vw - 48px));
  margin-top: 6px;
}

.request-log-empty {
  margin: 0;
  color: var(--lb-muted);
  font-size: 11px;
  line-height: 16px;
}

.request-log-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.request-log-title strong {
  color: var(--lb-text);
  font-size: 11px;
}

.request-log-title small {
  overflow: hidden;
  color: var(--lb-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.request-log-item {
  display: grid;
  gap: 7px;
  min-width: 0;
  padding: 8px;
  border: 1px solid var(--lb-border);
  border-radius: 7px;
  background: var(--lb-surface);
}

.request-log-item code {
  overflow: hidden;
  padding: 5px 6px;
  border-radius: 6px;
  background: var(--lb-field);
  color: var(--lb-secondary);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.request-log-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.request-log-grid > div {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.request-log-grid span {
  color: var(--lb-muted);
  font-size: 10px;
}

.request-log-grid dl {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
  gap: 4px 6px;
  margin: 0;
}

.request-log-grid dt,
.request-log-grid dd {
  overflow: hidden;
  margin: 0;
  color: var(--lb-secondary);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.request-log-grid dt {
  color: var(--lb-muted);
}

.assistant-message.is-error {
  width: fit-content;
  max-width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--lb-danger-border);
  border-radius: 8px;
  background: var(--lb-danger-bg);
}

.assistant-message.is-error .response-header {
  color: var(--lb-danger-muted);
}

.assistant-message.is-error .response-text {
  color: var(--lb-danger-text);
  line-height: 1.45;
}

.result-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.result-card {
  position: relative;
  border: 1px solid var(--lb-border);
  border-radius: 8px;
  background: var(--lb-thread-card);
}

.thumbnail-button {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  border-radius: 7px 7px 0 0;
  background: var(--lb-thread-image-bg);
}

.thumbnail-button img {
  display: block;
  width: 100%;
  border-radius: 7px 7px 0 0;
  object-fit: contain;
  background: transparent;
}

.result-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 30px 30px;
  align-items: stretch;
  min-width: 0;
  border-radius: 0 0 7px 7px;
  background: var(--lb-thread-card-deep);
  overflow: visible;
}

.result-actions button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-width: 0;
  min-height: 28px;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--lb-secondary);
  font-size: 11px;
  white-space: nowrap;
  overflow: visible;
}

.place-control {
  display: flex;
  align-items: stretch;
  min-width: 0;
  overflow: visible;
}

.place-primary {
  flex: 1 1 auto;
  min-width: 0;
}

.place-primary .place-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.place-more {
  width: 28px;
  flex: 0 0 28px;
  color: var(--lb-muted);
}

.result-icon-action {
  box-shadow: inset 1px 0 var(--lb-hairline);
}

.action-tooltip::after {
  position: absolute;
  z-index: 70;
  bottom: calc(100% + 7px);
  left: 50%;
  max-width: 128px;
  padding: 4px 7px;
  border: 1px solid var(--lb-border-strong);
  border-radius: 6px;
  background: var(--lb-overlay);
  box-shadow: 0 10px 24px var(--lb-shadow);
  color: var(--lb-text);
  content: attr(data-tooltip);
  font-size: 11px;
  line-height: 1.2;
  opacity: 0;
  pointer-events: none;
  text-overflow: ellipsis;
  transform: translate(-50%, 3px);
  transition:
    opacity 120ms ease,
    transform 120ms ease;
  white-space: nowrap;
}

.action-tooltip:hover::after,
.action-tooltip:focus-visible::after {
  opacity: 1;
  transform: translate(-50%, 0);
}

.action-spinner {
  width: 11px;
  height: 11px;
  border: 1.5px solid var(--lb-border-strong);
  border-top-color: var(--lb-accent);
  border-radius: 999px;
  animation: loading-spin 800ms linear infinite;
}

.place-menu-wrap {
  position: relative;
  display: flex;
  flex: 0 0 28px;
  min-width: 0;
}

.place-menu {
  position: absolute;
  z-index: 40;
  bottom: calc(100% + 2px);
  right: 0;
  display: grid;
  width: 156px;
  overflow: hidden;
  border: 1px solid var(--lb-border-strong);
  border-radius: 8px;
  background: var(--lb-overlay);
  box-shadow: 0 12px 32px var(--lb-shadow);
  transform-origin: bottom right;
}

.place-menu button {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  justify-content: flex-start;
  gap: 7px;
  min-height: 30px;
  padding: 0 10px;
  text-align: left;
}

.place-menu button:hover,
.place-menu button.selected,
.result-actions button:hover {
  background: var(--lb-surface-2);
  color: var(--lb-text);
}

.image-context-menu {
  position: absolute;
  z-index: 90;
  display: grid;
  width: 148px;
  overflow: hidden;
  border: 1px solid var(--lb-border-strong);
  border-radius: 8px;
  background: var(--lb-overlay);
  box-shadow: 0 12px 32px var(--lb-shadow);
  transform-origin: top left;
}

.image-context-menu button {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  min-height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--lb-text);
  font-size: 12px;
  text-align: left;
  white-space: nowrap;
}

.image-context-menu button:hover {
  background: var(--lb-surface-2);
}

.menu-pop-enter-active,
.menu-pop-leave-active {
  transition:
    opacity 130ms ease,
    transform 150ms cubic-bezier(0.2, 0.8, 0.2, 1);
  transform-origin: bottom left;
}

.menu-pop-enter-from,
.menu-pop-leave-to {
  opacity: 0;
  transform: translateY(5px) scale(0.98);
}

.empty-fade-enter-active,
.empty-fade-leave-active,
.turn-list-enter-active,
.turn-list-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.empty-fade-enter-from,
.empty-fade-leave-to {
  opacity: 0;
  transform: translateY(4px) scale(0.98);
}

.turn-list-enter-from,
.turn-list-leave-to {
  opacity: 0;
  transform: translateY(14px) scale(0.985);
}

.turn-list-move {
  transition: transform 180ms ease;
}

.turn-list-enter-active .assistant-message {
  animation: assistant-message-rise 220ms ease 70ms both;
}

.turn-list-enter-active .result-card {
  animation: result-card-rise 220ms ease 120ms both;
}

@keyframes assistant-message-rise {
  from {
    opacity: 0;
    transform: translateY(8px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes result-card-rise {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.98);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@keyframes loading-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .thread {
    scroll-behavior: auto;
  }

  .menu-pop-enter-active,
  .menu-pop-leave-active,
  .empty-fade-enter-active,
  .empty-fade-leave-active,
  .turn-list-enter-active,
  .turn-list-leave-active,
  .turn-list-move {
    transition: none;
  }

  .turn-list-enter-active .assistant-message,
  .loading-spinner,
  .turn-list-enter-active .result-card {
    animation: none;
  }
}
</style>

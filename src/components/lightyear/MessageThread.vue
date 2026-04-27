<script setup lang="ts">
import { nextTick, shallowRef, useTemplateRef, watch } from 'vue'
import type { ChatTurn, GeneratedImage, GenerationLoadingState, PlacementTarget } from '../../types/lightyear'
import BoxIcon from './BoxIcon.vue'
import ReferenceThumb from './ReferenceThumb.vue'

const props = defineProps<{
  loading: GenerationLoadingState
  turns: ChatTurn[]
}>()

const emit = defineEmits<{
  place: [image: GeneratedImage, target: PlacementTarget]
  reference: [image: GeneratedImage]
  upscale: [image: GeneratedImage]
}>()

type PlacementOption = {
  icon: 'selection' | 'image' | 'crop'
  id: string
  label: string
  target: PlacementTarget
}

const threadRef = useTemplateRef<HTMLElement>('thread')
const openPlacementMenuId = shallowRef('')

function closePlacementMenu() {
  openPlacementMenuId.value = ''
}

function readPlacementMenuId(turnId: string, imageId: string) {
  return `${turnId}:${imageId}`
}

function togglePlacementMenu(turnId: string, imageId: string) {
  const id = readPlacementMenuId(turnId, imageId)
  openPlacementMenuId.value = openPlacementMenuId.value === id ? '' : id
}

function readPlacementOptions(turn: ChatTurn): PlacementOption[] {
  const referenceOptions: PlacementOption[] = turn.references
    .map((reference, index) => ({ reference, index }))
    .filter(({ reference }) => reference.source === 'selection')
    .map(({ reference, index }) => ({
      icon: 'selection',
      id: `reference-selection-${reference.id}`,
      label: `参考图片 ${index + 1} 的选区`,
      target: {
        type: 'reference-selection',
        referenceId: reference.id,
        referenceIndex: index,
        bounds: reference.image.sourceBounds
      }
    }))

  return [
    ...referenceOptions,
    {
      icon: 'image',
      id: 'full-canvas',
      label: '全画布',
      target: { type: 'full-canvas' }
    },
    {
      icon: 'crop',
      id: 'current-selection',
      label: '当前选区',
      target: { type: 'current-selection' }
    }
  ]
}

function placeImage(image: GeneratedImage, target: PlacementTarget) {
  closePlacementMenu()
  emit('place', image, target)
}

watch(
  () => [props.turns.length, props.loading.active] as const,
  async () => {
    await nextTick()
    threadRef.value?.scrollTo({
      top: threadRef.value.scrollHeight,
      behavior: 'smooth'
    })
  }
)
</script>

<template>
  <section ref="thread" class="thread" aria-label="当前对话" @click="closePlacementMenu">
    <Transition name="empty-fade">
      <div v-if="turns.length === 0 && !loading.active" class="empty-state">
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
            />
          </div>
          <p>{{ turn.prompt }}</p>
        </section>

        <section class="assistant-message">
          <div class="response-header">
            <span>{{ turn.elapsedLabel }}</span>
          </div>
          <p class="response-text">{{ turn.responseText }}</p>
          <div class="result-grid">
            <article v-for="image in turn.results" :key="image.id" class="result-card">
              <img :src="image.previewUrl" :alt="image.label" />
              <div class="result-actions">
                <div class="place-menu-wrap">
                  <button type="button" @click.stop="togglePlacementMenu(turn.id, image.id)">
                    <BoxIcon name="image" size="14" />
                    置入
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
                        @click="placeImage(image, option.target)"
                      >
                        <BoxIcon :name="option.icon" size="14" />
                        {{ option.label }}
                      </button>
                    </div>
                  </Transition>
                </div>
                <button type="button" @click="emit('upscale', image)">
                  <BoxIcon name="expand-alt" size="14" />
                  超分
                </button>
                <button type="button" @click="emit('reference', image)">
                  <BoxIcon name="copy-alt" size="14" />
                  参考
                </button>
              </div>
            </article>
          </div>
        </section>
      </article>
    </TransitionGroup>

    <article v-if="loading.active" class="turn loading-turn" aria-live="polite">
      <section class="user-message">
        <div v-if="loading.references.length" class="sent-reference-row">
          <ReferenceThumb
            v-for="(reference, index) in loading.references"
            :key="reference.id"
            :index="index + 1"
            :reference="reference"
            size="small"
          />
        </div>
        <p>{{ loading.prompt }}</p>
      </section>

      <section class="assistant-message loading-message">
        <div class="loading-row">
          <span class="loading-spinner" aria-hidden="true"></span>
          <span>正在生成中... {{ loading.elapsedSeconds }}s</span>
        </div>
      </section>
    </article>
  </section>
</template>

<style scoped>
.thread {
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
}

.assistant-message {
  display: grid;
  gap: 8px;
}

.loading-message {
  width: fit-content;
  max-width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--lb-border);
  border-radius: 999px;
  background: var(--lb-thread-card);
}

.loading-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--lb-secondary);
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
}

.loading-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--lb-border-strong);
  border-top-color: var(--lb-accent);
  border-radius: 999px;
  animation: loading-spin 800ms linear infinite;
}

.response-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  align-items: center;
  color: var(--lb-muted);
  font-size: 11px;
}

.response-text {
  margin: 0;
  color: var(--lb-secondary);
  font-size: 12px;
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

.result-card img {
  display: block;
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 7px 7px 0 0;
  object-fit: cover;
  background: var(--lb-thread-image-bg);
}

.result-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-radius: 0 0 7px 7px;
  background: var(--lb-thread-card-deep);
}

.result-actions button {
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
}

.place-menu-wrap {
  position: relative;
  display: grid;
  min-width: 0;
}

.place-menu {
  position: absolute;
  z-index: 40;
  bottom: calc(100% + 2px);
  left: 0;
  display: grid;
  width: 156px;
  overflow: hidden;
  border: 1px solid var(--lb-border-strong);
  border-radius: 8px;
  background: var(--lb-overlay);
  box-shadow: 0 12px 32px var(--lb-shadow);
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
.result-actions button:hover {
  background: var(--lb-surface-2);
  color: var(--lb-text);
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

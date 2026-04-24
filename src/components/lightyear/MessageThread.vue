<script setup lang="ts">
import type { ChatTurn, GeneratedImage, PreviewMode } from '../../types/lightyear'
import ReferenceThumb from './ReferenceThumb.vue'

defineProps<{
  turns: ChatTurn[]
}>()

const emit = defineEmits<{
  place: [image: GeneratedImage, mode: PreviewMode]
  preview: [image: GeneratedImage]
  reference: [image: GeneratedImage]
  upscale: [image: GeneratedImage]
}>()

const previewModeLabels: Record<PreviewMode, string> = {
  'reference-selection': '图 1 的选区',
  'current-selection': '当前选区',
  'full-canvas': '全图'
}
</script>

<template>
  <section class="thread" aria-label="当前对话">
    <div v-if="turns.length === 0" class="empty-state">
      <strong>开始生成</strong>
      <span>添加参考图，输入提示词后发送。</span>
    </div>

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
          <button class="select-button" type="button">{{ previewModeLabels[turn.previewMode] }}</button>
        </div>
        <p class="response-text">{{ turn.responseText }}</p>
        <div class="result-grid">
          <article v-for="image in turn.results" :key="image.id" class="result-card">
            <img :src="image.previewUrl" :alt="image.label" />
            <div class="result-actions">
              <button type="button" @click="emit('preview', image)">预览</button>
              <button type="button" @click="emit('place', image, turn.previewMode)">置入</button>
              <button type="button" @click="emit('upscale', image)">超分</button>
              <button type="button" @click="emit('reference', image)">参考</button>
            </div>
          </article>
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
}

.empty-state {
  display: grid;
  gap: 5px;
  padding: 18px;
  border: 1px dashed var(--lb-border);
  border-radius: 8px;
  color: var(--lb-secondary);
  text-align: center;
}

.empty-state strong {
  color: var(--lb-text);
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
  border: 1px solid var(--lb-border);
  border-radius: 8px;
  background: var(--lb-surface-2);
  color: var(--lb-text);
  font-size: 12px;
  line-height: 1.45;
}

.assistant-message {
  display: grid;
  gap: 8px;
}

.response-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  color: var(--lb-muted);
  font-size: 11px;
}

.select-button {
  min-height: 25px;
  padding: 0 8px;
  border-color: var(--lb-border);
  background: var(--lb-surface);
  color: var(--lb-secondary);
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
  overflow: hidden;
  border: 1px solid var(--lb-border);
  border-radius: 8px;
  background: var(--lb-card);
}

.result-card img {
  display: block;
  width: 100%;
  aspect-ratio: 1 / 1;
  object-fit: cover;
  background: #101216;
}

.result-actions {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  border-top: 1px solid var(--lb-border);
}

.result-actions button {
  min-width: 0;
  min-height: 28px;
  padding: 0;
  border: 0;
  border-right: 1px solid var(--lb-border);
  border-radius: 0;
  background: transparent;
  color: var(--lb-secondary);
  font-size: 11px;
}

.result-actions button:last-child {
  border-right: 0;
}

.result-actions button:hover {
  background: var(--lb-surface-2);
  color: var(--lb-text);
}
</style>


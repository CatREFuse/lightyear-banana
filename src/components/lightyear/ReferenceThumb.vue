<script setup lang="ts">
import type { ReferenceImage } from '../../types/lightyear'

defineProps<{
  index: number
  reference: ReferenceImage
  size?: 'small' | 'normal'
  removable?: boolean
}>()

const emit = defineEmits<{
  remove: [id: string]
}>()
</script>

<template>
  <figure class="reference-thumb" :class="[`is-${size ?? 'normal'}`]">
    <div class="image-wrap">
      <img :src="reference.image.previewUrl" :alt="reference.label" />
      <span class="badge">{{ index }}</span>
      <button v-if="removable" class="remove-button" type="button" @click="emit('remove', reference.id)">×</button>
    </div>
    <figcaption>{{ reference.label }}</figcaption>
  </figure>
</template>

<style scoped>
.reference-thumb {
  width: 56px;
  margin: 0;
  color: var(--lb-muted);
  font-size: 10px;
  text-align: center;
}

.reference-thumb.is-small {
  width: 44px;
}

.image-wrap {
  position: relative;
  width: 56px;
  height: 56px;
  overflow: hidden;
  border: 1px solid var(--lb-border);
  border-radius: 7px;
  background: var(--lb-surface);
}

.is-small .image-wrap {
  width: 42px;
  height: 42px;
}

img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.badge {
  position: absolute;
  top: 4px;
  left: 4px;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--lb-accent);
  color: white;
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
}

.remove-button {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 17px;
  min-width: 17px;
  height: 17px;
  min-height: 17px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: rgba(12, 14, 18, 0.78);
  color: var(--lb-text);
  font-size: 13px;
  line-height: 17px;
}

figcaption {
  overflow: hidden;
  margin-top: 4px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>


<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import type { GenerationSnapshot, HostAssetRef } from '@mugen/inner-protocol'
import { useWorkspaceStore } from '@/stores/workspace'
import {
  CUSTOM_SIZE_OPTION,
  formatComposerSize,
  readCustomDimensions,
  validateComposerGeneration
} from '@/generationValidation'
import ReferenceStrip from './ReferenceStrip.vue'
const store = useWorkspaceStore(); const prompt = ref(sessionStorage.getItem('lb-prompt-draft') || ''); const size = ref(''); const quality = ref(''); const count = ref(1); const ratio = ref(''); const composing = ref(false); const customWidth = ref<number | string>(1024); const customHeight = ref<number | string>(1024); const submitting = ref(false)
const customConstraint = computed(() => store.currentCapability.customSize)
const resolvedSize = computed(() => size.value === CUSTOM_SIZE_OPTION ? formatComposerSize(customWidth.value, customHeight.value) : size.value)
const parameterValidation = computed(() => store.currentConfig ? validateComposerGeneration(store.currentConfig, { selectedSize: size.value, customWidth: customWidth.value, customHeight: customHeight.value, quality: quality.value, count: count.value, ratio: ratio.value, referenceCount: store.references.length }) : undefined)
const parameterError = computed(() => parameterValidation.value && !parameterValidation.value.valid ? parameterValidation.value.message : '')
const customSizeInvalid = computed(() => parameterValidation.value?.valid === false && parameterValidation.value.code.startsWith('CUSTOM_SIZE_'))
const canSend = computed(() => !submitting.value && Boolean(prompt.value.trim() || store.references.length) && Boolean(store.currentConfig) && parameterValidation.value?.valid === true)
const customSizeHint = computed(() => {
  const rule = customConstraint.value
  if (!rule) return ''
  return `请填整数。宽 ${rule.minWidth}–${rule.maxWidth}，高 ${rule.minHeight}–${rule.maxHeight}，步进 ${rule.step} 像素`
})
function normalizeParams() { const capability = store.currentCapability; if (!capability.sizes.includes(size.value) && (size.value !== CUSTOM_SIZE_OPTION || !capability.supportsCustomSize)) size.value = capability.sizes[0] || '1024x1024'; if (!capability.qualities.includes(quality.value)) quality.value = capability.qualities[0] || '自动'; if (!capability.counts.includes(count.value)) count.value = capability.counts[0] || 1; if (!capability.ratios.includes(ratio.value)) ratio.value = capability.ratios[0] || '原图比例' }
async function send() { if (!canSend.value) return; submitting.value = true; const submittedPrompt = prompt.value; try { await store.generate(submittedPrompt, { size: resolvedSize.value, quality: quality.value, count: count.value, ratio: ratio.value }); prompt.value = ''; sessionStorage.removeItem('lb-prompt-draft') } finally { submitting.value = false } }
function keydown(event: KeyboardEvent) { if (event.key === 'Enter' && !event.shiftKey && !composing.value) { event.preventDefault(); send() } }
function selectConfig(event: Event) { void store.selectConfig((event.target as HTMLSelectElement).value) }
async function reuse(event: Event) { const detail = (event as CustomEvent<{ snapshot: GenerationSnapshot; references: HostAssetRef[] }>).detail; if (!detail?.snapshot) return; const { snapshot, references } = detail; if (!await store.applySnapshot(snapshot, references)) return; prompt.value = snapshot.prompt; const dimensions = readCustomDimensions(snapshot.size); if (!store.currentCapability.sizes.includes(snapshot.size) && store.currentCapability.supportsCustomSize && dimensions) { size.value = CUSTOM_SIZE_OPTION; customWidth.value = dimensions.width; customHeight.value = dimensions.height } else { size.value = snapshot.size }; quality.value = snapshot.quality; count.value = snapshot.count; ratio.value = snapshot.ratio }
watch(() => store.currentConfig?.id, normalizeParams, { immediate: true })
watch(prompt, value => sessionStorage.setItem('lb-prompt-draft', value))
onMounted(() => window.addEventListener('reuse-generation', reuse))
onUnmounted(() => window.removeEventListener('reuse-generation', reuse))
</script>

<template>
  <footer class="composer-dock">
    <ReferenceStrip />
    <textarea v-model="prompt" rows="3" placeholder="描述你想生成的画面" aria-label="提示词" @keydown="keydown" @compositionstart="composing = true" @compositionend="composing = false" />
    <div class="controls-row">
      <select :value="store.selectedConfigId" aria-label="模型配置" @change="selectConfig"><option v-for="config in store.enabledConfigs" :key="config.id" :value="config.id">{{ config.name }}</option></select>
      <select v-model="size" aria-label="尺寸"><option v-for="option in store.currentCapability.sizes" :key="option">{{ option }}</option></select>
      <span v-if="size === CUSTOM_SIZE_OPTION" class="custom-size"><input v-model.number="customWidth" type="number" inputmode="numeric" :min="customConstraint?.minWidth" :max="customConstraint?.maxWidth" :step="customConstraint?.step || 1" aria-label="宽度" :aria-invalid="customSizeInvalid" /><span>×</span><input v-model.number="customHeight" type="number" inputmode="numeric" :min="customConstraint?.minHeight" :max="customConstraint?.maxHeight" :step="customConstraint?.step || 1" aria-label="高度" :aria-invalid="customSizeInvalid" /></span>
      <select v-if="store.currentCapability.qualities.length" v-model="quality" aria-label="质量"><option v-for="option in store.currentCapability.qualities" :key="option">{{ option }}</option></select>
      <select v-model="count" aria-label="数量"><option v-for="option in store.currentCapability.counts" :key="option" :value="option">{{ option }} 张</option></select>
      <select v-model="ratio" aria-label="比例"><option v-for="option in store.currentCapability.ratios" :key="option">{{ option }}</option></select>
      <button class="send-button" type="button" :disabled="!canSend" @click="send">{{ submitting ? '发送中' : '生成' }} <span v-if="!submitting">↵</span></button>
    </div>
    <p v-if="size === CUSTOM_SIZE_OPTION && customSizeHint" class="parameter-hint">{{ customSizeHint }}</p>
    <p v-if="parameterError" class="parameter-error" role="alert">{{ parameterError }}</p>
  </footer>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, shallowRef, useTemplateRef, watch } from 'vue'
import {
  PROMPT_PRESET_LIMIT,
  PROMPT_PRESET_NAME_MAX_CODE_POINTS,
  normalizePromptPresets,
  validatePromptPreset
} from '../../utils/promptPresets'

type PromptPreset = {
  id: string
  name: string
  content: string
}

const props = defineProps<{
  presets: readonly PromptPreset[]
}>()

const emit = defineEmits<{
  'update:presets': [presets: PromptPreset[]]
}>()

const nameInputRef = useTemplateRef<HTMLInputElement>('nameInput')
const editingId = shallowRef('')
const draft = shallowRef<PromptPreset | null>(null)
const submitted = shallowRef(false)
const touched = reactive({ content: false, name: false })
const isCreating = computed(() => Boolean(draft.value && !props.presets.some((preset) => preset.id === draft.value?.id)))
const validation = computed(() =>
  validatePromptPreset(draft.value ?? { id: '', name: '', content: '' }, props.presets)
)
const nameError = computed(() => (submitted.value || touched.name ? validation.value.errors.name ?? '' : ''))
const contentError = computed(() =>
  submitted.value || touched.content ? validation.value.errors.content ?? '' : ''
)
const formError = computed(() => validation.value.errors.id ?? validation.value.errors.limit ?? '')
const nameLength = computed(() => Array.from(draft.value?.name.trim().normalize('NFKC') ?? '').length)
const atLimit = computed(() => props.presets.length >= PROMPT_PRESET_LIMIT)

function createPresetId() {
  let id = ''

  do {
    id = `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
  } while (props.presets.some((preset) => preset.id === id))

  return id
}

function resetValidation() {
  submitted.value = false
  touched.content = false
  touched.name = false
}

function focusNameInput() {
  void nextTick(() => nameInputRef.value?.focus())
}

function startCreate() {
  if (atLimit.value) {
    return
  }

  editingId.value = ''
  draft.value = {
    id: createPresetId(),
    name: '',
    content: ''
  }
  resetValidation()
  focusNameInput()
}

function startEdit(preset: PromptPreset) {
  editingId.value = preset.id
  draft.value = { ...preset }
  resetValidation()
  focusNameInput()
}

function cancelEdit() {
  editingId.value = ''
  draft.value = null
  resetValidation()
}

function updateDraft(patch: Partial<PromptPreset>) {
  if (!draft.value) {
    return
  }

  draft.value = { ...draft.value, ...patch }
}

function savePreset() {
  submitted.value = true
  touched.content = true
  touched.name = true

  if (!draft.value || !validation.value.valid) {
    return
  }

  const candidate = {
    ...draft.value,
    content: draft.value.content.replace(/\r\n?/g, '\n').trim(),
    name: draft.value.name.trim().normalize('NFKC')
  }
  const nextPresets = isCreating.value
    ? [...props.presets, candidate]
    : props.presets.map((preset) => (preset.id === editingId.value ? candidate : preset))

  emit('update:presets', normalizePromptPresets(nextPresets))
  cancelEdit()
}

function deletePreset(id: string) {
  emit('update:presets', normalizePromptPresets(props.presets.filter((preset) => preset.id !== id)))

  if (editingId.value === id) {
    cancelEdit()
  }
}

watch(
  () => props.presets,
  (presets) => {
    if (editingId.value && !presets.some((preset) => preset.id === editingId.value)) {
      cancelEdit()
    }
  }
)
</script>

<template>
  <section class="prompt-preset-settings" aria-labelledby="prompt-preset-title">
    <header class="section-heading">
      <div>
        <p>[PRESETS]</p>
        <h2 id="prompt-preset-title">预设提示词</h2>
      </div>
      <span>{{ presets.length }}/{{ PROMPT_PRESET_LIMIT }}</span>
    </header>

    <form v-if="draft" class="preset-form" novalidate @submit.prevent="savePreset">
      <div class="form-heading">
        <strong>{{ isCreating ? '新增预设' : '编辑预设' }}</strong>
        <button type="button" class="ghost-button" @click="cancelEdit">取消</button>
      </div>

      <label class="field-group">
        <span class="field-label">
          <span>名称</span>
          <span :class="{ invalid: nameLength > PROMPT_PRESET_NAME_MAX_CODE_POINTS }">
            {{ nameLength }}/{{ PROMPT_PRESET_NAME_MAX_CODE_POINTS }}
          </span>
        </span>
        <input
          ref="nameInput"
          :value="draft.name"
          type="text"
          autocomplete="off"
          spellcheck="false"
          :aria-invalid="Boolean(nameError)"
          :aria-describedby="nameError ? 'prompt-preset-name-error' : undefined"
          placeholder="例如：产品海报"
          @blur="touched.name = true"
          @input="updateDraft({ name: ($event.target as HTMLInputElement).value })"
        />
        <small v-if="nameError" id="prompt-preset-name-error" class="field-error">[错误] {{ nameError }}</small>
        <small v-else class="field-hint">输入 /{{ draft.name || '名称' }} 调用</small>
      </label>

      <label class="field-group">
        <span class="field-label">提示词</span>
        <textarea
          :value="draft.content"
          rows="5"
          :aria-invalid="Boolean(contentError)"
          :aria-describedby="contentError ? 'prompt-preset-content-error' : undefined"
          placeholder="输入完整提示词"
          @blur="touched.content = true"
          @input="updateDraft({ content: ($event.target as HTMLTextAreaElement).value })"
        />
        <small v-if="contentError" id="prompt-preset-content-error" class="field-error">
          [错误] {{ contentError }}
        </small>
      </label>

      <small v-if="formError" class="form-error" aria-live="polite">[错误] {{ formError }}</small>

      <button class="save-button" type="submit">保存预设</button>
    </form>

    <template v-else>
      <div v-if="presets.length" class="preset-list">
        <article v-for="preset in presets" :key="preset.id" class="preset-row">
          <div class="preset-copy">
            <strong>{{ preset.name }}</strong>
            <p>{{ preset.content }}</p>
            <small>/{{ preset.name }}</small>
          </div>
          <div class="row-actions">
            <button type="button" @click="startEdit(preset)">编辑</button>
            <button type="button" class="delete-button" @click="deletePreset(preset.id)">删除</button>
          </div>
        </article>
      </div>

      <p v-else class="empty-state">还没有预设提示词</p>

      <button class="add-button" type="button" :disabled="atLimit" @click="startCreate">
        {{ atLimit ? '已达 100 条上限' : '新增预设' }}
      </button>
    </template>
  </section>
</template>

<style scoped>
.prompt-preset-settings {
  display: grid;
  gap: 24px;
  color: var(--mugen-text, #e8e8e8);
  font-family: var(--mugen-font-body, "Space Grotesk", system-ui, sans-serif);
}

.section-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
}

.section-heading div {
  display: grid;
  gap: 4px;
}

.section-heading p,
.section-heading h2 {
  margin: 0;
}

.section-heading p,
.section-heading > span {
  color: var(--mugen-muted, #999999);
  font-family: var(--mugen-font-mono, "Space Mono", monospace);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.section-heading h2 {
  color: var(--mugen-text, #e8e8e8);
  font-size: 18px;
  font-weight: 500;
  letter-spacing: -0.01em;
}

.preset-form {
  display: grid;
  gap: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--mugen-border-strong, #333333);
}

.form-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.form-heading strong {
  font-size: 14px;
  font-weight: 500;
}

.field-group {
  display: grid;
  gap: 8px;
}

.field-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--mugen-muted, #999999);
  font-family: var(--mugen-font-mono, "Space Mono", monospace);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.field-label .invalid {
  color: var(--mugen-danger, #d71921);
}

input,
textarea {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid var(--mugen-border-strong, #333333);
  border-radius: 4px;
  outline: 0;
  background: transparent;
  color: var(--mugen-text, #e8e8e8);
  font-family: var(--mugen-font-body, "Space Grotesk", system-ui, sans-serif);
  font-size: 13px;
  line-height: 1.5;
}

input {
  min-height: 44px;
  padding: 0 12px;
}

textarea {
  min-height: 112px;
  padding: 11px 12px;
  resize: vertical;
}

input:focus,
textarea:focus {
  border-color: var(--mugen-text, #e8e8e8);
}

input[aria-invalid="true"],
textarea[aria-invalid="true"] {
  border-color: var(--mugen-danger, #d71921);
}

.field-hint,
.field-error,
.form-error {
  font-family: var(--mugen-font-mono, "Space Mono", monospace);
  font-size: 10px;
  line-height: 1.4;
}

.field-hint {
  overflow: hidden;
  color: var(--mugen-muted, #999999);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.field-error,
.form-error {
  color: var(--mugen-danger, #d71921);
}

.save-button,
.add-button,
.ghost-button,
.row-actions button {
  border-radius: 4px;
  cursor: pointer;
  font-family: var(--mugen-font-mono, "Space Mono", monospace);
  font-size: 11px;
  letter-spacing: 0.04em;
}

.save-button,
.add-button {
  min-height: 44px;
  border: 0;
  background: var(--mugen-text, #e8e8e8);
  color: var(--mugen-workspace, #000000);
}

.ghost-button,
.row-actions button {
  min-height: 36px;
  padding: 0 10px;
  border: 1px solid var(--mugen-border-strong, #333333);
  background: transparent;
  color: var(--mugen-secondary, #999999);
}

.ghost-button:hover,
.row-actions button:hover {
  border-color: var(--mugen-text, #e8e8e8);
  color: var(--mugen-text, #e8e8e8);
}

.preset-list {
  display: grid;
}

.preset-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  min-width: 0;
  padding: 16px 0;
  border-top: 1px solid var(--mugen-hairline, #222222);
}

.preset-row:last-child {
  border-bottom: 1px solid var(--mugen-hairline, #222222);
}

.preset-copy {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.preset-copy strong {
  overflow: hidden;
  color: var(--mugen-text, #e8e8e8);
  font-size: 14px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-copy p {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  color: var(--mugen-secondary, #999999);
  font-size: 12px;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.preset-copy small {
  overflow: hidden;
  color: var(--mugen-muted, #999999);
  font-family: var(--mugen-font-mono, "Space Mono", monospace);
  font-size: 10px;
  letter-spacing: 0.04em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-actions {
  display: grid;
  gap: 4px;
}

.row-actions .delete-button {
  border-color: var(--mugen-danger, #d71921);
  color: var(--mugen-danger, #d71921);
}

.empty-state {
  margin: 0;
  padding: 48px 16px;
  border-top: 1px solid var(--mugen-hairline, #222222);
  border-bottom: 1px solid var(--mugen-hairline, #222222);
  color: var(--mugen-muted, #999999);
  font-size: 13px;
  text-align: center;
}

.add-button:disabled {
  cursor: default;
  opacity: 0.4;
}

@media (max-width: 420px) {
  .preset-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .row-actions {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>

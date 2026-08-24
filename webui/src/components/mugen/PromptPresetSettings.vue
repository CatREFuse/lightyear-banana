<script setup lang="ts">
import { computed, nextTick, reactive, shallowRef, useTemplateRef, watch } from 'vue'
import {
  PROMPT_PRESET_LIMIT,
  PROMPT_PRESET_NAME_MAX_CODE_POINTS,
  normalizePromptPresets,
  validatePromptPreset
} from '../../utils/promptPresets'
import AppIcon from './AppIcon.vue'

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
    <h2 id="prompt-preset-title" class="visually-hidden">预设提示词</h2>
    <div class="prompt-preset-toolbar">
      <span>已有 {{ presets.length }} 个</span>
      <button v-if="!draft" class="add-button" type="button" :disabled="atLimit" @click="startCreate">
        <AppIcon name="add-large-fill" size="15" />
        <span>{{ atLimit ? '已达上限' : '添加' }}</span>
      </button>
    </div>

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
        <small v-if="nameError" id="prompt-preset-name-error" class="field-error">{{ nameError }}</small>
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
          {{ contentError }}
        </small>
      </label>

      <small v-if="formError" class="form-error" aria-live="polite">{{ formError }}</small>

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

      <p v-else class="preset-empty-state">还没有预设提示词</p>
    </template>
  </section>
</template>

<style scoped>
.prompt-preset-settings {
  display: grid;
  gap: 12px;
  color: var(--mugen-text);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  margin: -1px;
  padding: 0;
  border: 0;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.prompt-preset-toolbar {
  display: flex;
  min-height: 32px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.prompt-preset-toolbar > span {
  color: var(--mugen-muted);
  font-size: 11px;
}

.prompt-preset-toolbar .add-button {
  display: inline-flex;
  min-height: 28px;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: var(--mugen-field);
  color: var(--mugen-text);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}

.preset-form {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid var(--mugen-border);
  border-radius: 16px;
  background: var(--mugen-card);
}

.form-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.form-heading strong {
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
}

.field-group {
  display: grid;
  gap: 4px;
}

.field-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--mugen-secondary);
  font-size: 11px;
  line-height: 16px;
}

.field-label .invalid {
  color: var(--mugen-danger-text);
}

input,
textarea {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 8px;
  outline: 0;
  background: var(--mugen-field);
  color: var(--mugen-text);
  font: inherit;
  font-size: 12px;
  line-height: 16px;
}

input {
  min-height: 36px;
  padding: 9px 10px;
}

textarea {
  min-height: 104px;
  padding: 9px 10px;
  resize: vertical;
}

input:focus,
textarea:focus {
  border-color: var(--mugen-accent);
}

input[aria-invalid="true"],
textarea[aria-invalid="true"] {
  border-color: var(--mugen-danger-text);
}

.field-hint,
.field-error,
.form-error {
  font-size: 10px;
  line-height: 14px;
}

.field-hint {
  overflow: hidden;
  color: var(--mugen-muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.field-error,
.form-error {
  color: var(--mugen-danger-text);
}

.save-button,
.add-button,
.ghost-button,
.row-actions button {
  border-radius: 8px;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}

.save-button {
  min-height: 36px;
  border: 0;
  background: var(--mugen-accent);
  color: var(--mugen-on-accent);
}

.ghost-button,
.row-actions button {
  min-height: 28px;
  padding: 0 10px;
  border: 0;
  background: var(--mugen-field);
  color: var(--mugen-secondary);
}

.prompt-preset-toolbar .add-button:hover,
.prompt-preset-toolbar .add-button:focus-visible,
.ghost-button:hover,
.ghost-button:focus-visible,
.row-actions button:hover,
.row-actions button:focus-visible {
  background: var(--mugen-hover);
  color: var(--mugen-text);
}

.preset-list {
  display: grid;
  overflow: hidden;
  border: 1px solid var(--mugen-border);
  border-radius: 16px;
  background: var(--mugen-card);
}

.preset-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-width: 0;
  min-height: 72px;
  padding: 12px 16px;
}

.preset-row + .preset-row {
  border-top: 1px solid var(--mugen-hairline);
}

.preset-copy {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.preset-copy strong {
  overflow: hidden;
  color: var(--mugen-text);
  font-size: 12px;
  font-weight: 600;
  line-height: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preset-copy p {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  color: var(--mugen-secondary);
  font-size: 11px;
  line-height: 16px;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.preset-copy small {
  overflow: hidden;
  color: var(--mugen-muted);
  font-size: 10px;
  line-height: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.row-actions .delete-button {
  color: var(--mugen-danger-text);
}

.preset-empty-state {
  margin: 0;
  padding: 32px 16px;
  border: 1px solid var(--mugen-border);
  border-radius: 16px;
  background: var(--mugen-card);
  color: var(--mugen-muted);
  font-size: 12px;
  text-align: center;
}

.add-button:disabled {
  cursor: default;
  opacity: 0.4;
}

@media (max-width: 319px) {
  .preset-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .row-actions {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>

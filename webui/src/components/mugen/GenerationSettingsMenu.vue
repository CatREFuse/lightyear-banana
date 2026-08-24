<script setup lang="ts">
import { computed, shallowRef, useTemplateRef } from 'vue'
import type { ResolutionInputMode } from '@mugen/core'
import AppIcon from './AppIcon.vue'
import type { AppIconName } from './appIcons'

type MenuOption = {
  icon?: AppIconName
  value: string
  label: string
  meta?: string
  status?: string
  statusTone?: 'ready' | 'warning' | 'muted'
}

type MenuRoute = 'main' | 'config' | 'model' | 'ratio' | 'size'

const props = defineProps<{
  activeConfigId: string
  activeConfigName: string
  activeModel: string
  configOptions: MenuOption[]
  count: number
  countOptions: number[]
  customHeight: number
  customWidth: number
  modelOptions: MenuOption[]
  quality: string
  qualityOptions: string[]
  ratio: string
  ratioOptions: string[]
  resolutionMode: ResolutionInputMode
  showsQualityControl: boolean
  size: string
  sizeOptions: MenuOption[]
}>()

const emit = defineEmits<{
  close: []
  selectConfig: [value: string]
  selectModel: [value: string]
  updateCount: [value: number]
  updateCustomHeight: [value: number]
  updateCustomWidth: [value: number]
  updateQuality: [value: string]
  updateRatio: [value: string]
  updateSize: [value: string]
}>()

const route = shallowRef<MenuRoute>('main')
const routeDirection = shallowRef<'forward' | 'back'>('forward')
const lastRoute = shallowRef<Exclude<MenuRoute, 'main'>>('config')
const pendingFocusRoute = shallowRef<Exclude<MenuRoute, 'main'> | null>(null)
const menuRef = useTemplateRef<HTMLElement>('menu')

const routeOptions = computed<MenuOption[]>(() => {
  if (route.value === 'config') return props.configOptions
  if (route.value === 'model') return props.modelOptions
  if (route.value === 'size') return props.sizeOptions
  if (route.value === 'ratio') {
    return props.ratioOptions.map((option) => ({
      icon: option.includes('原图') || option.includes('参考图') || option.includes('画布')
        ? 'picture-in-picture-fill'
        : 'bx-fullscreen',
      value: option,
      label: option,
      meta: ratioMeta(option)
    }))
  }
  return []
})

const routeTitle = computed(() => ({
  config: '选择供应商',
  model: '选择模型',
  ratio: '生成图片比例',
  size: '选择生成分辨率'
})[route.value as Exclude<MenuRoute, 'main'>] ?? '')

const routeValue = computed(() => ({
  config: props.activeConfigId,
  model: props.activeModel,
  ratio: props.ratio,
  size: props.resolutionMode === 'custom' ? '__mugen_custom_resolution__' : props.size
})[route.value as Exclude<MenuRoute, 'main'>] ?? '')

const countIndex = computed(() => props.countOptions.indexOf(props.count))
const canDecreaseCount = computed(() => countIndex.value > 0)
const canIncreaseCount = computed(() => countIndex.value >= 0 && countIndex.value < props.countOptions.length - 1)
const sizeDisplay = computed(() => props.resolutionMode === 'custom' ? `${props.customWidth}×${props.customHeight}` : props.size)

function ratioMeta(option: string) {
  const knownMeta: Record<string, string> = {
    '1:1': '常用方形画幅',
    '4:3': '照片常用画幅',
    '3:4': '小红书常用比例',
    '21:9': '电影常用画幅',
    '16:9': '横屏视频常用画幅',
    '9:16': '竖屏视频常用画幅',
    原图比例: '跟随原图片',
    参考图比例: '跟随参考图',
    画布比例: '跟随当前画布'
  }
  return knownMeta[option] ?? `比例 ${option}`
}

function qualityLabel(option: string) {
  const normalized = option.toLowerCase()
  if (normalized === 'low') return '低'
  if (normalized === 'medium' || normalized === 'standard') return '中'
  if (normalized === 'high' || normalized === 'hd') return '高'
  if (normalized === 'auto') return '自动'
  return option
}

function isRecommendedRatio(option: MenuOption) {
  return option.label === '原图比例' || option.label === '参考图比例'
}

function openRoute(nextRoute: Exclude<MenuRoute, 'main'>) {
  lastRoute.value = nextRoute
  routeDirection.value = 'forward'
  route.value = nextRoute
}

function returnToMain(restoreFocus = true) {
  const targetRoute = lastRoute.value
  routeDirection.value = 'back'
  pendingFocusRoute.value = restoreFocus ? targetRoute : null
  route.value = 'main'
}

function restoreRouteFocus() {
  if (route.value !== 'main' || !pendingFocusRoute.value) return
  menuRef.value?.querySelector<HTMLElement>(`[data-route="${pendingFocusRoute.value}"]`)?.focus()
  pendingFocusRoute.value = null
}

function selectOption(option: MenuOption) {
  if (route.value === 'config') emit('selectConfig', option.value)
  if (route.value === 'model') emit('selectModel', option.value)
  if (route.value === 'ratio') emit('updateRatio', option.value)
  if (route.value === 'size') emit('updateSize', option.value)
  returnToMain()
}

function changeCount(offset: -1 | 1) {
  const nextValue = props.countOptions[countIndex.value + offset]
  if (nextValue !== undefined) emit('updateCount', nextValue)
}

function readNumber(event: Event) {
  return Number((event.target as HTMLInputElement).value)
}

function handleEscape() {
  if (route.value === 'main') {
    emit('close')
    return
  }
  returnToMain()
}
</script>

<template>
  <section ref="menu" class="parameter-panel generation-settings-menu" aria-label="生成设置" @click.stop @keydown.esc.stop="handleEscape">
    <Transition :name="`parameter-route-${routeDirection}`" mode="out-in" @after-enter="restoreRouteFocus">
      <div v-if="route === 'main'" key="main" class="parameter-route parameter-route-main">
        <button class="parameter-menu-row" data-route="config" type="button" @click="openRoute('config')">
          <span class="parameter-row-label"><AppIcon name="hard-drive-3-line" size="16" />供应商</span>
          <span class="parameter-row-value">{{ activeConfigName }}<AppIcon name="arrow-right-s-line" size="24" /></span>
        </button>

        <button class="parameter-menu-row" data-route="model" type="button" @click="openRoute('model')">
          <span class="parameter-row-label"><AppIcon name="shining-line" size="16" />模型</span>
          <span class="parameter-row-value"><AppIcon name="openai-fill" size="12" />{{ activeModel }}<AppIcon name="arrow-right-s-line" size="24" /></span>
        </button>

        <button class="parameter-menu-row" data-route="ratio" type="button" @click="openRoute('ratio')">
          <span class="parameter-row-label"><AppIcon name="aspect-ratio-line" size="16" />比例</span>
          <span class="parameter-row-value">{{ ratio }}<AppIcon name="arrow-right-s-line" size="24" /></span>
        </button>

        <div class="parameter-menu-row">
          <span class="parameter-row-label"><AppIcon name="hashtag" size="16" />生成数量</span>
          <span class="parameter-stepper">
            <button type="button" :disabled="!canDecreaseCount" aria-label="减少生成数量" @click="changeCount(-1)">
              <AppIcon name="arrow-right-s-line" size="24" />
            </button>
            <output aria-live="polite">{{ count }}</output>
            <button type="button" :disabled="!canIncreaseCount" aria-label="增加生成数量" @click="changeCount(1)">
              <AppIcon name="arrow-right-s-line" size="24" />
            </button>
          </span>
        </div>

        <div v-if="showsQualityControl" class="parameter-menu-row">
          <span class="parameter-row-label"><AppIcon name="sparkling-2-line" size="16" />生成质量</span>
          <span class="parameter-segments" aria-label="生成质量">
            <button
              v-for="option in qualityOptions"
              :key="option"
              type="button"
              :aria-pressed="option === quality"
              @click="emit('updateQuality', option)"
            >{{ qualityLabel(option) }}</button>
          </span>
        </div>

        <div class="parameter-resolution-block">
          <button class="parameter-menu-row" data-route="size" type="button" @click="openRoute('size')">
            <span class="parameter-row-label"><AppIcon name="aspect-ratio-line" size="16" />生成分辨率</span>
            <span class="parameter-row-value">{{ sizeDisplay }}<AppIcon name="arrow-right-s-line" size="24" /></span>
          </button>
          <div v-if="resolutionMode === 'custom'" class="parameter-custom-size">
            <label>宽<input inputmode="numeric" min="1" step="16" type="number" :value="customWidth" @input="emit('updateCustomWidth', readNumber($event))" /></label>
            <span>×</span>
            <label>高<input inputmode="numeric" min="1" step="16" type="number" :value="customHeight" @input="emit('updateCustomHeight', readNumber($event))" /></label>
          </div>
        </div>
      </div>

      <div v-else :key="route" class="parameter-route parameter-route-submenu">
        <button class="parameter-back-button" type="button" @click="returnToMain()">
          <AppIcon name="bx-arrow-back" size="12" />返回
        </button>
        <p class="parameter-submenu-title">{{ routeTitle }}</p>
        <div class="parameter-submenu-options" role="radiogroup" :aria-label="routeTitle">
          <button
            v-for="option in routeOptions"
            :key="option.value"
            class="parameter-submenu-option"
            type="button"
            role="radio"
            :aria-checked="option.value === routeValue"
            @click="selectOption(option)"
          >
            <AppIcon :name="option.icon ?? (route === 'ratio' ? 'bx-fullscreen' : 'shining-line')" size="16" />
            <span class="parameter-option-copy">
              <span>{{ option.label }}</span>
              <small v-if="option.meta">{{ option.meta }}</small>
            </span>
            <span v-if="route === 'ratio' && isRecommendedRatio(option)" class="parameter-option-tag">推荐</span>
            <span v-if="option.status" class="parameter-option-status" :class="`is-${option.statusTone ?? 'muted'}`">{{ option.status }}</span>
            <AppIcon v-if="option.value === routeValue" class="parameter-option-check" name="checkbox-circle-fill" size="16" />
          </button>
        </div>
      </div>
    </Transition>
  </section>
</template>

<style scoped>
.generation-settings-menu {
  overflow: clip;
}

.parameter-route {
  display: flex;
  width: 100%;
  min-width: 0;
  flex-direction: column;
}

.parameter-route-main {
  gap: 12px;
}

.parameter-menu-row {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 32px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--mugen-text);
  font: inherit;
  text-align: left;
}

button.parameter-menu-row {
  cursor: pointer;
}

button.parameter-menu-row:hover,
button.parameter-menu-row:focus-visible {
  background: var(--mugen-field);
  outline: 0;
}

.parameter-row-label,
.parameter-row-value {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  white-space: nowrap;
}

.parameter-row-label {
  flex: 0 0 auto;
  gap: 7px;
  color: var(--mugen-muted);
  font-size: 12px;
  line-height: 16px;
}

.parameter-row-value {
  justify-content: flex-end;
  gap: 3px;
  overflow: hidden;
  color: var(--mugen-text);
  font-size: 12px;
  line-height: 16px;
  text-overflow: ellipsis;
}

.parameter-row-value :deep(svg) {
  flex: 0 0 auto;
  color: var(--mugen-muted);
}

.parameter-stepper {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.parameter-stepper button {
  display: grid;
  width: 24px;
  min-height: 24px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--mugen-text);
}

.parameter-stepper button:first-child :deep(svg) {
  transform: rotate(180deg);
}

.parameter-stepper button:hover:not(:disabled),
.parameter-stepper button:focus-visible:not(:disabled) {
  background: var(--mugen-field);
  outline: 0;
}

.parameter-stepper button:disabled {
  color: var(--mugen-border-strong);
}

.parameter-stepper output {
  display: grid;
  width: 18px;
  min-height: 24px;
  place-items: center;
  border-radius: 2px;
  background: var(--mugen-field);
  color: var(--mugen-text);
  font-size: 12px;
}

.parameter-segments {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border-radius: 12px;
  background: var(--mugen-field);
}

.parameter-segments button {
  min-width: 28px;
  min-height: 24px;
  padding: 4px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--mugen-muted);
  font-size: 12px;
  line-height: 16px;
}

.parameter-segments button[aria-pressed="true"] {
  background: var(--mugen-accent);
  color: #fff;
}

.parameter-resolution-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.parameter-custom-size {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: end;
  gap: 6px;
}

.parameter-custom-size label {
  display: grid;
  gap: 2px;
  color: var(--mugen-muted);
  font-size: 10px;
}

.parameter-custom-size input {
  width: 100%;
  min-width: 0;
  min-height: 28px;
  padding: 0 7px;
  border: 0;
  border-radius: 8px;
  background: var(--mugen-field);
  color: var(--mugen-text);
}

.parameter-route-submenu {
  gap: 12px;
}

.parameter-back-button {
  display: inline-flex;
  width: fit-content;
  min-height: 24px;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--mugen-muted);
  font-size: 12px;
  line-height: 16px;
}

.parameter-back-button:hover,
.parameter-back-button:focus-visible {
  background: var(--mugen-field);
  outline: 0;
}

.parameter-submenu-title {
  margin: 0;
  color: var(--mugen-muted);
  font-size: 12px;
  line-height: 16px;
}

.parameter-submenu-options {
  display: flex;
  max-height: 228px;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}

.parameter-submenu-option {
  display: grid;
  width: 100%;
  min-width: 0;
  min-height: 28px;
  grid-template-columns: 16px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 4px;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--mugen-text);
  text-align: left;
}

.parameter-submenu-option:hover,
.parameter-submenu-option:focus-visible {
  background: var(--mugen-field);
  outline: 0;
}

.parameter-option-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  line-height: 16px;
}

.parameter-option-copy > span,
.parameter-option-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.parameter-option-copy small {
  color: var(--mugen-muted);
  font-size: 10px;
  line-height: 10px;
}

.parameter-option-tag,
.parameter-option-status {
  justify-self: end;
  padding: 2px 4px;
  border-radius: 4px;
  background: var(--mugen-accent-soft);
  color: var(--mugen-accent);
  font-size: 10px;
  line-height: 10px;
  white-space: nowrap;
}

.parameter-option-status.is-muted {
  background: var(--mugen-field);
  color: var(--mugen-muted);
}

.parameter-option-status.is-warning {
  background: var(--mugen-danger-bg);
  color: var(--mugen-danger-muted);
}

.parameter-option-status.is-ready {
  background: var(--mugen-success-bg);
  color: var(--mugen-success);
}

.parameter-option-check {
  justify-self: end;
  color: var(--mugen-accent);
}

.parameter-route-forward-enter-active,
.parameter-route-forward-leave-active,
.parameter-route-back-enter-active,
.parameter-route-back-leave-active {
  transition: opacity 140ms ease, transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.parameter-route-forward-enter-from,
.parameter-route-back-leave-to {
  opacity: 0;
  transform: translateX(16px);
}

.parameter-route-forward-leave-to,
.parameter-route-back-enter-from {
  opacity: 0;
  transform: translateX(-16px);
}

@media (prefers-reduced-motion: reduce) {
  .parameter-route-forward-enter-active,
  .parameter-route-forward-leave-active,
  .parameter-route-back-enter-active,
  .parameter-route-back-leave-active {
    transition: none;
  }
}
</style>

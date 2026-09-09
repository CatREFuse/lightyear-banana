<script setup lang="ts">
import { computed, shallowRef, useTemplateRef } from 'vue'
import AppIcon from './AppIcon.vue'
import type { AppIconName } from './appIcons'
import DiscreteSlider from './DiscreteSlider.vue'
import GenerationSettingsItem from './GenerationSettingsItem.vue'

type MenuOption = {
  icon?: AppIconName
  value: string
  label: string
  meta?: string
  status?: string
  statusTone?: 'ready' | 'warning' | 'muted'
}

type MenuRoute = 'main' | 'config' | 'model' | 'ratio'

const props = defineProps<{
  activeConfigId: string
  activeConfigName: string
  activeModel: string
  configOptions: MenuOption[]
  count: number
  countOptions: number[]
  modelOptions: MenuOption[]
  quality: string
  qualityOptions: string[]
  ratio: string
  ratioOptions: string[]
  showsQualityControl: boolean
  size: string
  sizeOptions: MenuOption[]
}>()

const emit = defineEmits<{
  close: []
  selectConfig: [value: string]
  selectModel: [value: string]
  updateCount: [value: number]
  updateQuality: [value: string]
  updateRatio: [value: string]
  updateSize: [value: string]
}>()

const route = shallowRef<MenuRoute>('main')
const routeDirection = shallowRef<'forward' | 'back'>('forward')
const lastRoute = shallowRef<Exclude<MenuRoute, 'main'>>('config')
const pendingFocusRoute = shallowRef<Exclude<MenuRoute, 'main'> | null>(null)
const menuRef = useTemplateRef<HTMLElement>('menu')
const customSizeValue = '__mugen_custom_resolution__'
let routeStartHeight = 0
let routeHeightAnimation: Animation | null = null
let routeHeightFinished = true
let routeLeaveFinished = true

const routeOptions = computed<MenuOption[]>(() => {
  if (route.value === 'config') return props.configOptions
  if (route.value === 'model') return props.modelOptions
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
  ratio: '生成图片比例'
})[route.value as Exclude<MenuRoute, 'main'>] ?? '')

const routeValue = computed(() => ({
  config: props.activeConfigId,
  model: props.activeModel,
  ratio: props.ratio
})[route.value as Exclude<MenuRoute, 'main'>] ?? '')

const countIndex = computed(() => props.countOptions.indexOf(props.count))
const canDecreaseCount = computed(() => countIndex.value > 0)
const canIncreaseCount = computed(() => countIndex.value >= 0 && countIndex.value < props.countOptions.length - 1)
const sizeDisplay = computed(() => props.size)
const presetSizeOptions = computed(() => props.sizeOptions.filter((option) => option.value !== customSizeValue))

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

function captureRouteHeight() {
  const menu = menuRef.value
  if (!menu) return

  const renderedHeight = menu.getBoundingClientRect().height
  routeHeightAnimation?.cancel()
  routeHeightAnimation = null
  routeStartHeight = renderedHeight
  routeHeightFinished = false
  routeLeaveFinished = false
  menu.style.height = `${renderedHeight}px`
}

function releaseRouteHeight() {
  if (!routeHeightFinished || !routeLeaveFinished) return

  const menu = menuRef.value
  if (!menu) return
  routeStartHeight = 0
  menu.style.height = ''
}

function finishRouteLeave() {
  routeLeaveFinished = true
  releaseRouteHeight()
}

function animateRouteHeight(element: Element) {
  const menu = menuRef.value
  if (!menu) return

  const menuStyle = getComputedStyle(menu)
  const verticalChrome = Number.parseFloat(menuStyle.paddingTop)
    + Number.parseFloat(menuStyle.paddingBottom)
    + Number.parseFloat(menuStyle.borderTopWidth)
    + Number.parseFloat(menuStyle.borderBottomWidth)
  const routeEndHeight = (element as HTMLElement).scrollHeight + verticalChrome

  if (routeStartHeight === 0
    || Math.abs(routeEndHeight - routeStartHeight) < 1
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    menu.style.height = `${routeEndHeight}px`
    routeHeightFinished = true
    releaseRouteHeight()
    return
  }

  const animation = menu.animate([
    { height: `${routeStartHeight}px` },
    { height: `${routeEndHeight}px` }
  ], {
    duration: 180,
    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    fill: 'forwards'
  })
  routeHeightAnimation = animation
  animation.addEventListener('finish', () => {
    if (routeHeightAnimation !== animation) return
    menu.style.height = `${routeEndHeight}px`
    animation.cancel()
    routeHeightAnimation = null
    routeHeightFinished = true
    releaseRouteHeight()
  }, { once: true })
}

function selectOption(option: MenuOption) {
  if (route.value === 'config') emit('selectConfig', option.value)
  if (route.value === 'model') emit('selectModel', option.value)
  if (route.value === 'ratio') emit('updateRatio', option.value)
  returnToMain()
}

function changeCount(offset: -1 | 1) {
  const nextValue = props.countOptions[countIndex.value + offset]
  if (nextValue !== undefined) emit('updateCount', nextValue)
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
    <Transition
      :name="`parameter-route-${routeDirection}`"
      @before-leave="captureRouteHeight"
      @enter="animateRouteHeight"
      @after-leave="finishRouteLeave"
      @after-enter="restoreRouteFocus"
    >
      <div v-if="route === 'main'" key="main" class="parameter-route parameter-route-main">
        <GenerationSettingsItem
          class="parameter-menu-row"
          data-route="config"
          icon="hard-drive-3-line"
          title="供应商"
          :value="activeConfigName"
          variant="main"
          @activate="openRoute('config')"
        />

        <GenerationSettingsItem
          class="parameter-menu-row"
          data-route="model"
          icon="shining-line"
          title="模型"
          :value="activeModel"
          value-icon="openai-fill"
          variant="main"
          @activate="openRoute('model')"
        />

        <GenerationSettingsItem
          class="parameter-menu-row"
          data-route="ratio"
          icon="aspect-ratio-line"
          title="比例"
          :value="ratio"
          variant="main"
          @activate="openRoute('ratio')"
        />

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

        <div v-if="showsQualityControl" class="parameter-menu-row" :class="{ 'parameter-quality-expanded': qualityOptions.length > 4 }">
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
          <div class="parameter-resolution-heading">
            <span class="parameter-row-label"><AppIcon name="aspect-ratio-line" size="16" />生成分辨率</span>
            <output class="parameter-resolution-value" aria-live="polite">{{ sizeDisplay }}</output>
          </div>
          <DiscreteSlider
            class="parameter-resolution-slider"
            aria-label="生成分辨率"
            :model-value="size"
            :options="presetSizeOptions"
            @update:model-value="emit('updateSize', $event)"
          />
        </div>
      </div>

      <div v-else :key="route" class="parameter-route parameter-route-submenu">
        <button class="parameter-back-button" type="button" @click="returnToMain()">
          <AppIcon name="bx-arrow-back" size="12" />返回
        </button>
        <div class="parameter-submenu-scroll">
          <p class="parameter-submenu-title">{{ routeTitle }}</p>
          <div class="parameter-submenu-options" role="radiogroup" :aria-label="routeTitle">
            <GenerationSettingsItem
              v-for="option in routeOptions"
              :key="option.value"
              class="parameter-submenu-option"
              :badge="route === 'ratio' && isRecommendedRatio(option) ? '推荐' : ''"
              :description="option.meta"
              :icon="option.icon ?? (route === 'ratio' ? 'bx-fullscreen' : 'shining-line')"
              role="radio"
              :aria-checked="option.value === routeValue"
              :selected="option.value === routeValue"
              :status="option.status"
              :status-tone="option.statusTone"
              :title="option.label"
              @activate="selectOption(option)"
            />
          </div>
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
  grid-area: 1 / 1;
  align-self: start;
  flex-direction: column;
}

.parameter-route-main {
  gap: 12px;
}

.parameter-menu-row:not(button) {
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

.parameter-row-label {
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

.parameter-menu-row.parameter-quality-expanded {
  align-items: stretch;
  flex-direction: column;
}

.parameter-quality-expanded .parameter-segments {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
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
  gap: 8px;
}

.parameter-resolution-heading {
  display: flex;
  min-width: 0;
  align-items: center;
}

.parameter-resolution-heading {
  min-height: 24px;
  justify-content: space-between;
  gap: 8px;
}

.parameter-resolution-value {
  color: var(--mugen-text);
  font-size: 12px;
  line-height: 16px;
  white-space: nowrap;
}

.parameter-resolution-slider {
  align-self: center;
  flex: 0 0 auto;
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

.parameter-submenu-scroll {
  display: flex;
  max-height: 256px;
  min-height: 0;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
  scrollbar-color: var(--mugen-border-strong) transparent;
  scrollbar-width: thin;
}

.parameter-submenu-scroll::-webkit-scrollbar {
  width: 4px;
}

.parameter-submenu-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.parameter-submenu-scroll::-webkit-scrollbar-thumb {
  border: 0;
  border-radius: 999px;
  background: var(--mugen-border-strong);
}

.parameter-submenu-options {
  display: flex;
  flex-direction: column;
  gap: 12px;
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

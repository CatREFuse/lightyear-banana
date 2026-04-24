<script setup lang="ts">
import { computed, reactive, shallowRef } from 'vue'
import { useCanvasProbe, type InsertRect } from '../composables/useCanvasProbe'

type RuntimeName = 'browser' | 'photoshop-uxp'
type ProbeTab = 'capture' | 'insert'

const props = defineProps<{
  runtime: RuntimeName
}>()

const {
  busy,
  capturedImages,
  documentLabel,
  lastInsert,
  sampleImage,
  selectedImage,
  selectedImageId,
  status,
  captureLayer,
  captureSelection,
  captureVisible,
  insertAtRect,
  insertAtSelection,
  insertFullCanvas,
  refreshDocument
} = useCanvasProbe(props.runtime)

const rect = reactive<InsertRect>({
  left: 80,
  top: 80,
  width: 320,
  height: 240
})
const activeTab = shallowRef<ProbeTab>('capture')

const runtimeLabel = computed(() =>
  props.runtime === 'photoshop-uxp' ? 'Photoshop UXP' : 'Web Preview'
)

const captureMeta = computed(() => {
  const image = selectedImage.value

  if (!image) {
    return '暂无图像'
  }

  return `${image.width} × ${image.height}`
})

const sampleMeta = computed(() => `${sampleImage.value.width} × ${sampleImage.value.height}`)
const currentImageMeta = computed(() =>
  activeTab.value === 'insert' ? sampleMeta.value : captureMeta.value
)
</script>

<template>
  <main class="probe-shell">
    <section class="probe-header">
      <p class="eyebrow">{{ runtimeLabel }}</p>
      <h1>画板交互验证</h1>
      <p class="lede">抓图和插图分开验证。</p>
    </section>

    <section class="tabs" aria-label="验证模式">
      <button
        type="button"
        :class="{ selected: activeTab === 'capture' }"
        @click="activeTab = 'capture'"
      >
        抓图
      </button>
      <button
        type="button"
        :class="{ selected: activeTab === 'insert' }"
        @click="activeTab = 'insert'"
      >
        插图
      </button>
    </section>

    <section class="status-grid">
      <div>
        <span class="label">状态</span>
        <strong>{{ status }}</strong>
      </div>
      <div>
        <span class="label">当前文档</span>
        <strong>{{ documentLabel }}</strong>
      </div>
      <div>
        <span class="label">当前图像</span>
        <strong>{{ currentImageMeta }}</strong>
      </div>
      <div>
        <span class="label">写入位置</span>
        <strong>{{ lastInsert || '暂无' }}</strong>
      </div>
    </section>

    <template v-if="activeTab === 'capture'">
      <section class="toolbar">
        <button type="button" :disabled="busy" @click="refreshDocument">刷新</button>
        <button type="button" :disabled="busy" @click="captureVisible">
          抓取可见图像
        </button>
        <button type="button" :disabled="busy" @click="captureSelection">
          抓取选区图像
        </button>
        <button type="button" :disabled="busy" @click="captureLayer">
          抓取选中图层
        </button>
      </section>

      <section class="preview-section">
        <div class="preview-frame">
          <img v-if="selectedImage" :src="selectedImage.previewUrl" :alt="selectedImage.label" />
          <p v-else>等待抓取</p>
        </div>

        <div class="image-list">
          <button
            v-for="image in capturedImages"
            :key="image.id"
            type="button"
            :class="{ selected: image.id === selectedImageId }"
            @click="selectedImageId = image.id"
          >
            <span>{{ image.label }}</span>
            <small>{{ image.width }} × {{ image.height }}</small>
          </button>
        </div>
      </section>
    </template>

    <template v-else>
      <section class="preview-section">
        <div class="preview-frame">
          <img :src="sampleImage.previewUrl" :alt="sampleImage.label" />
        </div>
      </section>

      <section class="insert-panel">
        <button type="button" :disabled="busy" @click="insertFullCanvas">
          插入到全图
        </button>

        <button type="button" :disabled="busy" @click="insertAtSelection">
          插入到选区位置
        </button>

        <div class="rect-grid">
          <label>
            X
            <input v-model.number="rect.left" type="number" step="1" />
          </label>
          <label>
            Y
            <input v-model.number="rect.top" type="number" step="1" />
          </label>
          <label>
            W
            <input v-model.number="rect.width" type="number" min="1" step="1" />
          </label>
          <label>
            H
            <input v-model.number="rect.height" type="number" min="1" step="1" />
          </label>
        </div>

        <button type="button" :disabled="busy" @click="insertAtRect(rect)">
          插入到指定位置
        </button>
      </section>
    </template>
  </main>
</template>

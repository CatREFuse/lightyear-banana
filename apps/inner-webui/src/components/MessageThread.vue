<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import type { HostAssetRef } from '@lightyear-banana/inner-protocol'
import { toHostAssetPointer } from '@lightyear-banana/inner-protocol'
import { useWorkspaceStore, type ChatTurn } from '@/stores/workspace'

const store = useWorkspaceStore()
const preview = ref<HostAssetRef | null>(null)
const notice = ref('')
const thread = ref<HTMLElement | null>(null)
const failedImages = reactive<Record<string, boolean>>({})
const reloads = reactive<Record<string, number>>({})
let noticeTimer: ReturnType<typeof setTimeout> | undefined

function showNotice(message: string) {
  notice.value = message
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => notice.value = '', 3200)
}

async function place(assetId: string) {
  try {
    const result = await store.place(assetId)
    showNotice(`已置入「${result.layerName}」`)
  } catch {
    showNotice('无法置入图片，请重试')
  }
}

async function placeTarget(assetId: string, target: 'original-size' | 'full-canvas' | 'current-selection') {
  try {
    const result = await store.place(assetId, target)
    showNotice(`已置入「${result.layerName}」`)
  } catch (reason) {
    showNotice(reason instanceof Error ? reason.message : '无法置入图片，请重试')
  }
}

async function placeReference(assetId: string, reference: HostAssetRef) {
  try {
    const result = await store.placeToReference(assetId, reference)
    showNotice(`已置入「${result.layerName}」`)
  } catch (reason) {
    showNotice(reason instanceof Error ? reason.message : '无法置入参考选区')
  }
}

async function save(assetId: string) {
  try {
    const result = await store.save(assetId)
    if (result.saved) showNotice('图片已保存')
  } catch (reason) {
    showNotice(reason instanceof Error ? reason.message : '无法保存图片')
  }
}

async function retry(turn: ChatTurn) {
  try {
    await store.retry(turn)
  } catch (reason) {
    showNotice(reason instanceof Error ? reason.message : '无法重新生成')
  }
}

function phaseLabel(phase: ChatTurn['phase']) {
  return ({ waiting: '准备中', uploading: '正在上传', requesting: '正在生成', polling: '正在等待', downloading: '正在下载', retrying: '正在重试', completed: '已完成', failed: '失败', cancelled: '已取消' })[phase]
}

function edit(turn: ChatTurn) {
  window.dispatchEvent(new CustomEvent('reuse-generation', { detail: { snapshot: turn.snapshot, references: turn.references } }))
}

function upscale(turn: ChatTurn, asset: HostAssetRef) {
  const reference = { ...asset, source: 'generated' as const }
  window.dispatchEvent(new CustomEvent('reuse-generation', {
    detail: {
      snapshot: {
        ...turn.snapshot,
        prompt: '放大图像并增强细节，保持原有构图和风格',
        references: [toHostAssetPointer(reference)],
        size: '4K',
        count: 1,
        submittedAt: new Date().toISOString()
      },
      references: [reference]
    }
  }))
}

function configLabel(turn: ChatTurn) {
  const config = store.configs.find(item => item.id === turn.snapshot.configId)
  return config ? `${config.provider} · ${config.model}` : '原配置不可用'
}

function retryImage(assetId: string) {
  failedImages[assetId] = false
  reloads[assetId] = (reloads[assetId] || 0) + 1
}

function closeOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') preview.value = null
}

watch(
  () => store.turns.map(item => `${item.id}:${item.results.length}`).join('|'),
  async () => {
    const element = thread.value
    if (!element) return
    const shouldFollow = element.scrollHeight - element.scrollTop - element.clientHeight < 160
    await nextTick()
    if (shouldFollow) element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
  }
)

onMounted(() => window.addEventListener('keydown', closeOnEscape))
onUnmounted(() => {
  window.removeEventListener('keydown', closeOnEscape)
  clearTimeout(noticeTimer)
})
</script>

<template>
  <section ref="thread" class="message-thread" aria-live="polite">
    <div v-if="!store.turns.length" class="empty-state">
      <div class="empty-orb">◒</div>
      <h1>从一个想法开始</h1>
      <p>添加参考图，或直接描述你想要的画面。</p>
    </div>

    <article v-for="turn in store.turns" :key="turn.id" class="turn-card">
      <div class="turn-copy">
        <p>{{ turn.prompt }}</p>
        <small>{{ configLabel(turn) }} · {{ turn.snapshot.size }} · {{ turn.snapshot.ratio }} · {{ turn.snapshot.count }} 张<span v-if="turn.elapsed"> · {{ turn.elapsed }} 秒</span></small>
        <span class="turn-buttons">
          <button type="button" @click="edit(turn)">编辑请求</button>
          <button v-if="turn.status === 'completed'" type="button" :disabled="!store.canRetryTurn(turn)" :title="store.canRetryTurn(turn) ? '' : '参考图已失效，请编辑后重新选择'" @click="retry(turn)">追加生成</button>
        </span>
      </div>

      <div v-if="turn.references.length" class="sent-references">
        <img v-for="reference in turn.references" :key="reference.assetId" :src="reference.thumbnailUrl || reference.previewUrl" :alt="reference.label" loading="lazy" />
      </div>
      <p v-if="!store.canRetryTurn(turn)" class="asset-missing">参考图已失效，请编辑请求并重新选择。</p>

      <div v-if="turn.status === 'running'" class="task-state">
        <span class="spinner" />{{ phaseLabel(turn.phase) }} <small>{{ turn.elapsed }} 秒</small>
        <button type="button" @click="store.cancel(turn)">取消</button>
      </div>
      <div v-if="turn.status === 'failed'" class="task-error"><strong>{{ turn.error || '生成失败' }}</strong><button type="button" :disabled="!store.canRetryTurn(turn)" @click="retry(turn)">重试</button></div>
      <div v-if="turn.status === 'cancelled'" class="task-error"><strong>已取消生成</strong><button type="button" :disabled="!store.canRetryTurn(turn)" @click="retry(turn)">再次生成</button></div>

      <div v-if="turn.results.length" class="result-grid">
        <section v-for="asset in turn.results" :key="asset.assetId" class="result-card">
          <div class="result-image">
            <span v-if="failedImages[asset.assetId]" class="image-fallback">图片加载失败<button type="button" @click="retryImage(asset.assetId)">重新加载</button></span>
            <button v-else type="button" :aria-label="`预览 ${asset.label}`" :disabled="asset.status === 'missing'" @click="preview = asset">
              <img :key="`${asset.assetId}-${reloads[asset.assetId] || 0}`" :src="asset.thumbnailUrl || asset.previewUrl" :alt="asset.label" loading="lazy" @error="failedImages[asset.assetId] = true" />
            </button>
          </div>
          <p v-if="asset.status === 'missing'" class="asset-missing">图片已失效</p>
          <div class="result-actions">
            <details class="placement-menu">
              <summary>置入方式</summary>
              <div class="placement-options">
                <button type="button" :disabled="asset.status === 'missing'" @click="place(asset.assetId)">默认</button>
                <button type="button" :disabled="asset.status === 'missing'" @click="placeTarget(asset.assetId, 'original-size')">原始尺寸</button>
                <button type="button" :disabled="asset.status === 'missing'" @click="placeTarget(asset.assetId, 'full-canvas')">全画布</button>
                <button type="button" :disabled="asset.status === 'missing'" @click="placeTarget(asset.assetId, 'current-selection')">当前选区</button>
                <button v-for="reference in turn.references.filter(item => item.sourceBounds)" :key="reference.assetId" type="button" :disabled="asset.status === 'missing' || reference.status === 'missing'" @click="placeReference(asset.assetId, reference)">参考选区 · {{ reference.label }}</button>
              </div>
            </details>
            <button type="button" :disabled="asset.status === 'missing'" @click="save(asset.assetId)">保存</button>
            <button type="button" :disabled="asset.status === 'missing'" @click="store.addResultAsReference(asset)">参考</button>
            <button type="button" :disabled="asset.status === 'missing'" @click="upscale(turn, asset)">超分</button>
          </div>
        </section>
      </div>

      <details v-if="turn.logs.length" class="request-logs">
        <summary>请求记录</summary>
        <p v-for="log in turn.logs" :key="log.id">{{ log.method }} · {{ log.status }} · {{ log.durationMs }}ms</p>
      </details>
    </article>

    <div v-if="notice" class="toast" role="status">{{ notice }}</div>
    <div v-if="preview" class="modal-backdrop" @click.self="preview = null">
      <section class="image-modal" role="dialog" aria-modal="true" aria-label="图片预览">
        <button class="modal-close" type="button" aria-label="关闭预览" @click="preview = null">×</button>
        <img :src="preview.thumbnailUrl || preview.previewUrl" :alt="preview.label" />
        <div><strong>{{ preview.label }}</strong><button type="button" @click="save(preview!.assetId)">保存</button></div>
      </section>
    </div>
  </section>
</template>

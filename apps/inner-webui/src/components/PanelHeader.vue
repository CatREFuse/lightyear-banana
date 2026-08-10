<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useWorkspaceStore } from '@/stores/workspace'

const store = useWorkspaceStore(); const router = useRouter()
const documentLabel = computed(() => store.context?.document?.name || '没有打开文档')
</script>

<template>
  <header class="panel-header">
    <button class="brand" type="button" aria-label="返回工作台" @click="router.push('/workspace')"><span class="banana">◒</span><span>Lightyear Banana</span></button>
    <div class="host-status" :title="documentLabel"><span class="status-dot" />{{ documentLabel }}</div>
    <span v-if="store.isPreview" class="preview-badge">预览模式</span>
    <select class="theme-picker" :value="store.theme" aria-label="主题" @change="store.setTheme(($event.target as HTMLSelectElement).value as 'dark' | 'light' | 'system')"><option value="system">跟随系统</option><option value="dark">深色</option><option value="light">浅色</option></select>
    <button class="icon-button" type="button" aria-label="设置" @click="router.push('/settings')">⚙</button>
  </header>
</template>

<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { RouterView } from 'vue-router'
import { useWorkspaceStore } from '@/stores/workspace'

const store = useWorkspaceStore()
onMounted(store.initialize)
watch(() => store.resolvedTheme, value => document.documentElement.dataset.theme = value, { immediate: true })
</script>

<template>
  <main class="app-shell">
    <section v-if="store.status === 'loading'" class="startup"><span class="spinner" />正在打开 Mugen</section>
    <section v-else-if="store.status === 'incompatible'" class="startup"><strong>Mugen 插件需要更新</strong><button type="button" @click="store.openReleasePage">查看更新</button></section>
    <section v-else-if="store.status === 'error'" class="startup"><strong>{{ store.error }}</strong><button v-if="store.host.mode !== 'unavailable'" type="button" @click="store.initialize">重试</button></section>
    <RouterView v-else />
  </main>
</template>

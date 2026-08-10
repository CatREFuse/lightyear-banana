<script setup lang="ts">
import { useWorkspaceStore } from '@/stores/workspace'
import PanelHeader from '@/components/PanelHeader.vue'
import MessageThread from '@/components/MessageThread.vue'
import ComposerDock from '@/components/ComposerDock.vue'
const store = useWorkspaceStore()
async function clearHistory() { if (window.confirm('清除全部对话记录？')) await store.clearHistory() }
</script>

<template><section class="panel"><PanelHeader /><div class="workspace-tools"><span v-if="store.error" role="alert">{{ store.error }}</span><button type="button" :disabled="!store.turns.length" @click="clearHistory">清除记录</button></div><MessageThread /><ComposerDock /></section></template>

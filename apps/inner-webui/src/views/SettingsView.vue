<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { PROTOCOL_VERSION } from '@lightyear-banana/inner-protocol'
import PanelHeader from '@/components/PanelHeader.vue'
import { LOCAL_DATA_TYPES, confirmAndClearLocalData } from '@/localData'
import { useWorkspaceStore } from '@/stores/workspace'
const store = useWorkspaceStore(); const router = useRouter()
const webVersion = __WEBUI_VERSION__; const buildCommit = __BUILD_COMMIT__
async function exportDiagnostics() { if (!window.confirm('诊断文件包含版本、错误代码、操作阶段和耗时。继续导出？')) return; try { const result = await store.host.exportDiagnostics(); if (result.saved) window.alert('诊断文件已保存') } catch (reason) { window.alert(reason instanceof Error ? reason.message : '无法导出诊断文件') } }
const clearingLocalData = ref(false)
const localDataTypes = LOCAL_DATA_TYPES
async function clearLocalData() {
  clearingLocalData.value = true
  try {
    const result = await confirmAndClearLocalData((message) => window.confirm(message), () => store.clearLocalData())
    if (result) window.alert('本地数据已清除')
  } catch (reason) {
    window.alert(reason instanceof Error ? reason.message : '无法清除本地数据')
  } finally {
    clearingLocalData.value = false
  }
}
</script>

<template>
  <section class="panel">
    <PanelHeader />
    <main class="settings-page">
      <div class="page-heading">
        <div><h1>模型配置</h1><p>密钥仅保存在 Photoshop 插件中。</p></div>
        <button class="primary-button" type="button" @click="router.push('/settings/new')">新建配置</button>
      </div>
      <section class="config-list">
        <button v-for="config in store.configs" :key="config.id" class="config-row" type="button" @click="router.push(`/settings/${config.id}`)">
          <span class="config-mark">{{ config.name.slice(0, 1) }}</span>
          <span><strong>{{ config.name }}</strong><small>{{ config.provider }} · {{ config.model }}</small></span>
          <span :class="['config-state', { active: config.enabled }]">{{ config.enabled ? '已启用' : '已停用' }}</span><span>›</span>
        </button>
      </section>
      <section class="settings-extra">
        <div><strong>版本</strong><small>WebUI {{ webVersion }} · CCX {{ store.context?.hostVersion }} · 协议 {{ PROTOCOL_VERSION }}</small><small>Photoshop {{ store.context?.photoshopVersion }}<template v-if="store.context?.uxpVersion"> · UXP {{ store.context.uxpVersion }}</template><template v-if="buildCommit !== 'local'"> · {{ buildCommit.slice(0, 8) }}</template></small></div>
        <button type="button" @click="exportDiagnostics">导出诊断</button>
      </section>
      <section class="settings-extra local-data-card">
        <div><strong>本地数据</strong><small>{{ localDataTypes.join('、') }}</small></div>
        <button class="danger-button" type="button" :disabled="clearingLocalData" @click="clearLocalData">{{ clearingLocalData ? '正在清除' : '清除全部' }}</button>
      </section>
    </main>
  </section>
</template>

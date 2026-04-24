<script setup lang="ts">
defineProps<{
  documentLabel: string
  inSettings: boolean
  status: string
}>()

const emit = defineEmits<{
  back: []
  openSettings: []
  refresh: []
}>()
</script>

<template>
  <header class="panel-header">
    <div class="title-block">
      <button v-if="inSettings" class="icon-button" type="button" @click="emit('back')">返回</button>
      <h1>{{ inSettings ? '设置' : 'Lightyear Banana v0.1' }}</h1>
    </div>

    <div class="header-actions">
      <button v-if="!inSettings" class="icon-button" type="button" @click="emit('openSettings')">设置</button>
      <button class="icon-button" type="button" @click="emit('refresh')">刷新</button>
    </div>
  </header>

  <section v-if="!inSettings" class="runtime-strip" aria-label="运行状态">
    <span>{{ status }}</span>
    <strong>{{ documentLabel }}</strong>
  </section>
</template>

<style scoped>
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 12px 8px;
  border-bottom: 1px solid var(--lb-border);
  background: var(--lb-bg);
}

.title-block,
.header-actions {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

h1 {
  overflow: hidden;
  margin: 0;
  color: var(--lb-text);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icon-button {
  min-height: 28px;
  padding: 0 9px;
  border-color: var(--lb-border);
  background: var(--lb-surface);
  color: var(--lb-muted);
  font-size: 12px;
}

.icon-button:hover {
  border-color: var(--lb-border-strong);
  background: var(--lb-surface-2);
  color: var(--lb-text);
}

.runtime-strip {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 8px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--lb-border);
  background: #111317;
  color: var(--lb-muted);
  font-size: 11px;
}

.runtime-strip strong {
  overflow: hidden;
  color: var(--lb-secondary);
  font-weight: 500;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>

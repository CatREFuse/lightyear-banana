<script setup lang="ts">
import { ref } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace'
const store = useWorkspaceStore(); const menuOpen = ref(false)
const items = [{ id: 'visible', label: '可见图层' }, { id: 'selection', label: '当前选区' }, { id: 'layer', label: '当前图层' }, { id: 'upload', label: '上传图片' }, { id: 'clipboard', label: '剪贴板图片' }] as const
function choose(id: typeof items[number]['id']) { menuOpen.value = false; store.addReference(id) }
</script>

<template>
  <section class="reference-strip" aria-label="参考图">
    <article v-for="reference in store.references" :key="reference.assetId" class="reference-thumb" :class="{ unavailable: reference.status === 'missing' }"><img :src="reference.thumbnailUrl || reference.previewUrl" :alt="reference.label" /><span>{{ reference.label }}</span><button type="button" :aria-label="`移除 ${reference.label}`" @click="store.removeReference(reference.assetId)">×</button></article>
    <div class="reference-add"><button type="button" :disabled="!store.canAddReference" aria-label="添加参考图" @click="menuOpen = !menuOpen">＋</button><div v-if="menuOpen" class="reference-menu"><button v-for="item in items" :key="item.id" type="button" @click="choose(item.id)">{{ item.label }}</button></div></div>
    <small>{{ store.references.length }}/{{ store.currentCapability.referenceLimit }}</small><button v-if="store.references.length" class="clear-references" type="button" @click="store.clearReferences">清空</button>
  </section>
</template>

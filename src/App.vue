<script setup lang="ts">
import LightyearPanel from './components/lightyear/LightyearPanel.vue'

type RuntimeName = 'browser' | 'photoshop-uxp'

const props = withDefaults(
  defineProps<{
    runtime?: RuntimeName
  }>(),
  {
    runtime: 'browser'
  }
)
</script>

<template>
  <main class="app-preview-shell" :class="{ 'is-plugin-preview': props.runtime === 'browser' }">
    <div class="plugin-preview-frame">
      <LightyearPanel :runtime="props.runtime" />
    </div>
  </main>
</template>

<style scoped>
.app-preview-shell {
  width: 100%;
  height: 100%;
  min-height: 100%;
}

.plugin-preview-frame {
  width: 100%;
  height: 100%;
  min-height: 0;
}

.app-preview-shell.is-plugin-preview {
  display: flex;
  justify-content: center;
  overflow: hidden;
  padding: 24px;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px),
    linear-gradient(rgba(255, 255, 255, 0.035) 1px, transparent 1px),
    #0f1115;
  background-size: 28px 28px;
}

.is-plugin-preview .plugin-preview-frame {
  width: min(100%, 390px);
  height: 100%;
  overflow: hidden;
  border: 1px solid var(--lb-border);
  border-radius: 10px;
  background: var(--lb-bg);
  box-shadow: 0 22px 70px rgba(0, 0, 0, 0.46);
}

@media (max-width: 430px) {
  .app-preview-shell.is-plugin-preview {
    padding: 0;
  }

  .is-plugin-preview .plugin-preview-frame {
    width: 100%;
    border-width: 0;
    border-radius: 0;
  }
}
</style>

import { computed, shallowRef } from 'vue'
import { createNamedLayer, getHostRequire, readActiveDocumentLabel } from '../uxp/photoshopHost'

type RuntimeName = 'browser' | 'photoshop-uxp'

export function usePhotoshopProbe(runtime: RuntimeName) {
  const status = shallowRef(runtime === 'photoshop-uxp' ? 'Photoshop UXP' : '浏览器预览')
  const documentLabel = shallowRef(readActiveDocumentLabel())
  const busy = shallowRef(false)

  const canUsePhotoshop = computed(() => runtime === 'photoshop-uxp' && Boolean(getHostRequire()))

  function refreshDocument() {
    documentLabel.value = readActiveDocumentLabel()
    status.value = canUsePhotoshop.value ? 'Photoshop 已连接' : '浏览器预览'
  }

  async function createLayer() {
    const hostRequire = getHostRequire()
    if (!hostRequire) {
      status.value = '浏览器预览'
      return
    }

    busy.value = true
    try {
      await createNamedLayer()
      status.value = '图层已创建'
      refreshDocument()
    } catch (error) {
      status.value = error instanceof Error ? error.message : '操作失败'
    } finally {
      busy.value = false
    }
  }

  refreshDocument()

  return {
    busy,
    canUsePhotoshop,
    documentLabel,
    status,
    createLayer,
    refreshDocument
  }
}

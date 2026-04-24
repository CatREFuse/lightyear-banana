import { computed, shallowRef } from 'vue'
import type { CapturedCanvasImage } from '../uxp/canvasPrimitives'
import { canvasPrimitiveService, type CanvasInsertTarget } from '../uxp/canvasPrimitiveService'
import { getHostRequire, readActiveDocumentLabel } from '../uxp/photoshopHost'

type RuntimeName = 'browser' | 'photoshop-uxp'

export type InsertRect = CanvasInsertTarget

function createBrowserImage(kind: 'visible' | 'selection' | 'layer'): CapturedCanvasImage {
  const width = kind === 'visible' ? 640 : kind === 'selection' ? 320 : 420
  const height = kind === 'visible' ? 420 : kind === 'selection' ? 240 : 300
  const rgba = new Uint8Array(width * height * 4)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const stripe = Math.floor((x + y) / 34) % 2

      rgba[index] = kind === 'visible' ? 64 + stripe * 80 : kind === 'selection' ? 84 : 218 - stripe * 36
      rgba[index + 1] = kind === 'visible' ? 120 : kind === 'selection' ? 166 - stripe * 40 : 122
      rgba[index + 2] = kind === 'visible' ? 210 - stripe * 70 : kind === 'selection' ? 238 : 88 + stripe * 20
      rgba[index + 3] = 255
    }
  }

  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="${kind === 'visible' ? '#3d7edc' : kind === 'selection' ? '#5f6df3' : '#da7a58'}"/>
          <stop offset="1" stop-color="${kind === 'visible' ? '#1f2633' : kind === 'selection' ? '#21a69a' : '#2b3442'}"/>
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <text x="24" y="48" fill="white" font-size="22" font-family="Arial">${kind === 'visible' ? 'Visible preview' : kind === 'selection' ? 'Selection preview' : 'Layer preview'}</text>
    </svg>`
  )

  return {
    id: `browser-${kind}-${Date.now()}`,
    label: kind === 'visible' ? '浏览器可见图像' : kind === 'selection' ? '浏览器选区图像' : '浏览器选中图层',
    width,
    height,
    sourceBounds: {
      left: 0,
      top: 0,
      right: width,
      bottom: height
    },
    previewUrl: `data:image/svg+xml;charset=utf-8,${svg}`,
    rgba
  }
}

export function useCanvasProbe(runtime: RuntimeName) {
  const status = shallowRef(runtime === 'photoshop-uxp' ? 'Photoshop UXP' : '浏览器预览')
  const documentLabel = shallowRef(readActiveDocumentLabel())
  const busy = shallowRef(false)
  const capturedImages = shallowRef<CapturedCanvasImage[]>([])
  const sampleImage = shallowRef(canvasPrimitiveService.createSampleImage())
  const selectedImageId = shallowRef('')
  const lastInsert = shallowRef('')

  const canUsePhotoshop = computed(() => runtime === 'photoshop-uxp' && Boolean(getHostRequire()))
  const selectedImage = computed(
    () => capturedImages.value.find((image) => image.id === selectedImageId.value) ?? capturedImages.value[0] ?? null
  )

  function refreshDocument() {
    documentLabel.value = readActiveDocumentLabel()
    status.value = canUsePhotoshop.value ? 'Photoshop 已连接' : '浏览器预览'
  }

  function addImage(image: CapturedCanvasImage) {
    capturedImages.value = [image, ...capturedImages.value].slice(0, 6)
    selectedImageId.value = image.id
  }

  async function runAction(action: () => Promise<void>) {
    busy.value = true
    try {
      await action()
      refreshDocument()
    } catch (error) {
      status.value = error instanceof Error ? error.message : '操作失败'
    } finally {
      busy.value = false
    }
  }

  async function captureVisible() {
    await runAction(async () => {
      const image = canUsePhotoshop.value ? await canvasPrimitiveService.captureVisibleImage() : createBrowserImage('visible')
      addImage(image)
      status.value = '已抓取可见图像'
    })
  }

  async function captureSelection() {
    await runAction(async () => {
      const image = canUsePhotoshop.value ? await canvasPrimitiveService.captureSelectionImage() : createBrowserImage('selection')
      addImage(image)
      status.value = '已抓取选区图像'
    })
  }

  async function captureLayer() {
    await runAction(async () => {
      const image = canUsePhotoshop.value ? await canvasPrimitiveService.captureSelectedLayerImage() : createBrowserImage('layer')
      addImage(image)
      status.value = '已抓取选中图层'
    })
  }

  async function insertFullCanvas() {
    const image = sampleImage.value

    await runAction(async () => {
      if (!canUsePhotoshop.value) {
        lastInsert.value = `${image.width} × ${image.height}`
        status.value = '浏览器预览'
        return
      }

      const result = await canvasPrimitiveService.insertImageToFullCanvas(image)

      lastInsert.value = `${result.left}, ${result.top}, ${result.width} × ${result.height}`
      status.value = '已插入到全图'
    })
  }

  async function insertAtRect(rect: InsertRect) {
    const image = sampleImage.value

    await runAction(async () => {
      const width = rect.width > 0 ? rect.width : image.width
      const height = rect.height > 0 ? rect.height : image.height

      if (!canUsePhotoshop.value) {
        lastInsert.value = `${rect.left}, ${rect.top}, ${width} × ${height}`
        status.value = '浏览器预览'
        return
      }

      const result = await canvasPrimitiveService.insertImage(image, {
        left: rect.left,
        top: rect.top,
        width,
        height
      })

      lastInsert.value = `${result.left}, ${result.top}, ${result.width} × ${result.height}`
      status.value = '已插入到指定位置'
    })
  }

  async function insertAtSelection() {
    const image = sampleImage.value

    await runAction(async () => {
      if (!canUsePhotoshop.value) {
        lastInsert.value = `80, 80, ${image.width} × ${image.height}`
        status.value = '浏览器预览'
        return
      }

      const result = await canvasPrimitiveService.insertImageToSelection(image)

      lastInsert.value = `${result.left}, ${result.top}, ${result.width} × ${result.height}`
      status.value = '已插入到选区位置'
    })
  }

  refreshDocument()

  return {
    busy,
    canUsePhotoshop,
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
  }
}

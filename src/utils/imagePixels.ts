import type { CapturedCanvasImage } from '../uxp/canvasPrimitives'

export type ApiImageAsset = {
  id: string
  label: string
  modelConfigId: string
  previewUrl: string
}

const fallbackSize = {
  width: 1024,
  height: 1024
}

function createTransparentRgba(width: number, height: number) {
  return new Uint8Array(width * height * 4)
}

function loadImage(previewUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = previewUrl
  })
}

async function readImagePixels(previewUrl: string) {
  const image = await loadImage(previewUrl)
  const width = image.naturalWidth || fallbackSize.width
  const height = image.naturalHeight || fallbackSize.height
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) {
    return {
      width,
      height,
      rgba: createTransparentRgba(width, height)
    }
  }

  context.drawImage(image, 0, 0, width, height)
  const imageData = context.getImageData(0, 0, width, height)

  return {
    width,
    height,
    rgba: new Uint8Array(imageData.data)
  }
}

export async function createCanvasImageFromApiAsset(asset: ApiImageAsset) {
  try {
    const pixels = await readImagePixels(asset.previewUrl)

    return {
      id: asset.id,
      label: asset.label,
      width: pixels.width,
      height: pixels.height,
      sourceBounds: {
        left: 0,
        top: 0,
        right: pixels.width,
        bottom: pixels.height
      },
      previewUrl: asset.previewUrl,
      rgba: pixels.rgba,
      modelConfigId: asset.modelConfigId
    } satisfies CapturedCanvasImage & { modelConfigId: string }
  } catch {
    return {
      id: asset.id,
      label: asset.label,
      width: fallbackSize.width,
      height: fallbackSize.height,
      sourceBounds: {
        left: 0,
        top: 0,
        right: fallbackSize.width,
        bottom: fallbackSize.height
      },
      previewUrl: asset.previewUrl,
      rgba: createTransparentRgba(fallbackSize.width, fallbackSize.height),
      modelConfigId: asset.modelConfigId
    } satisfies CapturedCanvasImage & { modelConfigId: string }
  }
}

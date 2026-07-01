import type { CapturedCanvasImage } from '../uxp/canvasPrimitives'

export type ApiImageAsset = {
  id: string
  label: string
  modelConfigId: string
  modelName: string
  previewUrl: string
}

type PixelTarget = {
  width: number
  height: number
}

const fallbackSize = {
  width: 1024,
  height: 1024
}

function isRemoteImageUrl(value: string) {
  return /^https?:\/\//i.test(value)
}

function canUseObjectUrl() {
  return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && typeof URL.revokeObjectURL === 'function'
}

function loadImage(previewUrl: string, useCrossOrigin = false) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    if (useCrossOrigin) {
      image.crossOrigin = 'anonymous'
    }
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片加载失败'))
    image.src = previewUrl
  })
}

async function loadImageFromFetchedBlob(previewUrl: string) {
  if (!canUseObjectUrl()) {
    throw new Error('当前环境无法创建图片缓存')
  }

  const response = await fetch(previewUrl)
  if (!response.ok) {
    throw new Error('图片下载失败')
  }

  const objectUrl = URL.createObjectURL(await response.blob())
  try {
    return {
      image: await loadImage(objectUrl),
      dispose: () => URL.revokeObjectURL(objectUrl)
    }
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }
}

async function loadReadableImage(previewUrl: string) {
  if (isRemoteImageUrl(previewUrl)) {
    try {
      return await loadImageFromFetchedBlob(previewUrl)
    } catch {
      return {
        image: await loadImage(previewUrl, true),
        dispose: () => {}
      }
    }
  }

  return {
    image: await loadImage(previewUrl),
    dispose: () => {}
  }
}

async function readImageDimensions(previewUrl: string) {
  let loaded: { image: HTMLImageElement; dispose: () => void }
  try {
    loaded = await loadReadableImage(previewUrl)
  } catch (error) {
    if (!isRemoteImageUrl(previewUrl)) {
      throw error
    }

    loaded = {
      image: await loadImage(previewUrl),
      dispose: () => {}
    }
  }

  try {
    const width = loaded.image.naturalWidth || fallbackSize.width
    const height = loaded.image.naturalHeight || fallbackSize.height

    return { width, height }
  } finally {
    loaded.dispose()
  }
}

async function readImagePixels(previewUrl: string, target?: PixelTarget) {
  const loaded = await loadReadableImage(previewUrl)
  try {
    const width = Math.max(1, Math.round(target?.width ?? loaded.image.naturalWidth ?? fallbackSize.width))
    const height = Math.max(1, Math.round(target?.height ?? loaded.image.naturalHeight ?? fallbackSize.height))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('当前环境无法读取图片像素')
    }

    context.drawImage(loaded.image, 0, 0, width, height)
    const imageData = context.getImageData(0, 0, width, height)

    return {
      width,
      height,
      rgba: new Uint8Array(imageData.data)
    }
  } finally {
    loaded.dispose()
  }
}

export async function createCanvasImageFromApiAsset(asset: ApiImageAsset) {
  try {
    const dimensions = await readImageDimensions(asset.previewUrl)

    return {
      id: asset.id,
      label: asset.label,
      width: dimensions.width,
      height: dimensions.height,
      sourceBounds: {
        left: 0,
        top: 0,
        right: dimensions.width,
        bottom: dimensions.height
      },
      previewUrl: asset.previewUrl,
      rgba: new Uint8Array(),
      modelConfigId: asset.modelConfigId,
      modelName: asset.modelName
    } satisfies CapturedCanvasImage & { modelConfigId: string; modelName: string }
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
      rgba: new Uint8Array(),
      modelConfigId: asset.modelConfigId,
      modelName: asset.modelName
    } satisfies CapturedCanvasImage & { modelConfigId: string; modelName: string }
  }
}

export async function hydrateCanvasImagePixels<T extends CapturedCanvasImage>(image: T, target?: PixelTarget): Promise<T> {
  const width = Math.max(1, Math.round(target?.width ?? image.width))
  const height = Math.max(1, Math.round(target?.height ?? image.height))
  const expectedBytes = width * height * 4

  if (image.rgba.length === expectedBytes && image.width === width && image.height === height) {
    return image
  }

  try {
    const pixels = await readImagePixels(image.previewUrl, { width, height })

    return {
      ...image,
      width: pixels.width,
      height: pixels.height,
      sourceBounds: {
        left: 0,
        top: 0,
        right: pixels.width,
        bottom: pixels.height
      },
      rgba: pixels.rgba
    }
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : '图片像素读取失败')
  }
}

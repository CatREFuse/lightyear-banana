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

async function readImageDimensions(previewUrl: string) {
  const image = await loadImage(previewUrl)
  const width = image.naturalWidth || fallbackSize.width
  const height = image.naturalHeight || fallbackSize.height

  return { width, height }
}

async function readImagePixels(previewUrl: string, target?: PixelTarget) {
  const image = await loadImage(previewUrl)
  const width = Math.max(1, Math.round(target?.width ?? image.naturalWidth ?? fallbackSize.width))
  const height = Math.max(1, Math.round(target?.height ?? image.naturalHeight ?? fallbackSize.height))
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
  } catch {
    return {
      ...image,
      width,
      height,
      sourceBounds: {
        left: 0,
        top: 0,
        right: width,
        bottom: height
      },
      rgba: createTransparentRgba(width, height)
    }
  }
}

import type { CapturedCanvasImage } from '../types/canvas'

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

function readBase64DataUrlBytes(value: string) {
  const match = /^data:image\/[a-z0-9.+-]+(?:;[^,]*)?;base64,(.*)$/is.exec(value)
  if (!match) return undefined
  try {
    const binary = atob(match[1]!.replace(/\s/g, ''))
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return undefined
  }
}

function readUint32BigEndian(bytes: Uint8Array, offset: number) {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0
}

function readJpegDimensions(bytes: Uint8Array) {
  if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) return undefined
  const startOfFrameMarkers = new Set([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF])
  let offset = 2
  while (offset + 8 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xFF) offset += 1
    while (offset < bytes.length && bytes[offset] === 0xFF) offset += 1
    const marker = bytes[offset++]
    if (marker === undefined || marker === 0xD9 || marker === 0xDA) break
    if (marker === 0x01 || marker >= 0xD0 && marker <= 0xD7) continue
    if (offset + 1 >= bytes.length) break
    const segmentLength = (bytes[offset]! << 8) | bytes[offset + 1]!
    if (segmentLength < 2 || offset + segmentLength > bytes.length) break
    if (startOfFrameMarkers.has(marker)) {
      const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!
      const width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!
      if (width > 0 && height > 0) return { width, height }
      break
    }
    offset += segmentLength
  }
  return undefined
}

export function readImageByteDimensions(bytes: Uint8Array) {
  if (
    bytes.length >= 24
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47
    && bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A
  ) {
    const width = readUint32BigEndian(bytes, 16)
    const height = readUint32BigEndian(bytes, 20)
    if (width > 0 && height > 0) return { width, height }
  }
  if (
    bytes.length >= 10
    && String.fromCharCode(...bytes.subarray(0, 6)) === 'GIF87a'
    || bytes.length >= 10 && String.fromCharCode(...bytes.subarray(0, 6)) === 'GIF89a'
  ) {
    const width = bytes[6]! | (bytes[7]! << 8)
    const height = bytes[8]! | (bytes[9]! << 8)
    if (width > 0 && height > 0) return { width, height }
  }
  return readJpegDimensions(bytes)
}

export function readInlineImageDimensions(previewUrl: string) {
  const bytes = readBase64DataUrlBytes(previewUrl)
  return bytes ? readImageByteDimensions(bytes) : undefined
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
  const inlineDimensions = readInlineImageDimensions(asset.previewUrl)
  if (inlineDimensions) {
    return {
      id: asset.id,
      label: asset.label,
      width: inlineDimensions.width,
      height: inlineDimensions.height,
      sourceBounds: {
        left: 0,
        top: 0,
        right: inlineDimensions.width,
        bottom: inlineDimensions.height
      },
      previewUrl: asset.previewUrl,
      rgba: new Uint8Array(),
      modelConfigId: asset.modelConfigId,
      modelName: asset.modelName
    } satisfies CapturedCanvasImage & { modelConfigId: string; modelName: string }
  }
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

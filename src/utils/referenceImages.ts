import type { CapturedCanvasImage } from '../uxp/canvasPrimitives'

const imageMimeTypes: Record<string, string> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}

export function readImageMimeType(fileName: string, fallback = 'image/png') {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''

  return imageMimeTypes[extension] ?? fallback
}

export function readBlobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')))
    reader.addEventListener('error', () => reject(reader.error ?? new Error('无法读取图片')))
    reader.readAsDataURL(blob)
  })
}

export function readImageDimensions(previewUrl: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => {
      resolve({
        width: Math.max(1, Math.round(image.naturalWidth || image.width)),
        height: Math.max(1, Math.round(image.naturalHeight || image.height))
      })
    })
    image.addEventListener('error', () => reject(new Error('无法读取图片尺寸')))
    image.src = previewUrl
  })
}

export async function createReferenceCanvasImage(input: {
  idPrefix: string
  label: string
  previewUrl: string
  width?: number
  height?: number
}): Promise<CapturedCanvasImage> {
  const dimensions = input.width && input.height
    ? {
        width: Math.max(1, Math.round(input.width)),
        height: Math.max(1, Math.round(input.height))
      }
    : await readImageDimensions(input.previewUrl)

  return {
    id: `${input.idPrefix}-${Date.now()}`,
    label: input.label,
    width: dimensions.width,
    height: dimensions.height,
    sourceBounds: {
      left: 0,
      top: 0,
      right: dimensions.width,
      bottom: dimensions.height
    },
    previewUrl: input.previewUrl,
    rgba: new Uint8Array()
  }
}

export async function createReferenceImageFromBlob(blob: Blob, label: string, idPrefix: string) {
  return createReferenceCanvasImage({
    idPrefix,
    label,
    previewUrl: await readBlobAsDataUrl(blob)
  })
}

export function pickBrowserImageFile() {
  return new Promise<File | null>((resolve) => {
    const input = document.createElement('input')
    let settled = false

    function finish(file: File | null) {
      if (settled) {
        return
      }

      settled = true
      window.removeEventListener('focus', handleWindowFocus)
      input.remove()
      resolve(file)
    }

    function handleWindowFocus() {
      window.setTimeout(() => {
        if (!input.files?.length) {
          finish(null)
        }
      }, 250)
    }

    input.type = 'file'
    input.accept = 'image/png,image/jpeg,image/webp,image/gif'
    input.style.display = 'none'
    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => finish(null), { once: true })
    window.addEventListener('focus', handleWindowFocus, { once: true })
    document.body.appendChild(input)
    input.click()
  })
}

export async function pickBrowserReferenceImage() {
  const file = await pickBrowserImageFile()
  if (!file) {
    return null
  }

  return createReferenceImageFromBlob(file, `上传图片：${file.name}`, 'upload')
}

export async function readBrowserClipboardReferenceImage() {
  const clipboardApi = navigator.clipboard as Clipboard & {
    read?: () => Promise<ClipboardItem[]>
  }
  const items = await clipboardApi.read?.()
  if (!items?.length) {
    throw new Error('剪贴板里没有图片')
  }

  for (const item of items) {
    const type = item.types.find((itemType) => itemType.startsWith('image/'))
    if (!type) {
      continue
    }

    return createReferenceImageFromBlob(await item.getType(type), '剪贴板', 'clipboard')
  }

  throw new Error('剪贴板里没有图片')
}

import type { CapturedCanvasImage, ReferenceImage } from '@mugen/core'

const referenceJpegMaxEdge = 4096
const referenceJpegMaxBytes = 9 * 1024 * 1024
const referenceJpegMinQuality = 0.5
const referenceJpegQualityStep = 0.08
const referenceImportMaxBytes = 128 * 1024 * 1024
const referenceRequestDataUrlBudget = 22 * 1024 * 1024
const conversationThumbnailMaxEdge = 1024

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

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('无法压缩参考图'))
        return
      }

      resolve(blob)
    }, 'image/jpeg', quality)
  })
}

async function loadImage(previewUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.addEventListener('load', () => resolve(image))
    image.addEventListener('error', () => reject(new Error('无法读取图片')))
    image.src = previewUrl
  })
}

export async function createConversationThumbnail(previewUrl: string) {
  const image = await loadImage(previewUrl)
  const sourceWidth = Math.max(1, Math.round(image.naturalWidth || image.width))
  const sourceHeight = Math.max(1, Math.round(image.naturalHeight || image.height))
  const dimensions = readResizedDimensions(sourceWidth, sourceHeight, conversationThumbnailMaxEdge)
  if (dimensions.width === sourceWidth && dimensions.height === sourceHeight) {
    return { previewUrl, ...dimensions }
  }

  const canvas = document.createElement('canvas')
  canvas.width = dimensions.width
  canvas.height = dimensions.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法生成对话缩略图')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, dimensions.width, dimensions.height)
  context.drawImage(image, 0, 0, dimensions.width, dimensions.height)

  return {
    previewUrl: await readBlobAsDataUrl(await canvasToJpegBlob(canvas, 0.9)),
    ...dimensions
  }
}

function readResizedDimensions(width: number, height: number, maxEdge: number) {
  const cleanWidth = Math.max(1, Math.round(width))
  const cleanHeight = Math.max(1, Math.round(height))
  const scale = Math.min(1, maxEdge / Math.max(cleanWidth, cleanHeight))

  return {
    width: Math.max(1, Math.round(cleanWidth * scale)),
    height: Math.max(1, Math.round(cleanHeight * scale))
  }
}

async function compressReferencePreview(previewUrl: string, maxBytes = referenceJpegMaxBytes) {
  const image = await loadImage(previewUrl)
  let dimensions = readResizedDimensions(image.naturalWidth || image.width, image.naturalHeight || image.height, referenceJpegMaxEdge)
  let lastBlob: Blob | null = null

  for (let resizeAttempt = 0; resizeAttempt < 10; resizeAttempt += 1) {
    const canvas = document.createElement('canvas')
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('无法压缩参考图')
    }

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, dimensions.width, dimensions.height)
    context.drawImage(image, 0, 0, dimensions.width, dimensions.height)

    for (let quality = 0.9; quality >= referenceJpegMinQuality; quality -= referenceJpegQualityStep) {
      lastBlob = await canvasToJpegBlob(canvas, quality)
      if (lastBlob.size <= maxBytes) {
        return {
          previewUrl: await readBlobAsDataUrl(lastBlob),
          width: dimensions.width,
          height: dimensions.height
        }
      }
    }

    dimensions = readResizedDimensions(Math.round(dimensions.width * 0.85), Math.round(dimensions.height * 0.85), referenceJpegMaxEdge)
  }

  if (!lastBlob) {
    throw new Error('无法压缩参考图')
  }

  if (lastBlob.size > maxBytes) {
    throw new Error('参考图压缩后仍超过请求限制')
  }

  return {
    previewUrl: await readBlobAsDataUrl(lastBlob),
    width: dimensions.width,
    height: dimensions.height
  }
}

function isInlineReference(previewUrl: string) {
  return /^data:image\/[^;,]+;base64,/i.test(previewUrl)
}

export async function prepareBrowserReferencesForRequest(references: ReferenceImage[]) {
  const inlineReferences = references.filter((reference) => isInlineReference(reference.image.previewUrl))
  const currentDataUrlBytes = inlineReferences.reduce((total, reference) => total + reference.image.previewUrl.length, 0)
  if (currentDataUrlBytes <= referenceRequestDataUrlBudget) return references.map((reference) => ({ ...reference }))

  const maxJpegBytes = Math.min(
    referenceJpegMaxBytes,
    Math.floor(referenceRequestDataUrlBudget / inlineReferences.length * 0.75) - 256
  )
  const compressedById = new Map<string, string>()
  for (const reference of inlineReferences) {
    const compressed = await compressReferencePreview(reference.image.previewUrl, maxJpegBytes)
    compressedById.set(reference.id, compressed.previewUrl)
  }

  const prepared = references.map((reference) => {
    const previewUrl = compressedById.get(reference.id)
    if (!previewUrl) return { ...reference }
    return {
      ...reference,
      image: {
        ...reference.image,
        previewUrl
      }
    }
  })
  const preparedDataUrlBytes = prepared.reduce((total, reference) => (
    total + (isInlineReference(reference.image.previewUrl) ? reference.image.previewUrl.length : 0)
  ), 0)
  if (preparedDataUrlBytes > referenceRequestDataUrlBudget) throw new Error('参考图总大小超过请求限制')
  return prepared
}

export async function createReferenceCanvasImage(input: {
  idPrefix: string
  label: string
  previewUrl: string
  width?: number
  height?: number
}): Promise<CapturedCanvasImage> {
  const compressed = await compressReferencePreview(input.previewUrl)
  const dimensions = {
    width: compressed.width,
    height: compressed.height
  }

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
    previewUrl: compressed.previewUrl,
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

export async function createReferenceImportFromBlob(blob: Blob, name: string, source: 'upload' | 'clipboard') {
  if (blob.size > referenceImportMaxBytes) throw new Error('图片超过 128 MB，无法读取')
  const originalUrl = await readBlobAsDataUrl(blob)
  const image = await loadImage(originalUrl)
  let maxEdge = 256
  let thumbnailUrl = ''
  while (maxEdge >= 64) {
    const dimensions = readResizedDimensions(image.naturalWidth || image.width, image.naturalHeight || image.height, maxEdge)
    const canvas = document.createElement('canvas')
    canvas.width = dimensions.width
    canvas.height = dimensions.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法生成参考图预览')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, dimensions.width, dimensions.height)
    context.drawImage(image, 0, 0, dimensions.width, dimensions.height)
    thumbnailUrl = await readBlobAsDataUrl(await canvasToJpegBlob(canvas, 0.68))
    if (thumbnailUrl.length <= 16 * 1024) break
    maxEdge = Math.floor(maxEdge * 0.7)
  }
  if (!thumbnailUrl || thumbnailUrl.length > 16 * 1024) throw new Error('参考图预览过大')
  return {
    name,
    mimeType: blob.type || readImageMimeType(name),
    source,
    width: Math.max(1, Math.round(image.naturalWidth || image.width)),
    height: Math.max(1, Math.round(image.naturalHeight || image.height)),
    dataUrl: originalUrl,
    thumbnailUrl
  }
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

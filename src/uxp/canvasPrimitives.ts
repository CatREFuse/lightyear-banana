import { getHostRequire } from './photoshopHost'
import type { UxpDiagnosticTrace } from './diagnosticTrace'

export type PixelBounds = {
  left: number
  top: number
  right: number
  bottom: number
}

export type CapturedCanvasImage = {
  id: string
  label: string
  width: number
  height: number
  sourceBounds: PixelBounds
  previewUrl: string
  rgba: Uint8Array
}

type PhotoshopImageResult = {
  imageData: {
    width: number
    height: number
    components: number
    getData: () => Promise<Uint8Array | Uint16Array | Float32Array>
    dispose: () => void
  }
  sourceBounds: Partial<PixelBounds>
}

type PhotoshopDocument = {
  id: number
  name?: string
  title?: string
  width: unknown
  height: unknown
  mode?: unknown
  bitsPerChannel?: unknown
  activeLayers: PhotoshopLayer[]
  layers?: PhotoshopLayer[]
  duplicate?: (name?: string, mergeLayersOnly?: boolean) => Promise<PhotoshopDocument>
  mergeVisibleLayers?: () => Promise<void>
  closeWithoutSaving?: () => Promise<void> | void
  close?: (saveDialogOptions?: unknown) => Promise<void>
}

type PhotoshopRuntime = {
  action: {
    batchPlay: (commands: unknown[], options: Record<string, unknown>) => Promise<unknown[]>
  }
  app: {
    version?: string
    activeDocument: PhotoshopDocument
  }
  core: {
    executeAsModal: <T>(
      targetFunction: () => Promise<T>,
      options: { commandName: string; timeOut?: number }
    ) => Promise<T>
  }
  constants?: {
    AnchorPosition?: {
      TOPLEFT?: unknown
    }
    SaveOptions?: {
      DONOTSAVECHANGES?: unknown
    }
  }
  imaging: {
    getPixels: (options: Record<string, unknown>) => Promise<PhotoshopImageResult>
    getSelection: (options: Record<string, unknown>) => Promise<PhotoshopImageResult>
    createImageDataFromBuffer: (
      data: Uint8Array,
      options: Record<string, unknown>
    ) => Promise<PhotoshopImageResult['imageData']>
    encodeImageData: (options: Record<string, unknown>) => Promise<string>
    putPixels: (options: Record<string, unknown>) => Promise<void>
  }
}

const COLOR_PROFILE = 'sRGB IEC61966-2.1'

type PhotoshopLayer = {
  id: number
  name?: string
  bounds?: unknown
  boundsNoEffects?: unknown
  scale?: (widthPercent: number, heightPercent: number, anchor?: unknown) => Promise<void>
  translate?: (deltaX: number, deltaY: number) => Promise<void>
}

type UxpFile = {
  write: (data: Uint8Array, options?: Record<string, unknown>) => Promise<void>
  delete?: () => Promise<void>
}

type UxpFolder = {
  createFile: (name: string, options?: { overwrite?: boolean }) => Promise<UxpFile>
}

type UxpRuntime = {
  storage?: {
    formats?: {
      binary?: unknown
    }
    localFileSystem?: {
      createSessionToken?: (file: UxpFile) => string
      getTemporaryFolder?: () => Promise<UxpFolder>
    }
  }
}

type NormalizedInsertTarget = {
  left: number
  top: number
  width: number
  height: number
}

function getPhotoshop(): PhotoshopRuntime {
  const hostRequire = getHostRequire()
  if (!hostRequire) {
    throw new Error('Photoshop UXP runtime is unavailable.')
  }

  return hostRequire('photoshop') as PhotoshopRuntime
}

function getUxpRuntime(): UxpRuntime {
  const hostRequire = getHostRequire()
  if (!hostRequire) {
    throw new Error('Photoshop UXP runtime is unavailable.')
  }

  return hostRequire('uxp') as UxpRuntime
}

async function emitTrace(
  trace: UxpDiagnosticTrace | undefined,
  operation: string,
  phase: 'start' | 'progress' | 'success' | 'cancel' | 'error' | 'timeout',
  details?: Record<string, unknown>,
  error?: unknown
) {
  await trace?.emit(operation, phase, details, error)
}

function readTypedArrayDetails(data: Uint8Array | Uint16Array | Float32Array) {
  return {
    arrayType: data.constructor.name,
    byteLength: data.byteLength,
    bytesPerElement: data.BYTES_PER_ELEMENT,
    elementLength: data.length
  }
}

function countNonZeroBytes(data: Uint8Array) {
  let count = 0
  for (const value of data) {
    if (value > 0) {
      count += 1
    }
  }
  return count
}

async function executePhotoshopModal<T>(
  commandName: string,
  targetFunction: () => Promise<T>,
  trace?: UxpDiagnosticTrace
) {
  const photoshop = getPhotoshop()
  const startedAt = Date.now()
  await emitTrace(trace, 'photoshop.modal', 'start', { commandName, timeoutSeconds: 5 })
  try {
    const result = await photoshop.core.executeAsModal(targetFunction, { commandName, timeOut: 5 })
    await emitTrace(trace, 'photoshop.modal', 'success', { commandName, durationMs: Date.now() - startedAt })
    return result
  } catch (error) {
    await emitTrace(trace, 'photoshop.modal', 'error', { commandName, durationMs: Date.now() - startedAt }, error)
    throw error
  }
}

export function readCanvasDiagnosticContext() {
  const photoshop = getPhotoshop()
  const document = photoshop.app.activeDocument

  return {
    photoshopVersion: photoshop.app.version,
    document: {
      id: document.id,
      name: document.name ?? document.title ?? '',
      width: readCoordinate(document.width),
      height: readCoordinate(document.height),
      mode: String(document.mode ?? ''),
      bitsPerChannel: String(document.bitsPerChannel ?? ''),
      activeLayers: document.activeLayers.map((layer) => ({ id: layer.id, name: layer.name ?? '' }))
    }
  }
}

function getDocumentBounds(doc: { width: unknown; height: unknown }): PixelBounds {
  const width = Math.max(1, Math.round(readCoordinate(doc.width) ?? 1))
  const height = Math.max(1, Math.round(readCoordinate(doc.height) ?? 1))

  return {
    left: 0,
    top: 0,
    right: width,
    bottom: height
  }
}

function normalizeBounds(bounds: Partial<Record<keyof PixelBounds, unknown>>, fallback: PixelBounds): PixelBounds {
  return {
    left: Math.round(readCoordinate(bounds.left) ?? fallback.left),
    top: Math.round(readCoordinate(bounds.top) ?? fallback.top),
    right: Math.round(readCoordinate(bounds.right) ?? fallback.right),
    bottom: Math.round(readCoordinate(bounds.bottom) ?? fallback.bottom)
  }
}

function readCoordinate(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (value && typeof value === 'object') {
    const unitValue = (value as { _value?: unknown; value?: unknown })._value ?? (value as { value?: unknown }).value

    if (typeof unitValue === 'number' && Number.isFinite(unitValue)) {
      return unitValue
    }

    if (typeof unitValue === 'string') {
      const parsed = Number(unitValue)

      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
  }

  if (typeof value === 'string') {
    const parsed = Number(value)

    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

function normalizeUnknownBounds(bounds: unknown): PixelBounds | null {
  if (!bounds || typeof bounds !== 'object') {
    return null
  }

  const source = bounds as Partial<Record<keyof PixelBounds, unknown>>
  const left = readCoordinate(source.left)
  const top = readCoordinate(source.top)
  const right = readCoordinate(source.right)
  const bottom = readCoordinate(source.bottom)

  if (left === null || top === null || right === null || bottom === null) {
    return null
  }

  return {
    left: Math.round(left),
    top: Math.round(top),
    right: Math.round(right),
    bottom: Math.round(bottom)
  }
}

function intersectBounds(a: PixelBounds, b: PixelBounds): PixelBounds | null {
  const bounds = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom)
  }

  if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) {
    return null
  }

  return bounds
}

function getLayerSourceBounds(layer: PhotoshopLayer, documentBounds: PixelBounds) {
  const layerBounds = normalizeUnknownBounds(layer.boundsNoEffects) ?? normalizeUnknownBounds(layer.bounds)

  return layerBounds ? intersectBounds(layerBounds, documentBounds) : documentBounds
}

function imageResultBounds(result: PhotoshopImageResult, fallback: PixelBounds): PixelBounds {
  const width = result.imageData.width
  const height = result.imageData.height
  const bounds = normalizeBounds(result.sourceBounds, fallback)

  if (bounds.right <= bounds.left) {
    bounds.right = bounds.left + width
  }

  if (bounds.bottom <= bounds.top) {
    bounds.bottom = bounds.top + height
  }

  return bounds
}

function requireUint8(data: Uint8Array | Uint16Array | Float32Array): Uint8Array {
  if (data instanceof Uint8Array) {
    return data
  }

  throw new Error('当前验证模型只处理 8-bit 图像')
}

function toRgba(data: Uint8Array, width: number, height: number, components: number) {
  const pixelCount = width * height
  const rgba = new Uint8Array(pixelCount * 4)

  for (let i = 0; i < pixelCount; i += 1) {
    const source = i * components
    const target = i * 4

    if (components === 1) {
      const gray = data[source] ?? 0
      rgba[target] = gray
      rgba[target + 1] = gray
      rgba[target + 2] = gray
      rgba[target + 3] = 255
    } else {
      rgba[target] = data[source] ?? 0
      rgba[target + 1] = data[source + 1] ?? data[source] ?? 0
      rgba[target + 2] = data[source + 2] ?? data[source] ?? 0
      rgba[target + 3] = components >= 4 ? (data[source + 3] ?? 255) : 255
    }
  }

  return rgba
}

function compositeSelection(rgba: Uint8Array, mask: Uint8Array) {
  const output = new Uint8Array(rgba.length)
  const pixelCount = rgba.length / 4

  for (let i = 0; i < pixelCount; i += 1) {
    const target = i * 4
    const alpha = mask[i] ?? 0

    output[target] = rgba[target] ?? 0
    output[target + 1] = rgba[target + 1] ?? 0
    output[target + 2] = rgba[target + 2] ?? 0
    output[target + 3] = alpha
  }

  return output
}

function toSelectionMask(data: Uint8Array, width: number, height: number, components: number) {
  if (components === 1) {
    return data
  }

  const pixelCount = width * height
  const mask = new Uint8Array(pixelCount)

  for (let i = 0; i < pixelCount; i += 1) {
    mask[i] = data[i * components] ?? 0
  }

  return mask
}

function calculateMaskBounds(mask: Uint8Array, width: number, height: number, sourceBounds: PixelBounds) {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((mask[y * width + x] ?? 0) <= 0) {
        continue
      }

      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }

  if (maxX < minX || maxY < minY) {
    return null
  }

  return {
    left: sourceBounds.left + minX,
    top: sourceBounds.top + minY,
    right: sourceBounds.left + maxX + 1,
    bottom: sourceBounds.top + maxY + 1
  }
}

function cropMaskToBounds(
  mask: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  sourceBounds: PixelBounds,
  targetBounds: PixelBounds,
  targetWidth: number,
  targetHeight: number
) {
  const cropped = new Uint8Array(targetWidth * targetHeight)

  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = targetBounds.top + y - sourceBounds.top

    if (sourceY < 0 || sourceY >= sourceHeight) {
      continue
    }

    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = targetBounds.left + x - sourceBounds.left

      if (sourceX < 0 || sourceX >= sourceWidth) {
        continue
      }

      cropped[y * targetWidth + x] = mask[sourceY * sourceWidth + sourceX] ?? 0
    }
  }

  return cropped
}

function rgbaToPreviewRgb(rgba: Uint8Array, matte = 34) {
  const pixelCount = rgba.length / 4
  const rgb = new Uint8Array(pixelCount * 3)

  for (let i = 0; i < pixelCount; i += 1) {
    const source = i * 4
    const target = i * 3
    const alpha = (rgba[source + 3] ?? 255) / 255

    rgb[target] = Math.round((rgba[source] ?? 0) * alpha + matte * (1 - alpha))
    rgb[target + 1] = Math.round((rgba[source + 1] ?? 0) * alpha + matte * (1 - alpha))
    rgb[target + 2] = Math.round((rgba[source + 2] ?? 0) * alpha + matte * (1 - alpha))
  }

  return rgb
}

function resizeRgba(source: Uint8Array, sourceWidth: number, sourceHeight: number, width: number, height: number) {
  if (sourceWidth === width && sourceHeight === height) {
    return new Uint8Array(source)
  }

  const output = new Uint8Array(width * height * 4)

  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y / height) * sourceHeight))

    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x / width) * sourceWidth))
      const sourceIndex = (sourceY * sourceWidth + sourceX) * 4
      const targetIndex = (y * width + x) * 4

      output[targetIndex] = source[sourceIndex] ?? 0
      output[targetIndex + 1] = source[sourceIndex + 1] ?? 0
      output[targetIndex + 2] = source[sourceIndex + 2] ?? 0
      output[targetIndex + 3] = source[sourceIndex + 3] ?? 255
    }
  }

  return output
}

function normalizeInsertTarget(target: { left: number; top: number; width: number; height: number }): NormalizedInsertTarget {
  return {
    left: Math.round(target.left),
    top: Math.round(target.top),
    width: Math.max(1, Math.round(target.width)),
    height: Math.max(1, Math.round(target.height))
  }
}

function insertTargetToBounds(target: NormalizedInsertTarget): PixelBounds {
  return {
    left: target.left,
    top: target.top,
    right: target.left + target.width,
    bottom: target.top + target.height
  }
}

function readImageExtensionFromMimeType(mimeType: string) {
  const normalized = mimeType.split(';')[0]?.trim().toLowerCase()

  if (normalized === 'image/png') {
    return 'png'
  }

  if (normalized === 'image/jpeg' || normalized === 'image/jpg') {
    return 'jpg'
  }

  if (normalized === 'image/webp') {
    return 'webp'
  }

  if (normalized === 'image/gif') {
    return 'gif'
  }

  return ''
}

function readImageExtensionFromUrl(previewUrl: string) {
  const path = previewUrl.split('?')[0]?.split('#')[0] ?? ''
  const extension = path.split('.').pop()?.toLowerCase() ?? ''

  if (['gif', 'jpg', 'jpeg', 'png', 'webp'].includes(extension)) {
    return extension === 'jpeg' ? 'jpg' : extension
  }

  return ''
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function textToBytes(value: string) {
  const bytes = new Uint8Array(value.length)

  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff
  }

  return bytes
}

function readDataUrlImageBytes(previewUrl: string) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(previewUrl)
  if (!match) {
    throw new Error('图片文件无法读取')
  }

  const mimeType = match[1] || 'image/png'
  const extension = readImageExtensionFromMimeType(mimeType)
  if (!extension) {
    throw new Error('图片格式暂不支持置入')
  }

  return {
    bytes: match[2] ? base64ToBytes(match[3] ?? '') : textToBytes(decodeURIComponent(match[3] ?? '')),
    extension
  }
}

async function readPreviewImageBytes(previewUrl: string) {
  if (previewUrl.startsWith('data:')) {
    return readDataUrlImageBytes(previewUrl)
  }

  if (!/^https?:\/\//i.test(previewUrl)) {
    throw new Error('图片文件无法直接置入')
  }

  const response = await fetch(previewUrl)
  if (!response.ok) {
    throw new Error('图片下载失败')
  }

  const mimeExtension = readImageExtensionFromMimeType(response.headers.get('content-type') ?? '')
  const urlExtension = readImageExtensionFromUrl(previewUrl)

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    extension: mimeExtension || urlExtension || 'png'
  }
}

async function createTemporaryPreviewFile(image: CapturedCanvasImage) {
  const uxp = getUxpRuntime()
  const localFileSystem = uxp.storage?.localFileSystem

  if (!localFileSystem?.getTemporaryFolder || !localFileSystem.createSessionToken) {
    throw new Error('当前环境无法置入图片')
  }

  const { bytes, extension } = await readPreviewImageBytes(image.previewUrl)
  const folder = await localFileSystem.getTemporaryFolder()
  const file = await folder.createFile(`lightyear-place-${Date.now()}.${extension}`, { overwrite: true })
  const binaryFormat = uxp.storage?.formats?.binary

  await file.write(bytes, binaryFormat ? { format: binaryFormat } : undefined)

  return {
    file,
    token: localFileSystem.createSessionToken(file)
  }
}

async function deleteTemporaryFile(file: UxpFile) {
  try {
    await file.delete?.()
  } catch {
    // Temporary files are best-effort cleanup in UXP.
  }
}

export function createSampleCanvasImage(): CapturedCanvasImage {
  const width = 360
  const height = 240
  const rgba = new Uint8Array(width * height * 4)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const stripe = Math.floor((x + y) / 18) % 2
      const inCircle = (x - 262) ** 2 + (y - 88) ** 2 < 46 ** 2
      const inBlock = x >= 42 && x <= 190 && y >= 58 && y <= 170
      const inLine = Math.abs(y - (x * 0.42 + 24)) < 3 || Math.abs(y - (-x * 0.34 + 210)) < 3

      rgba[index] = 28 + stripe * 18
      rgba[index + 1] = 42 + stripe * 16
      rgba[index + 2] = 58 + stripe * 18
      rgba[index + 3] = 255

      if (inBlock) {
        rgba[index] = 236
        rgba[index + 1] = 92
        rgba[index + 2] = 70
      }

      if (inCircle) {
        rgba[index] = 83
        rgba[index + 1] = 211
        rgba[index + 2] = 194
      }

      if (inLine) {
        rgba[index] = 244
        rgba[index + 1] = 230
        rgba[index + 2] = 130
      }
    }
  }

  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="360" height="240" fill="#1c2a3a"/>
      <path d="M0 24 L360 175" stroke="#f4e682" stroke-width="7"/>
      <path d="M0 210 L360 88" stroke="#f4e682" stroke-width="7"/>
      <rect x="42" y="58" width="148" height="112" rx="18" fill="#ec5c46"/>
      <circle cx="262" cy="88" r="46" fill="#53d3c2"/>
      <text x="44" y="204" fill="#f7f2df" font-family="Arial" font-size="24" font-weight="700">Sample Image</text>
    </svg>`
  )

  return {
    id: 'sample-insert-image',
    label: 'Sample Image',
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

async function encodeRgbaPreview(
  photoshop: PhotoshopRuntime,
  rgba: Uint8Array,
  width: number,
  height: number,
  trace?: UxpDiagnosticTrace
) {
  const rgb = rgbaToPreviewRgb(rgba)
  const createStartedAt = Date.now()
  await emitTrace(trace, 'preview.createImageData', 'start', {
    width,
    height,
    components: 3,
    byteLength: rgb.byteLength
  })

  let imageData: PhotoshopImageResult['imageData']
  try {
    imageData = await photoshop.imaging.createImageDataFromBuffer(rgb, {
      width,
      height,
      components: 3,
      colorProfile: COLOR_PROFILE,
      colorSpace: 'RGB'
    })
    await emitTrace(trace, 'preview.createImageData', 'success', {
      durationMs: Date.now() - createStartedAt,
      width: imageData.width,
      height: imageData.height,
      components: imageData.components
    })
  } catch (error) {
    await emitTrace(trace, 'preview.createImageData', 'error', { durationMs: Date.now() - createStartedAt }, error)
    throw error
  }

  try {
    const encodeStartedAt = Date.now()
    await emitTrace(trace, 'preview.encodeImageData', 'start', { width, height })
    let base64: string
    try {
      base64 = await photoshop.imaging.encodeImageData({
        imageData,
        base64: true
      })
      await emitTrace(trace, 'preview.encodeImageData', 'success', {
        durationMs: Date.now() - encodeStartedAt,
        encodedLength: base64.length
      })
    } catch (error) {
      await emitTrace(trace, 'preview.encodeImageData', 'error', { durationMs: Date.now() - encodeStartedAt }, error)
      throw error
    }

    return `data:image/jpeg;base64,${base64}`
  } finally {
    await emitTrace(trace, 'preview.imageData.dispose', 'start')
    imageData.dispose()
    await emitTrace(trace, 'preview.imageData.dispose', 'success')
  }
}

async function getSelectionPixels(trace?: UxpDiagnosticTrace) {
  const photoshop = getPhotoshop()
  const doc = photoshop.app.activeDocument
  const documentBounds = getDocumentBounds(doc)
  const requestStartedAt = Date.now()
  await emitTrace(trace, 'selection.getSelection', 'start', {
    documentId: doc.id,
    requestedBounds: documentBounds
  })

  let result: PhotoshopImageResult
  try {
    result = await photoshop.imaging.getSelection({
      documentID: doc.id,
      sourceBounds: documentBounds
    })
    await emitTrace(trace, 'selection.getSelection', 'success', {
      durationMs: Date.now() - requestStartedAt,
      width: result.imageData.width,
      height: result.imageData.height,
      components: result.imageData.components,
      returnedBounds: imageResultBounds(result, documentBounds)
    })
  } catch (error) {
    await emitTrace(trace, 'selection.getSelection', 'error', { durationMs: Date.now() - requestStartedAt }, error)
    throw error
  }

  try {
    const dataStartedAt = Date.now()
    await emitTrace(trace, 'selection.getData', 'start', {
      width: result.imageData.width,
      height: result.imageData.height,
      components: result.imageData.components
    })
    let rawData: Uint8Array | Uint16Array | Float32Array
    try {
      rawData = await result.imageData.getData()
      await emitTrace(trace, 'selection.getData', 'success', {
        durationMs: Date.now() - dataStartedAt,
        ...readTypedArrayDetails(rawData),
        expectedElementLength: result.imageData.width * result.imageData.height * result.imageData.components
      })
    } catch (error) {
      await emitTrace(trace, 'selection.getData', 'error', { durationMs: Date.now() - dataStartedAt }, error)
      throw error
    }

    await emitTrace(trace, 'selection.buffer.validate', 'start', readTypedArrayDetails(rawData))
    const data = requireUint8(rawData)
    await emitTrace(trace, 'selection.buffer.validate', 'success', {
      ...readTypedArrayDetails(data),
      expectedByteLength: result.imageData.width * result.imageData.height * result.imageData.components
    })
    const width = result.imageData.width
    const height = result.imageData.height
    const sourceBounds = imageResultBounds(result, documentBounds)
    await emitTrace(trace, 'selection.mask.convert', 'start', { width, height, components: result.imageData.components })
    const mask = toSelectionMask(data, width, height, result.imageData.components)
    const selectionBounds = calculateMaskBounds(mask, width, height, sourceBounds)
    await emitTrace(trace, 'selection.mask.convert', 'success', {
      width,
      height,
      sourceBounds,
      selectionBounds,
      byteLength: mask.byteLength,
      nonZeroPixelCount: countNonZeroBytes(mask)
    })

    if (!selectionBounds) {
      const error = new Error('当前没有可读取的选区')
      await emitTrace(trace, 'selection.mask.bounds', 'error', {
        width,
        height,
        sourceBounds,
        byteLength: mask.byteLength,
        nonZeroPixelCount: 0
      }, error)
      throw error
    }

    return {
      mask,
      width,
      height,
      sourceBounds,
      selectionBounds
    }
  } finally {
    await emitTrace(trace, 'selection.imageData.dispose', 'start')
    result.imageData.dispose()
    await emitTrace(trace, 'selection.imageData.dispose', 'success')
  }
}

async function getLayerPixels(layer: PhotoshopLayer, bounds?: PixelBounds) {
  const photoshop = getPhotoshop()
  const doc = photoshop.app.activeDocument
  const documentBounds = getDocumentBounds(doc)
  const layerBounds = getLayerSourceBounds(layer, documentBounds)
  const sourceBounds = bounds && layerBounds ? intersectBounds(layerBounds, bounds) : layerBounds

  if (!sourceBounds) {
    throw new Error('选中图层没有可读取的像素')
  }

  const result = await photoshop.imaging.getPixels({
    documentID: doc.id,
    layerID: layer.id,
    sourceBounds,
    colorSpace: 'RGB',
    componentSize: 8
  })

  try {
    const data = requireUint8(await result.imageData.getData())
    const rgba = toRgba(data, result.imageData.width, result.imageData.height, result.imageData.components)

    return {
      rgba,
      width: result.imageData.width,
      height: result.imageData.height,
      sourceBounds: imageResultBounds(result, sourceBounds)
    }
  } finally {
    result.imageData.dispose()
  }
}

async function closeTemporaryDocument(photoshop: PhotoshopRuntime, document: PhotoshopDocument) {
  if (document.closeWithoutSaving) {
    await document.closeWithoutSaving()
    return
  }

  const doNotSave = photoshop.constants?.SaveOptions?.DONOTSAVECHANGES
  if (document.close && doNotSave !== undefined) {
    await document.close(doNotSave)
    return
  }

  throw new Error('当前 Photoshop 无法关闭临时合成副本')
}

async function readMergedLayerPixels(
  photoshop: PhotoshopRuntime,
  document: PhotoshopDocument,
  layer: PhotoshopLayer,
  sourceBounds: PixelBounds
) {
  const result = await photoshop.imaging.getPixels({
    documentID: document.id,
    layerID: layer.id,
    sourceBounds,
    colorSpace: 'RGB',
    componentSize: 8
  })

  try {
    const data = requireUint8(await result.imageData.getData())
    return {
      rgba: toRgba(data, result.imageData.width, result.imageData.height, result.imageData.components),
      width: result.imageData.width,
      height: result.imageData.height,
      sourceBounds: imageResultBounds(result, sourceBounds)
    }
  } finally {
    result.imageData.dispose()
  }
}

async function getMergedVisiblePixels(bounds: PixelBounds, trace?: UxpDiagnosticTrace) {
  const photoshop = getPhotoshop()
  const sourceDocument = photoshop.app.activeDocument
  if (!sourceDocument.duplicate) {
    throw new Error('当前 Photoshop 无法创建可见图层合成副本')
  }

  await emitTrace(trace, 'composite.fallback.duplicate', 'start', { documentId: sourceDocument.id, bounds })
  const mergedDocument = await sourceDocument.duplicate(`Lightyear Banana ${Date.now()}`, true)
  await emitTrace(trace, 'composite.fallback.duplicate', 'success', { documentId: mergedDocument.id })

  try {
    if ((mergedDocument.layers?.length ?? 0) > 1) {
      if (!mergedDocument.mergeVisibleLayers) {
        throw new Error('当前 Photoshop 无法合并可见图层')
      }

      await emitTrace(trace, 'composite.fallback.mergeVisible', 'start', { documentId: mergedDocument.id })
      await mergedDocument.mergeVisibleLayers()
      await emitTrace(trace, 'composite.fallback.mergeVisible', 'success', { documentId: mergedDocument.id })
    }

    const mergedLayer = mergedDocument.activeLayers[0] ?? mergedDocument.layers?.[0]
    if (!mergedLayer) {
      throw new Error('当前文档没有可读取的可见图层')
    }

    await emitTrace(trace, 'composite.fallback.getPixels', 'start', {
      documentId: mergedDocument.id,
      layerId: mergedLayer.id,
      bounds
    })
    const captured = await readMergedLayerPixels(photoshop, mergedDocument, mergedLayer, bounds)
    await emitTrace(trace, 'composite.fallback.getPixels', 'success', {
      width: captured.width,
      height: captured.height,
      returnedBounds: captured.sourceBounds
    })
    return captured
  } finally {
    await emitTrace(trace, 'composite.fallback.close', 'start', { documentId: mergedDocument.id })
    try {
      await closeTemporaryDocument(photoshop, mergedDocument)
      await emitTrace(trace, 'composite.fallback.close', 'success', { documentId: mergedDocument.id })
    } catch (error) {
      await emitTrace(trace, 'composite.fallback.close', 'error', { documentId: mergedDocument.id }, error)
      throw error
    }
  }
}

async function getMergedVisibleCompositePixels(bounds?: PixelBounds, trace?: UxpDiagnosticTrace) {
  const photoshop = getPhotoshop()
  const sourceDocument = photoshop.app.activeDocument
  const requestedBounds = bounds ?? getDocumentBounds(sourceDocument)
  return getMergedVisiblePixels(requestedBounds, trace)
}

export async function captureVisibleComposite(): Promise<CapturedCanvasImage> {
  return executePhotoshopModal('抓取可见图像', async () => {
    const photoshop = getPhotoshop()
    const captured = await getMergedVisibleCompositePixels()
    const previewUrl = await encodeRgbaPreview(photoshop, captured.rgba, captured.width, captured.height)

    return {
      id: `visible-${Date.now()}`,
      label: '可见图像',
      width: captured.width,
      height: captured.height,
      sourceBounds: captured.sourceBounds,
      previewUrl,
      rgba: captured.rgba
    }
  })
}

export async function captureSelectedLayer(): Promise<CapturedCanvasImage> {
  return executePhotoshopModal('抓取选中图层', async () => {
    const photoshop = getPhotoshop()
    const layer = photoshop.app.activeDocument.activeLayers[0]

    if (!layer) {
      throw new Error('当前没有选中图层')
    }

    const captured = await getLayerPixels(layer)
    const previewUrl = await encodeRgbaPreview(photoshop, captured.rgba, captured.width, captured.height)

    return {
      id: `layer-${layer.id}-${Date.now()}`,
      label: layer.name ? `选中图层：${layer.name}` : '选中图层',
      width: captured.width,
      height: captured.height,
      sourceBounds: captured.sourceBounds,
      previewUrl,
      rgba: captured.rgba
    }
  })
}

export async function captureSelectionComposite(trace?: UxpDiagnosticTrace): Promise<CapturedCanvasImage> {
  return executePhotoshopModal('抓取选区图像', async () => {
    const photoshop = getPhotoshop()
    await emitTrace(trace, 'photoshop.document.read', 'success', readCanvasDiagnosticContext())
    const selection = await getSelectionPixels(trace)
    const selectionBounds = selection.selectionBounds
    const composite = await getMergedVisibleCompositePixels(selectionBounds, trace)
    await emitTrace(trace, 'selection.mask.crop', 'start', {
      sourceWidth: selection.width,
      sourceHeight: selection.height,
      sourceBounds: selection.sourceBounds,
      targetWidth: composite.width,
      targetHeight: composite.height,
      targetBounds: composite.sourceBounds
    })
    const mask = cropMaskToBounds(
      selection.mask,
      selection.width,
      selection.height,
      selection.sourceBounds,
      composite.sourceBounds,
      composite.width,
      composite.height
    )
    await emitTrace(trace, 'selection.mask.crop', 'success', {
      width: composite.width,
      height: composite.height,
      byteLength: mask.byteLength,
      nonZeroPixelCount: countNonZeroBytes(mask)
    })
    await emitTrace(trace, 'selection.rgba.composite', 'start', {
      rgbaByteLength: composite.rgba.byteLength,
      maskByteLength: mask.byteLength
    })
    const selectedRgba = compositeSelection(composite.rgba, mask)
    await emitTrace(trace, 'selection.rgba.composite', 'success', {
      width: composite.width,
      height: composite.height,
      byteLength: selectedRgba.byteLength
    })
    const previewUrl = await encodeRgbaPreview(photoshop, selectedRgba, composite.width, composite.height, trace)

    return {
      id: `selection-${Date.now()}`,
      label: '选区图像',
      width: composite.width,
      height: composite.height,
      sourceBounds: selectionBounds,
      previewUrl,
      rgba: selectedRgba
    }
  }, trace)
}

export async function readSelectionBounds(trace?: UxpDiagnosticTrace) {
  return executePhotoshopModal('读取选区位置', async () => {
    await emitTrace(trace, 'photoshop.document.read', 'success', readCanvasDiagnosticContext())
    const selection = await getSelectionPixels(trace)
    const bounds = selection.selectionBounds

    return {
      left: bounds.left,
      top: bounds.top,
      width: Math.max(1, bounds.right - bounds.left),
      height: Math.max(1, bounds.bottom - bounds.top)
    }
  }, trace)
}

async function createPixelLayer(name: string) {
  const photoshop = getPhotoshop()

  await photoshop.action.batchPlay(
    [
      {
        _obj: 'make',
        _target: [{ _ref: 'layer' }],
        using: {
          _obj: 'layer',
          name
        },
        _options: {
          dialogOptions: 'dontDisplay'
        }
      }
    ],
    {}
  )

  return photoshop.app.activeDocument.activeLayers[0]
}

function readPlacedLayerBounds(layer: PhotoshopLayer) {
  return normalizeUnknownBounds(layer.boundsNoEffects) ?? normalizeUnknownBounds(layer.bounds)
}

async function fitPlacedLayerToTarget(photoshop: PhotoshopRuntime, layer: PhotoshopLayer, bounds: PixelBounds) {
  const current = readPlacedLayerBounds(layer)
  if (!current) {
    throw new Error('置入图层无法读取位置')
  }

  if (typeof layer.scale !== 'function' || typeof layer.translate !== 'function') {
    throw new Error('置入图层无法调整位置')
  }

  const currentWidth = Math.max(1, current.right - current.left)
  const currentHeight = Math.max(1, current.bottom - current.top)
  const scaleX = ((bounds.right - bounds.left) / currentWidth) * 100
  const scaleY = ((bounds.bottom - bounds.top) / currentHeight) * 100

  await layer.scale(scaleX, scaleY, photoshop.constants?.AnchorPosition?.TOPLEFT)

  const next = readPlacedLayerBounds(layer)
  if (!next) {
    throw new Error('置入图层无法读取位置')
  }

  await layer.translate(bounds.left - next.left, bounds.top - next.top)
}

async function placeTemporaryImageFile(
  image: CapturedCanvasImage,
  temporaryFile: { file: UxpFile; token: string },
  target: NormalizedInsertTarget
) {
  const photoshop = getPhotoshop()
  const bounds = insertTargetToBounds(target)

  await photoshop.core.executeAsModal(
    async () => {
      await photoshop.action.batchPlay(
        [
          {
            _obj: 'placeEvent',
            null: {
              _path: temporaryFile.token,
              _kind: 'local'
            },
            freeTransformCenterState: {
              _enum: 'quadCenterState',
              _value: 'QCSAverage'
            },
            offset: {
              _obj: 'offset',
              horizontal: {
                _unit: 'pixelsUnit',
                _value: 0
              },
              vertical: {
                _unit: 'pixelsUnit',
                _value: 0
              }
            },
            _isCommand: false,
            _options: {
              dialogOptions: 'dontDisplay'
            }
          }
        ],
        {}
      )

      const layer = photoshop.app.activeDocument.activeLayers[0]
      if (!layer) {
        throw new Error('图片置入失败')
      }

      try {
        layer.name = `UXP 插入 ${image.label}`
      } catch {
        // Layer naming should not block a successful native placement.
      }
      await fitPlacedLayerToTarget(photoshop, layer, bounds)
    },
    { commandName: '置入插件图像', timeOut: 120 }
  )
}

async function putCapturedImagePixels(image: CapturedCanvasImage, target: NormalizedInsertTarget) {
  const photoshop = getPhotoshop()
  const { left, top, width, height } = target

  if (image.rgba.length < image.width * image.height * 4) {
    throw new Error('图片像素尚未准备完成')
  }
  const pixels = resizeRgba(image.rgba, image.width, image.height, width, height)

  await photoshop.core.executeAsModal(
    async () => {
      const layer = await createPixelLayer(`UXP 插入 ${image.label}`)
      const imageData = await photoshop.imaging.createImageDataFromBuffer(pixels, {
        width,
        height,
        components: 4,
        colorProfile: COLOR_PROFILE,
        colorSpace: 'RGB'
      })

      try {
        await photoshop.imaging.putPixels({
          documentID: photoshop.app.activeDocument.id,
          layerID: layer.id,
          imageData,
          replace: true,
          targetBounds: {
            left,
            top
          },
          commandName: '插入插件图像'
        })
      } finally {
        imageData.dispose()
      }
    },
    { commandName: '插入插件图像', timeOut: 120 }
  )

  return { left, top, width, height }
}

export async function insertCapturedImage(
  image: CapturedCanvasImage,
  target: { left: number; top: number; width: number; height: number }
) {
  return putCapturedImagePixels(image, normalizeInsertTarget(target))
}

export async function insertPreviewImage(
  image: CapturedCanvasImage,
  target: { left: number; top: number; width: number; height: number }
) {
  const normalizedTarget = normalizeInsertTarget(target)
  let temporaryFile: { file: UxpFile; token: string } | null = null

  try {
    temporaryFile = await createTemporaryPreviewFile(image)
  } catch {
    return putCapturedImagePixels(image, normalizedTarget)
  }

  try {
    await placeTemporaryImageFile(image, temporaryFile, normalizedTarget)
  } finally {
    await deleteTemporaryFile(temporaryFile.file)
  }

  return normalizedTarget
}

export function readDocumentSize() {
  const photoshop = getPhotoshop()
  const bounds = getDocumentBounds(photoshop.app.activeDocument)

  return {
    width: bounds.right - bounds.left,
    height: bounds.bottom - bounds.top
  }
}

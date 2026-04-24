import { getHostRequire } from './photoshopHost'

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

type PhotoshopRuntime = {
  action: {
    batchPlay: (commands: unknown[], options: Record<string, unknown>) => Promise<unknown[]>
  }
  app: {
    activeDocument: {
      id: number
      width: number
      height: number
      activeLayers: PhotoshopLayer[]
    }
  }
  core: {
    executeAsModal: <T>(
      targetFunction: () => Promise<T>,
      options: { commandName: string; timeOut?: number }
    ) => Promise<T>
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
}

function getPhotoshop(): PhotoshopRuntime {
  const hostRequire = getHostRequire()
  if (!hostRequire) {
    throw new Error('Photoshop UXP runtime is unavailable.')
  }

  return hostRequire('photoshop') as PhotoshopRuntime
}

async function executePhotoshopModal<T>(commandName: string, targetFunction: () => Promise<T>) {
  const photoshop = getPhotoshop()

  return photoshop.core.executeAsModal(targetFunction, { commandName, timeOut: 5 })
}

function getDocumentBounds(doc: { width: number; height: number }): PixelBounds {
  return {
    left: 0,
    top: 0,
    right: Math.round(doc.width),
    bottom: Math.round(doc.height)
  }
}

function normalizeBounds(bounds: Partial<PixelBounds>, fallback: PixelBounds): PixelBounds {
  return {
    left: Math.round(bounds.left ?? fallback.left),
    top: Math.round(bounds.top ?? fallback.top),
    right: Math.round(bounds.right ?? fallback.right),
    bottom: Math.round(bounds.bottom ?? fallback.bottom)
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

async function encodeRgbaPreview(photoshop: PhotoshopRuntime, rgba: Uint8Array, width: number, height: number) {
  const rgb = rgbaToPreviewRgb(rgba)
  const imageData = await photoshop.imaging.createImageDataFromBuffer(rgb, {
    width,
    height,
    components: 3,
    colorProfile: COLOR_PROFILE,
    colorSpace: 'RGB'
  })

  try {
    const base64 = await photoshop.imaging.encodeImageData({
      imageData,
      base64: true
    })

    return `data:image/jpeg;base64,${base64}`
  } finally {
    imageData.dispose()
  }
}

async function getCompositePixels(bounds?: PixelBounds) {
  const photoshop = getPhotoshop()
  const doc = photoshop.app.activeDocument
  const documentBounds = getDocumentBounds(doc)
  const sourceBounds = bounds ?? documentBounds
  const result = await photoshop.imaging.getPixels({
    documentID: doc.id,
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

async function getSelectionPixels() {
  const photoshop = getPhotoshop()
  const doc = photoshop.app.activeDocument
  const documentBounds = getDocumentBounds(doc)
  const result = await photoshop.imaging.getSelection({
    documentID: doc.id,
    sourceBounds: documentBounds
  })

  try {
    const data = requireUint8(await result.imageData.getData())
    const width = result.imageData.width
    const height = result.imageData.height
    const sourceBounds = imageResultBounds(result, documentBounds)
    const mask = toSelectionMask(data, width, height, result.imageData.components)
    const selectionBounds = calculateMaskBounds(mask, width, height, sourceBounds)

    if (!selectionBounds) {
      throw new Error('当前没有可读取的选区')
    }

    return {
      mask,
      width,
      height,
      sourceBounds,
      selectionBounds
    }
  } finally {
    result.imageData.dispose()
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

export async function captureVisibleComposite(): Promise<CapturedCanvasImage> {
  return executePhotoshopModal('抓取可见图像', async () => {
    const photoshop = getPhotoshop()
    const captured = await getCompositePixels()
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

export async function captureSelectionComposite(): Promise<CapturedCanvasImage> {
  return executePhotoshopModal('抓取选区图像', async () => {
    const photoshop = getPhotoshop()
    const selection = await getSelectionPixels()
    const selectionBounds = selection.selectionBounds
    const composite = await getCompositePixels(selectionBounds)
    const mask = cropMaskToBounds(
      selection.mask,
      selection.width,
      selection.height,
      selection.sourceBounds,
      composite.sourceBounds,
      composite.width,
      composite.height
    )
    const selectedRgba = compositeSelection(composite.rgba, mask)
    const previewUrl = await encodeRgbaPreview(photoshop, selectedRgba, composite.width, composite.height)

    return {
      id: `selection-${Date.now()}`,
      label: '选区图像',
      width: composite.width,
      height: composite.height,
      sourceBounds: selectionBounds,
      previewUrl,
      rgba: selectedRgba
    }
  })
}

export async function readSelectionBounds() {
  return executePhotoshopModal('读取选区位置', async () => {
    const selection = await getSelectionPixels()
    const bounds = selection.selectionBounds

    return {
      left: bounds.left,
      top: bounds.top,
      width: Math.max(1, bounds.right - bounds.left),
      height: Math.max(1, bounds.bottom - bounds.top)
    }
  })
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

export async function insertCapturedImage(
  image: CapturedCanvasImage,
  target: { left: number; top: number; width: number; height: number }
) {
  const photoshop = getPhotoshop()
  const width = Math.max(1, Math.round(target.width))
  const height = Math.max(1, Math.round(target.height))
  const left = Math.round(target.left)
  const top = Math.round(target.top)
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
    { commandName: '插入插件图像', timeOut: 2 }
  )

  return { left, top, width, height }
}

export function readDocumentSize() {
  const photoshop = getPhotoshop()
  const doc = photoshop.app.activeDocument

  return {
    width: Math.round(doc.width),
    height: Math.round(doc.height)
  }
}

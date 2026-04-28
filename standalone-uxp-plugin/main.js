const uxp = require('uxp')
const photoshop = require('photoshop')
const { app, core, imaging, action } = photoshop
const LOG_PREFIX = '[Lightyear Banana Standalone]'

console.log(LOG_PREFIX, 'script loaded')

const state = {
  mounted: false,
  busy: false,
  activeView: 'workspace',
  themeMode: 'dark',
  references: [],
  reference: null,
  result: null,
  history: [],
  generationTimer: null,
  generationStartedAt: 0,
  statusTimer: null
}

const refs = {}
const COLOR_PROFILE = 'sRGB IEC61966-2.1'
const MAX_REFERENCES = 4

function readElement(id) {
  return document.getElementById(id)
}

function setStatus(message) {
  if (refs.statusLine) {
    refs.statusLine.textContent = message
  }
  if (refs.statusToast) {
    refs.statusToast.classList.remove('is-hidden')
    if (state.statusTimer) {
      clearTimeout(state.statusTimer)
    }
    if (typeof setTimeout === 'function') {
      state.statusTimer = setTimeout(() => {
        refs.statusToast.classList.add('is-hidden')
        state.statusTimer = null
      }, 1800)
    }
  }
}

function setRuntimeStatus(message) {
  if (refs.runtimeStatus) {
    refs.runtimeStatus.textContent = message
  }
}

function readPromptValue() {
  return refs.promptInput?.value?.trim() || ''
}

function canSend() {
  return Boolean(readPromptValue()) || state.references.length > 0
}

function setBusy(nextBusy) {
  state.busy = nextBusy
  const disabled = Boolean(nextBusy)
  if (refs.settingsButton) {
    refs.settingsButton.disabled = disabled
  }
  if (refs.backButton) {
    refs.backButton.disabled = disabled
  }
  refs.captureVisibleButton.disabled = disabled || state.references.length >= MAX_REFERENCES
  refs.captureSelectionButton.disabled = disabled || state.references.length >= MAX_REFERENCES
  refs.captureLayerButton.disabled = disabled || state.references.length >= MAX_REFERENCES
  refs.uploadReferenceButton.disabled = disabled || state.references.length >= MAX_REFERENCES
  refs.clipboardReferenceButton.disabled = disabled || state.references.length >= MAX_REFERENCES
  refs.addReferenceButton.disabled = disabled || state.references.length >= MAX_REFERENCES
  refs.clearReferencesButton.disabled = disabled || state.references.length === 0
  refs.generateButton.disabled = disabled || !canSend()
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 10000)}`
}

function readActiveDocument() {
  return app.activeDocument || null
}

function readUnitValue(value) {
  if (typeof value === 'number') {
    return value
  }

  if (value && typeof value === 'object' && typeof value.value === 'number') {
    return value.value
  }

  return Number(value) || 0
}

function readDocumentSize(document) {
  if (!document) {
    return { width: 0, height: 0 }
  }

  return {
    width: Math.round(readUnitValue(document.width)),
    height: Math.round(readUnitValue(document.height))
  }
}

function readImageDataSize(imageData) {
  return {
    width: imageData.width || imageData.size?.width || 0,
    height: imageData.height || imageData.size?.height || 0
  }
}

function readImageDataBuffer(imageData) {
  if (imageData.data) {
    return imageData.data
  }

  if (imageData.imageData?.data) {
    return imageData.imageData.data
  }

  throw new Error('无法读取图像数据')
}

async function getImageDataBuffer(imageData) {
  if (typeof imageData.getData === 'function') {
    return imageData.getData()
  }

  return readImageDataBuffer(imageData)
}

function disposeImageData(imageData) {
  if (imageData && typeof imageData.dispose === 'function') {
    imageData.dispose()
  }
}

function readBounds(bounds, fallback) {
  if (!bounds) {
    return fallback
  }

  const left = Math.max(0, Math.round(readUnitValue(bounds.left)))
  const top = Math.max(0, Math.round(readUnitValue(bounds.top)))
  const right = Math.max(left + 1, Math.round(readUnitValue(bounds.right)))
  const bottom = Math.max(top + 1, Math.round(readUnitValue(bounds.bottom)))

  return { left, top, right, bottom }
}

function normalizeBounds(bounds, fallback) {
  const nextBounds = readBounds(bounds, fallback)

  if (nextBounds.right <= nextBounds.left) {
    nextBounds.right = nextBounds.left + 1
  }

  if (nextBounds.bottom <= nextBounds.top) {
    nextBounds.bottom = nextBounds.top + 1
  }

  return nextBounds
}

function buildFullBounds(document) {
  const size = readDocumentSize(document)
  return {
    left: 0,
    top: 0,
    right: Math.max(1, size.width),
    bottom: Math.max(1, size.height)
  }
}

function toRgba(data, width, height, components) {
  if (!(data instanceof Uint8Array)) {
    throw new Error('当前验证模型只处理 8-bit 图像')
  }

  const pixelCount = width * height
  const rgba = new Uint8Array(pixelCount * 4)

  for (let i = 0; i < pixelCount; i += 1) {
    const source = i * components
    const target = i * 4

    if (components === 1) {
      const gray = data[source] || 0
      rgba[target] = gray
      rgba[target + 1] = gray
      rgba[target + 2] = gray
      rgba[target + 3] = 255
    } else {
      rgba[target] = data[source] || 0
      rgba[target + 1] = data[source + 1] ?? data[source] ?? 0
      rgba[target + 2] = data[source + 2] ?? data[source] ?? 0
      rgba[target + 3] = components >= 4 ? (data[source + 3] ?? 255) : 255
    }
  }

  return rgba
}

function toPreviewRgb(rgba) {
  const pixelCount = rgba.length / 4
  const rgb = new Uint8Array(pixelCount * 3)

  for (let i = 0; i < pixelCount; i += 1) {
    const source = i * 4
    const target = i * 3
    const alpha = (rgba[source + 3] ?? 255) / 255

    rgb[target] = Math.round((rgba[source] ?? 0) * alpha + 34 * (1 - alpha))
    rgb[target + 1] = Math.round((rgba[source + 1] ?? 0) * alpha + 34 * (1 - alpha))
    rgb[target + 2] = Math.round((rgba[source + 2] ?? 0) * alpha + 34 * (1 - alpha))
  }

  return rgb
}

async function encodePreview(rgba, width, height) {
  const previewData = await imaging.createImageDataFromBuffer(toPreviewRgb(rgba), {
    width,
    height,
    components: 3,
    colorProfile: COLOR_PROFILE,
    colorSpace: 'RGB'
  })

  try {
    const encoded = await imaging.encodeImageData({
      imageData: previewData,
      base64: true
    })

    if (typeof encoded === 'string') {
      return encoded.startsWith('data:') ? encoded : `data:image/jpeg;base64,${encoded}`
    }

    if (encoded && typeof encoded === 'object') {
      const value = encoded.base64 || encoded.data || encoded.url
      if (typeof value === 'string') {
        return value.startsWith('data:') ? value : `data:image/jpeg;base64,${value}`
      }
    }

    throw new Error('无法生成预览')
  } finally {
    disposeImageData(previewData)
  }
}

async function imageResultToCanvasImage(kind, label, result, fallbackBounds) {
  const imageData = result.imageData
  const { width, height } = readImageDataSize(imageData)
  const data = await getImageDataBuffer(imageData)
  const rgba = toRgba(data, width, height, imageData.components || 4)
  const bounds = normalizeBounds(result.sourceBounds, fallbackBounds)
  const previewUrl = await encodePreview(rgba, width, height)

  return {
    id: createId(kind),
    kind,
    label,
    width,
    height,
    bounds,
    previewUrl,
    rgba
  }
}

async function captureVisibleImage() {
  const document = readActiveDocument()
  if (!document) {
    throw new Error('请先打开一个 Photoshop 文档')
  }

  let result
  try {
    const bounds = buildFullBounds(document)
    result = await imaging.getPixels({
      documentID: document.id,
      sourceBounds: bounds,
      colorSpace: 'RGB',
      componentSize: 8
    })
    return await imageResultToCanvasImage('visible', '可见图层', result, bounds)
  } finally {
    disposeImageData(result?.imageData)
  }
}

async function captureSelectedLayerImage() {
  const document = readActiveDocument()
  if (!document) {
    throw new Error('请先打开一个 Photoshop 文档')
  }

  const layer = document.activeLayers && document.activeLayers[0]
  if (!layer) {
    throw new Error('当前没有选中图层')
  }

  const fallback = buildFullBounds(document)
  const bounds = readBounds(layer.boundsNoEffects || layer.bounds, fallback)
  let result
  try {
    result = await imaging.getPixels({
      documentID: document.id,
      layerID: layer.id,
      sourceBounds: bounds,
      colorSpace: 'RGB',
      componentSize: 8
    })
    return await imageResultToCanvasImage('layer', '当前图层', result, bounds)
  } finally {
    disposeImageData(result?.imageData)
  }
}

function toSelectionMask(data, width, height, components) {
  if (!(data instanceof Uint8Array)) {
    throw new Error('当前验证模型只处理 8-bit 图像')
  }

  if (components === 1) {
    return data
  }

  const mask = new Uint8Array(width * height)

  for (let i = 0; i < width * height; i += 1) {
    mask[i] = data[i * components] || 0
  }

  return mask
}

function readMaskBounds(maskData, width, height, sourceBounds) {
  let left = width
  let top = height
  let right = 0
  let bottom = 0
  let hasMask = false

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = maskData[y * width + x]
      if (alpha > 0) {
        hasMask = true
        left = Math.min(left, x)
        top = Math.min(top, y)
        right = Math.max(right, x + 1)
        bottom = Math.max(bottom, y + 1)
      }
    }
  }

  if (!hasMask) {
    throw new Error('当前没有可读取的选区')
  }

  return {
    left: sourceBounds.left + left,
    top: sourceBounds.top + top,
    right: sourceBounds.left + right,
    bottom: sourceBounds.top + bottom
  }
}

async function captureSelectionImage() {
  const document = readActiveDocument()
  if (!document) {
    throw new Error('请先打开一个 Photoshop 文档')
  }

  let selectionResult
  let pixelsResult
  try {
    const documentBounds = buildFullBounds(document)
    selectionResult = await imaging.getSelection({
      documentID: document.id,
      sourceBounds: documentBounds
    })
    const selectionSize = readImageDataSize(selectionResult.imageData)
    const selectionBuffer = await getImageDataBuffer(selectionResult.imageData)
    const selectionSourceBounds = normalizeBounds(selectionResult.sourceBounds, documentBounds)
    const selectionMask = toSelectionMask(
      selectionBuffer,
      selectionSize.width,
      selectionSize.height,
      selectionResult.imageData.components || 1
    )
    const bounds = readMaskBounds(selectionMask, selectionSize.width, selectionSize.height, selectionSourceBounds)
    pixelsResult = await imaging.getPixels({
      documentID: document.id,
      sourceBounds: bounds,
      colorSpace: 'RGB',
      componentSize: 8
    })
    return await imageResultToCanvasImage('selection', '选区', pixelsResult, bounds)
  } finally {
    disposeImageData(selectionResult?.imageData)
    disposeImageData(pixelsResult?.imageData)
  }
}

function readGenerationOptions() {
  const size = Number(readDropdownValue(refs.sizeDropdown, '512')) || 512
  const ratio = readDropdownValue(refs.ratioDropdown, 'source')
  const quantity = Math.max(1, Number(readDropdownValue(refs.quantityDropdown, '1')) || 1)

  return {
    model: readDropdownValue(refs.modelDropdown, 'mock-image'),
    size,
    quality: readDropdownValue(refs.qualityDropdown, 'standard'),
    quantity,
    ratio
  }
}

function readMockDimensions(reference, options) {
  if (reference && options.ratio === 'source') {
    return { width: reference.width, height: reference.height }
  }

  const size = options.size || 512
  const ratios = {
    source: [1, 1],
    '1:1': [1, 1],
    '4:3': [4, 3],
    '3:4': [3, 4],
    '16:9': [16, 9],
    '9:16': [9, 16]
  }
  const [ratioWidth, ratioHeight] = ratios[options.ratio] || ratios['1:1']

  if (ratioWidth >= ratioHeight) {
    return {
      width: size,
      height: Math.max(1, Math.round((size * ratioHeight) / ratioWidth))
    }
  }

  return {
    width: Math.max(1, Math.round((size * ratioWidth) / ratioHeight)),
    height: size
  }
}

function createMockResult(prompt, reference, options = readGenerationOptions()) {
  const dimensions = readMockDimensions(reference, options)
  const width = dimensions.width
  const height = dimensions.height
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="#1f2633"/>
    <rect x="24" y="24" width="${Math.max(1, width - 48)}" height="${Math.max(1, height - 48)}" rx="24" fill="#2f8cff" opacity="0.68"/>
    <text x="32" y="64" fill="white" font-family="Arial" font-size="24">Lightyear Banana</text>
    <text x="32" y="100" fill="white" font-family="Arial" font-size="16">${escapeXml(prompt || 'Mock 结果')}</text>
    <text x="32" y="128" fill="white" font-family="Arial" font-size="14">${escapeXml(`${options.model} · ${options.quality}`)}</text>
  </svg>`
  const previewUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  const rgba = new Uint8Array(width * height * 4)

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      rgba[index] = 40 + Math.round((x / width) * 80)
      rgba[index + 1] = 86 + Math.round((y / height) * 80)
      rgba[index + 2] = 210
      rgba[index + 3] = 255
    }
  }

  return {
    id: createId('result'),
    kind: 'result',
    label: '生成结果',
    width,
    height,
    bounds: reference?.bounds || { left: 0, top: 0, right: width, bottom: height },
    previewUrl,
    rgba
  }
}

function createMockReference(kind, label) {
  const image = createMockResult(label, null, {
    model: 'mock-reference',
    size: 384,
    quality: 'standard',
    quantity: 1,
    ratio: '4:3'
  })
  image.id = createId(kind)
  image.kind = kind
  image.label = label
  return image
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderPreview(container, image) {
  container.classList.remove('is-empty')
  container.innerHTML = ''

  const img = document.createElement('img')
  img.src = image.previewUrl
  img.alt = image.label

  const meta = document.createElement('div')
  meta.className = 'preview-meta'

  const label = document.createElement('sp-detail')
  label.textContent = image.label

  const size = document.createElement('sp-detail')
  size.textContent = `${image.width} x ${image.height}`

  meta.append(label, size)
  container.append(img, meta)
}

function renderEmpty(container, message) {
  container.classList.add('is-empty')
  container.innerHTML = ''
  const detail = document.createElement('sp-detail')
  detail.textContent = message
  container.append(detail)
}

function cloneCanvasImage(image, kind, label) {
  return {
    ...image,
    id: createId(kind),
    kind,
    label,
    rgba: new Uint8Array(image.rgba)
  }
}

function renderReferences() {
  refs.referenceCount.textContent = `${state.references.length} / ${MAX_REFERENCES}`
  refs.referenceList.innerHTML = ''

  if (state.references.length === 0) {
    state.reference = null
    setBusy(state.busy)
    return
  }

  state.reference = state.references[state.references.length - 1]

  state.references.forEach((image, index) => {
    const row = document.createElement('div')
    row.className = 'thumb-row'

    const img = document.createElement('img')
    img.src = image.previewUrl
    img.alt = image.label

    const copy = document.createElement('div')
    copy.className = 'thumb-copy'

    const label = document.createElement('sp-detail')
    label.textContent = `${index + 1}. ${image.label}`

    const size = document.createElement('sp-detail')
    size.textContent = `${image.width} x ${image.height}`

    const removeButton = document.createElement('sp-action-button')
    removeButton.textContent = '删除'
    removeButton.addEventListener('click', () => removeReference(image.id))

    copy.append(label, size)
    row.append(img, copy, removeButton)
    refs.referenceList.append(row)
  })

  setBusy(state.busy)
}

function addReference(image, statusMessage) {
  if (state.references.length >= MAX_REFERENCES) {
    setStatus(`最多添加 ${MAX_REFERENCES} 张参考图`)
    return false
  }

  state.references.push(image)
  renderReferences()
  setStatus(statusMessage || `已添加${image.label}`)
  return true
}

function removeReference(id) {
  state.references = state.references.filter((image) => image.id !== id)
  renderReferences()
  setStatus('已删除参考图')
}

function clearReferences() {
  state.references = []
  renderReferences()
  setStatus('已清空参考图')
}

function renderHistory() {
  refs.threadContent.innerHTML = ''

  if (state.history.length === 0 && !state.result) {
    const empty = document.createElement('div')
    empty.className = 'empty-state'
    const copy = document.createElement('sp-detail')
    copy.textContent = '暂无生成结果'
    empty.append(copy)
    refs.threadContent.append(empty)
    return
  }

  state.history.forEach((turn) => {
    const item = document.createElement('article')
    item.className = 'turn'

    const userMessage = document.createElement('section')
    userMessage.className = 'user-message'

    if (turn.references.length) {
      const referenceRow = document.createElement('div')
      referenceRow.className = 'sent-reference-row'
      turn.references.forEach((reference, index) => {
        const thumb = document.createElement('img')
        thumb.src = reference.previewUrl
        thumb.alt = `${index + 1}. ${reference.label}`
        thumb.style.width = '42px'
        thumb.style.height = '34px'
        thumb.style.borderRadius = '6px'
        thumb.style.objectFit = 'cover'
        referenceRow.append(thumb)
      })
      userMessage.append(referenceRow)
    }

    const prompt = document.createElement('p')
    prompt.textContent = turn.prompt
    userMessage.append(prompt)

    const assistantMessage = document.createElement('section')
    assistantMessage.className = 'assistant-message'

    const header = document.createElement('div')
    header.className = 'response-header'
    const elapsed = document.createElement('span')
    elapsed.textContent = `耗费 ${turn.elapsedSeconds}s`
    header.append(elapsed)

    const response = document.createElement('p')
    response.className = 'response-text'
    response.textContent = `${turn.model} 已生成 1 张图`

    const grid = document.createElement('div')
    grid.className = 'result-grid'
    grid.append(createResultCard(turn.result))

    assistantMessage.append(header, response, grid)
    item.append(userMessage, assistantMessage)
    refs.threadContent.append(item)
  })

  refs.threadContent.scrollTop = refs.threadContent.scrollHeight
}

function createResultCard(image) {
  const card = document.createElement('article')
  card.className = 'result-card'

  const img = document.createElement('img')
  img.src = image.previewUrl
  img.alt = image.label

  const actions = document.createElement('div')
  actions.className = 'result-actions'

  const placeButton = document.createElement('sp-action-button')
  placeButton.textContent = '置入'
  placeButton.addEventListener('click', async () => {
    state.result = image
    await placeResult()
  })

  const upscaleButton = document.createElement('sp-action-button')
  upscaleButton.textContent = '超分'
  upscaleButton.addEventListener('click', () => {
    state.result = image
    upscaleResult()
  })

  const referenceButton = document.createElement('sp-action-button')
  referenceButton.textContent = '参考'
  referenceButton.addEventListener('click', () => {
    state.result = image
    useResultAsReference()
  })

  actions.append(placeButton, upscaleButton, referenceButton)
  card.append(img, actions)
  return card
}

function setGenerationStatus(message) {
  refs.generationStatus.textContent = message
}

function stopGenerationTimer() {
  if (state.generationTimer) {
    clearInterval(state.generationTimer)
    state.generationTimer = null
  }
}

function startGenerationTimer() {
  stopGenerationTimer()
  state.generationStartedAt = Date.now()
  setGenerationStatus('正在生成中... 0s')

  if (typeof setInterval === 'function') {
    state.generationTimer = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - state.generationStartedAt) / 1000)
      setGenerationStatus(`正在生成中... ${elapsedSeconds}s`)
    }, 250)
  }
}

function readDropdownValue(dropdown, fallback) {
  const selected = dropdown.querySelector('sp-menu-item[selected]')
  return dropdown.value || selected?.getAttribute('value') || fallback
}

function updateDocumentInfo() {
  const document = readActiveDocument()
  if (!document) {
    setRuntimeStatus('Photoshop UXP')
    setStatus('请先打开一个 Photoshop 文档')
    return
  }

  const size = readDocumentSize(document)
  const title = document.title || document.name || `Document ${document.id}`
  setRuntimeStatus(`${title} · ${size.width} x ${size.height}`)
  setStatus('Photoshop 已连接')
}

async function runPanelAction(action) {
  if (state.busy) {
    return
  }

  setBusy(true)
  try {
    await action()
    updateDocumentInfo()
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '操作失败')
  } finally {
    setBusy(false)
  }
}

async function handleCapture(kind) {
  closeReferenceMenu()
  await runPanelAction(async () => {
    const image =
      kind === 'visible'
        ? await captureVisibleImage()
        : kind === 'selection'
          ? await captureSelectionImage()
          : await captureSelectedLayerImage()

    addReference(image, `已添加${image.label}`)
  })
}

function handleMockReference(kind) {
  closeReferenceMenu()
  const label = kind === 'upload' ? '上传文件' : '剪贴板'
  addReference(createMockReference(kind, label), `已添加${label}`)
}

async function handleGenerate() {
  closeReferenceMenu()
  await runPanelAction(async () => {
    const promptValue = refs.promptInput.value.trim()
    if (!promptValue && state.references.length === 0) {
      setStatus('请输入提示词或添加参考图')
      return
    }

    const prompt = promptValue || '根据参考图生成'
    const options = readGenerationOptions()
    const sentReferences = [...state.references]
    const sourceReference = sentReferences[sentReferences.length - 1] || null

    startGenerationTimer()
    await Promise.resolve()
    const result =
      options.model === 'copy-reference' && sourceReference
        ? cloneCanvasImage(sourceReference, 'result', '生成结果')
        : createMockResult(prompt, sourceReference, options)
    stopGenerationTimer()

    const elapsedSeconds = Math.max(0, Math.ceil((Date.now() - state.generationStartedAt) / 1000))

	    state.result = result
	    state.references = []
	    renderReferences()
	    state.history.push({
	      id: createId('turn'),
	      prompt,
	      model: options.model,
	      quantity: options.quantity,
	      referenceCount: sentReferences.length,
	      references: sentReferences,
	      result,
	      elapsedSeconds
	    })
    renderHistory()
    refs.promptInput.value = ''
    setGenerationStatus(`生成完成 · ${elapsedSeconds}s`)
    setStatus('生成完成')
  })
}

function useResultAsReference() {
  if (!state.result) {
    setStatus('请先生成结果')
    return
  }

  addReference(cloneCanvasImage(state.result, 'generated', '生成结果'), '已加入参考图')
}

function upscaleResult() {
  if (!state.result) {
    setStatus('请先生成结果')
    return
  }

  state.references = [cloneCanvasImage(state.result, 'upscale', '超分参考')]
  refs.promptInput.value = '提升分辨率'
  if (refs.modelDropdown) {
    refs.modelDropdown.value = 'mock-image'
  }
  if (refs.quantityDropdown) {
    refs.quantityDropdown.value = '1'
  }
  if (refs.qualityDropdown) {
    refs.qualityDropdown.value = 'high'
  }
  if (refs.ratioDropdown) {
    refs.ratioDropdown.value = 'source'
  }
  renderReferences()
  setStatus('已填入超分参数')
}

function resizeRgba(source, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const output = new Uint8Array(targetWidth * targetHeight * 4)

  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x / targetWidth) * sourceWidth))
      const sourceY = Math.min(sourceHeight - 1, Math.floor((y / targetHeight) * sourceHeight))
      const sourceIndex = (sourceY * sourceWidth + sourceX) * 4
      const targetIndex = (y * targetWidth + x) * 4
      output[targetIndex] = source[sourceIndex]
      output[targetIndex + 1] = source[sourceIndex + 1]
      output[targetIndex + 2] = source[sourceIndex + 2]
      output[targetIndex + 3] = source[sourceIndex + 3]
    }
  }

  return output
}

async function createPixelLayer(name) {
  await action.batchPlay(
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

  return app.activeDocument.activeLayers[0]
}

async function readSelectionTarget() {
  const document = readActiveDocument()
  if (!document) {
    throw new Error('请先打开一个 Photoshop 文档')
  }

  let selectionResult
  try {
    const documentBounds = buildFullBounds(document)
    selectionResult = await imaging.getSelection({
      documentID: document.id,
      sourceBounds: documentBounds
    })
    const size = readImageDataSize(selectionResult.imageData)
    const buffer = await getImageDataBuffer(selectionResult.imageData)
    const sourceBounds = normalizeBounds(selectionResult.sourceBounds, documentBounds)
    const mask = toSelectionMask(buffer, size.width, size.height, selectionResult.imageData.components || 1)
    const bounds = readMaskBounds(mask, size.width, size.height, sourceBounds)
    return {
      left: bounds.left,
      top: bounds.top,
      width: bounds.right - bounds.left,
      height: bounds.bottom - bounds.top
    }
  } finally {
    disposeImageData(selectionResult?.imageData)
  }
}

async function readInsertTarget() {
  const document = readActiveDocument()
  if (!document) {
    throw new Error('请先打开一个 Photoshop 文档')
  }

  const targetMode = readDropdownValue(refs.targetDropdown, 'full-canvas')
  if (targetMode === 'current-selection') {
    return readSelectionTarget()
  }

  if (targetMode === 'reference-bounds' && (state.reference || state.result)) {
    const bounds = (state.reference || state.result).bounds
    return {
      left: bounds.left,
      top: bounds.top,
      width: bounds.right - bounds.left,
      height: bounds.bottom - bounds.top
    }
  }

  const size = readDocumentSize(document)
  return {
    left: 0,
    top: 0,
    width: Math.max(1, size.width),
    height: Math.max(1, size.height)
  }
}

async function placeResult() {
  await runPanelAction(async () => {
    if (!state.result) {
      setStatus('请先生成结果')
      return
    }

    const target = await readInsertTarget()
    const resized = resizeRgba(state.result.rgba, state.result.width, state.result.height, target.width, target.height)

    await core.executeAsModal(
      async () => {
        let imageData
        try {
          const layer = await createPixelLayer('Lightyear Banana Result')
          imageData = await imaging.createImageDataFromBuffer(resized, {
            width: target.width,
            height: target.height,
            components: 4,
            colorProfile: COLOR_PROFILE,
            colorSpace: 'RGB'
          })
          await imaging.putPixels({
            documentID: app.activeDocument.id,
            layerID: layer.id,
            imageData,
            replace: true,
            targetBounds: {
              left: target.left,
              top: target.top
            },
            commandName: '置入插件图像'
          })
        } finally {
          disposeImageData(imageData)
        }
      },
      { commandName: '置入 Lightyear Banana 结果' }
    )

    setStatus('已置入 Photoshop')
  })
}

async function createNamedLayer() {
  console.log(LOG_PREFIX, 'createLayer command')
  await core.executeAsModal(
    async () => {
      await createPixelLayer('Lightyear Banana')
    },
    { commandName: '创建 Lightyear Banana 图层' }
  )
}

function showWorkspace() {
  state.activeView = 'workspace'
  refs.workspaceRoute.classList.remove('is-hidden')
  refs.settingsRoute.classList.add('is-hidden')
  refs.backButton.classList.add('is-hidden')
  refs.settingsButton.classList.remove('is-hidden')
  refs.titleText.textContent = 'Lightyear Banana v0.1'
  updateDocumentInfo()
}

function showSettings() {
  state.activeView = 'settings'
  refs.workspaceRoute.classList.add('is-hidden')
  refs.settingsRoute.classList.remove('is-hidden')
  refs.backButton.classList.remove('is-hidden')
  refs.settingsButton.classList.add('is-hidden')
  refs.titleText.textContent = '设置'
  setRuntimeStatus('模型配置')
}

function toggleTheme() {
  state.themeMode = state.themeMode === 'dark' ? 'light' : 'dark'
  refs.pluginShell.classList.toggle('theme-dark', state.themeMode === 'dark')
  refs.pluginShell.classList.toggle('theme-light', state.themeMode === 'light')
  refs.themeButton.textContent = state.themeMode === 'dark' ? '浅色' : '深色'
}

function closeReferenceMenu() {
  refs.referenceMenu.classList.add('is-hidden')
}

function toggleReferenceMenu() {
  refs.referenceMenu.classList.toggle('is-hidden')
}

function bindElements() {
  refs.pluginShell = readElement('pluginShell')
  refs.titleText = readElement('titleText')
  refs.runtimeStatus = readElement('runtimeStatus')
  refs.settingsButton = readElement('settingsButton')
  refs.backButton = readElement('backButton')
  refs.themeButton = readElement('themeButton')
  refs.workspaceRoute = readElement('workspaceRoute')
  refs.settingsRoute = readElement('settingsRoute')
  refs.threadContent = readElement('threadContent')
  refs.statusToast = readElement('statusToast')
  refs.addReferenceButton = readElement('addReferenceButton')
  refs.referenceMenu = readElement('referenceMenu')
  refs.captureVisibleButton = readElement('captureVisibleButton')
  refs.captureSelectionButton = readElement('captureSelectionButton')
  refs.captureLayerButton = readElement('captureLayerButton')
  refs.uploadReferenceButton = readElement('uploadReferenceButton')
  refs.clipboardReferenceButton = readElement('clipboardReferenceButton')
  refs.clearReferencesButton = readElement('clearReferencesButton')
  refs.referenceCount = readElement('referenceCount')
  refs.referenceList = readElement('referenceList')
  refs.referencePreview = readElement('referencePreview')
  refs.promptInput = readElement('promptInput')
  refs.modelDropdown = readElement('modelDropdown')
  refs.sizeDropdown = readElement('sizeDropdown')
  refs.qualityDropdown = readElement('qualityDropdown')
  refs.quantityDropdown = readElement('quantityDropdown')
  refs.ratioDropdown = readElement('ratioDropdown')
  refs.targetDropdown = readElement('targetDropdown')
  refs.generationStatus = readElement('generationStatus')
  refs.generateButton = readElement('generateButton')
  refs.statusLine = readElement('statusLine')
}

function mountPanel() {
  if (state.mounted) {
    console.log(LOG_PREFIX, 'panel remount')
    updateDocumentInfo()
    return
  }

  bindElements()
  refs.settingsButton.addEventListener('click', showSettings)
  refs.backButton.addEventListener('click', showWorkspace)
  refs.themeButton.addEventListener('click', toggleTheme)
  refs.addReferenceButton.addEventListener('click', toggleReferenceMenu)
  refs.captureVisibleButton.addEventListener('click', () => handleCapture('visible'))
  refs.captureSelectionButton.addEventListener('click', () => handleCapture('selection'))
  refs.captureLayerButton.addEventListener('click', () => handleCapture('layer'))
  refs.uploadReferenceButton.addEventListener('click', () => handleMockReference('upload'))
  refs.clipboardReferenceButton.addEventListener('click', () => handleMockReference('clipboard'))
  refs.clearReferencesButton.addEventListener('click', clearReferences)
  refs.promptInput.addEventListener('input', () => setBusy(state.busy))
  refs.promptInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      handleGenerate()
    }
  })
  refs.generateButton.addEventListener('click', handleGenerate)
  state.mounted = true
  updateDocumentInfo()
  renderReferences()
  renderHistory()
  setBusy(false)
  console.log(LOG_PREFIX, 'panel mounted')
  console.log(LOG_PREFIX, 'panel text', document.body?.textContent?.replace(/\s+/g, ' ').trim() || '')
}

uxp.entrypoints.setup({
  commands: {
    createLayer: createNamedLayer
  },
  panels: {
    panel: {
      create() {
        console.log(LOG_PREFIX, 'panel create')
        mountPanel()
      },
      show() {
        console.log(LOG_PREFIX, 'panel show')
        mountPanel()
      }
    }
  }
})

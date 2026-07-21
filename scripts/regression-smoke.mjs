import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tinyPng =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII='

function readTscBin() {
  return join(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc')
}

function compileRegressionSources(outDir) {
  rmSync(outDir, { force: true, recursive: true })
  execFileSync(process.execPath, [readTscBin(),
    '--ignoreConfig',
    '--target',
    'ES2022',
    '--module',
    'commonjs',
    '--moduleResolution',
    'node',
    '--ignoreDeprecations',
    '6.0',
    '--outDir',
    outDir,
    '--rootDir',
    'src',
    '--skipLibCheck',
    'src/services/imageApiClient.ts',
    'src/data/providerCapabilities.ts',
    'src/utils/imagePixels.ts',
    'src/uxp/canvasPrimitives.ts'
  ], { stdio: 'pipe' })
}

function createReference(width = 2955, height = 2362, mimeType = 'image/png', sourceBounds) {
  return {
    id: 'reference-1',
    source: 'selection',
    label: '选区',
    image: {
      id: 'selection-1',
      label: '选区图像',
      width,
      height,
      sourceBounds: sourceBounds ?? { left: 0, top: 0, right: width, bottom: height },
      previewUrl: `data:${mimeType};base64,${tinyPng}`,
      rgba: new Uint8Array()
    }
  }
}

function createConfig(provider, model) {
  return {
    id: `${provider}-${model}`,
    name: `${provider} ${model}`,
    provider,
    model,
    models: [model],
    apiKey: 'test-key',
    baseUrl: '',
    enabled: true,
    usesOfficialBaseUrl: true
  }
}

function readJsonRequest(requests, pattern) {
  const request = requests.find((item) => pattern.test(item.url))
  assert.ok(request, `Missing request matching ${pattern}`)
  assert.equal(typeof request.init.body, 'string')
  return JSON.parse(request.init.body)
}

async function testProviderRatios(imageApi) {
  const nativeFetch = globalThis.fetch
  const nativeConsoleInfo = console.info
  const nativeFileReader = globalThis.FileReader
  const requests = []

  console.info = () => {}

  globalThis.FileReader = class MockFileReader {
    listeners = new Map()
    result = null
    error = null

    addEventListener(type, listener) {
      this.listeners.set(type, listener)
    }

    readAsDataURL(blob) {
      void blob.arrayBuffer().then((buffer) => {
        this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`
        this.listeners.get('load')?.()
      }).catch((error) => {
        this.error = error
        this.listeners.get('error')?.()
      })
    }
  }

  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    if (url.startsWith('data:')) {
      return nativeFetch(input, init)
    }

    if (url === 'https://example.test/reference.jpg') {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
        headers: { 'content-type': 'image/jpeg' }
      })
    }

    requests.push({ url, init })

    if (url.endsWith('/v1/uploads/images')) {
      return Response.json({ url: 'https://example.test/reference.png' })
    }

    if (url.includes('generateContent')) {
      return Response.json({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: tinyPng } }] } }]
      })
    }

    if (url.includes('/api/v1/services/aigc/multimodal-generation/generation')) {
      return Response.json({
        output: { choices: [{ message: { content: [{ image: 'https://example.test/generated.png' }] } }] }
      })
    }

    return Response.json({ data: [{ url: 'https://example.test/generated.png' }] })
  }

  const baseParams = {
    count: 1,
    prompt: 'regression test',
    quality: '自动',
    ratio: '原图比例',
    references: [createReference()],
    selectedSize: '4K',
    size: '4K'
  }

  try {
    await imageApi.generateImagesWithProvider({
      ...baseParams,
      references: [createReference(1200, 960)],
      config: createConfig('apimart', 'gemini-3.1-flash-image-preview')
    })
    let body = readJsonRequest(requests, /api\.apimart\.ai\/v1\/images\/generations$/)
    assert.equal(body.size, 'auto', 'APIMart Gemini 3.1 original ratio must use auto even for a legal 5:4 input')
    assert.equal(body.resolution, '4K')

    requests.length = 0
    await imageApi.generateImagesWithProvider({
      ...baseParams,
      config: createConfig('apimart', 'gemini-3-pro-image-preview-official')
    })
    body = readJsonRequest(requests, /api\.apimart\.ai\/v1\/images\/generations$/)
    assert.equal(body.size, 'auto', 'APIMart Gemini 3 Pro original ratio must use auto')

    requests.length = 0
    await imageApi.generateImagesWithProvider({
      ...baseParams,
      selectedSize: '0.5K',
      size: '0.5K',
      config: createConfig('apimart', 'nano-banana-2-ext')
    })
    body = readJsonRequest(requests, /api\.apimart\.ai\/v1\/images\/generations$/)
    assert.equal(body.size, 'auto', 'APIMart Nano Banana 2 alias must use auto')
    assert.equal(body.resolution, '0.5K')

    requests.length = 0
    await imageApi.generateImagesWithProvider({
      ...baseParams,
      selectedSize: '0.5K',
      size: '0.5K',
      config: createConfig('apimart', 'nano-banana-pro')
    })
    body = readJsonRequest(requests, /api\.apimart\.ai\/v1\/images\/generations$/)
    assert.equal(body.size, 'auto', 'APIMart Nano Banana Pro alias must use auto')
    assert.equal(body.resolution, '1K', 'APIMart Nano Banana Pro alias must use Pro resolution tiers')

    for (const alias of ['nano-banana-2', 'nano-banana-pro-ext']) {
      requests.length = 0
      await imageApi.generateImagesWithProvider({
        ...baseParams,
        config: createConfig('apimart', alias)
      })
      body = readJsonRequest(requests, /api\.apimart\.ai\/v1\/images\/generations$/)
      assert.equal(body.size, 'auto', `APIMart ${alias} must use auto`)
    }

    requests.length = 0
    await imageApi.generateImagesWithProvider({
      ...baseParams,
      config: createConfig('apimart', 'gpt-image-2')
    })
    body = readJsonRequest(requests, /api\.apimart\.ai\/v1\/images\/generations$/)
    assert.equal('size' in body, false, 'APIMart GPT Image 2 must omit size when following an input image')

    requests.length = 0
    await imageApi.generateImagesWithProvider({
      ...baseParams,
      ratio: '4:3',
      config: createConfig('apimart', 'gemini-3.1-flash-image-preview')
    })
    body = readJsonRequest(requests, /api\.apimart\.ai\/v1\/images\/generations$/)
    assert.equal(body.size, '4:3', 'An explicit APIMart ratio must remain explicit')

    requests.length = 0
    await imageApi.generateImagesWithProvider({
      ...baseParams,
      references: [createReference(2955, 2362, 'image/jpeg')],
      size: '4k',
      selectedSize: '4k',
      config: createConfig('gemini', 'gemini-3-pro-image-preview')
    })
    body = readJsonRequest(requests, /generateContent/)
    assert.equal('aspectRatio' in body.generationConfig.imageConfig, false, 'Gemini original ratio must omit aspectRatio')
    assert.equal(body.contents[0].parts[1].inlineData.mimeType, 'image/jpeg')

    requests.length = 0
    await imageApi.generateImagesWithProvider({
      ...baseParams,
      ratio: '4:3',
      references: [createReference(2955, 2362, 'image/jpeg')],
      size: '4k',
      selectedSize: '4k',
      config: createConfig('gemini', 'gemini-3-pro-image-preview')
    })
    body = readJsonRequest(requests, /generateContent/)
    assert.equal(body.generationConfig.imageConfig.aspectRatio, '4:3')

    requests.length = 0
    const remoteReference = createReference(1600, 900, 'image/jpeg')
    remoteReference.image.previewUrl = 'https://example.test/reference.jpg'
    await imageApi.generateImagesWithProvider({
      ...baseParams,
      references: [remoteReference],
      size: '2k',
      selectedSize: '2k',
      config: createConfig('gemini', 'gemini-3-pro-image-preview')
    })
    body = readJsonRequest(requests, /generateContent/)
    assert.equal(body.contents[0].parts[1].inlineData.mimeType, 'image/jpeg')
    assert.ok(body.contents[0].parts[1].inlineData.data.length > 0)
    assert.equal('aspectRatio' in body.generationConfig.imageConfig, false)

    requests.length = 0
    const qwenParams = {
      ...baseParams,
      references: [createReference(1600, 900, 'image/png', { left: 0, top: 0, right: 1000, bottom: 1000 })],
      size: '2k',
      selectedSize: '2k',
      config: createConfig('qwen', 'qwen-image-2.0-pro')
    }
    const qwenSize = imageApi.resolveImageRequestSize(qwenParams)
    await imageApi.generateImagesWithProvider({ ...qwenParams, size: qwenSize })
    body = readJsonRequest(requests, /multimodal-generation\/generation$/)
    assert.match(body.parameters.size, /^\d+\*\d+$/)
    const [qwenWidth, qwenHeight] = body.parameters.size.split('*').map(Number)
    assert.ok(Math.abs(qwenWidth / qwenHeight - 16 / 9) < 0.02, 'Provider sizing must use intrinsic image dimensions before source bounds')
  } finally {
    globalThis.fetch = nativeFetch
    console.info = nativeConsoleInfo
    if (nativeFileReader === undefined) {
      delete globalThis.FileReader
    } else {
      globalThis.FileReader = nativeFileReader
    }
  }
}

function testApimartAliasCapabilities(providerCapabilities) {
  const nano2 = providerCapabilities.readProviderCapability(createConfig('apimart', 'nano-banana-2'))
  const nanoPro = providerCapabilities.readProviderCapability(createConfig('apimart', 'nano-banana-pro-ext'))

  assert.deepEqual(nano2.sizeOptions, ['0.5K', '1K', '2K', '4K'])
  assert.ok(nano2.ratioOptions.includes('1:8'))
  assert.deepEqual(nanoPro.sizeOptions, ['1K', '2K', '4K'])
  assert.equal(nanoPro.ratioOptions.includes('1:8'), false)
}

function createImageResult({ width, height, components, data, bounds }) {
  return {
    imageData: {
      width,
      height,
      components,
      async getData() {
        return new Uint8Array(data)
      },
      dispose() {}
    },
    sourceBounds: bounds
  }
}

async function testVisibleCompositeAfterPlacedSmartObject(canvasPrimitives) {
  const calls = []
  const batchPlayCalls = []
  let temporaryFileDeleted = false
  let duplicateCalls = 0
  const bounds = { left: 0, top: 0, right: 2, bottom: 1 }
  const backgroundLayer = { id: 7, name: '背景', bounds, boundsNoEffects: bounds }
  const placedLayer = {
    id: 10,
    name: '生成图 1',
    bounds,
    boundsNoEffects: bounds,
    async scale() {},
    async translate() {}
  }
  const sourceDocument = {
    id: 1,
    width: 2,
    height: 1,
    activeLayers: [backgroundLayer],
    layers: [backgroundLayer],
    async duplicate() {
      duplicateCalls += 1
      throw new Error('Photoshop Error. Code: -32005. Message: 无法更新智能对象文件')
    }
  }
  const photoshop = {
    action: {
      async batchPlay(commands) {
        batchPlayCalls.push(...commands)
        if (commands.some((command) => command._obj === 'placeEvent')) {
          sourceDocument.activeLayers = [placedLayer]
          sourceDocument.layers = [placedLayer, backgroundLayer]
        }
        return []
      }
    },
    app: { activeDocument: sourceDocument },
    core: { async executeAsModal(target) { return target() } },
    imaging: {
      async getPixels(options) {
        calls.push({ ...options })
        return createImageResult({
          width: 2,
          height: 1,
          components: 4,
          data: [255, 0, 0, 255, 0, 0, 255, 255],
          bounds
        })
      },
      async createImageDataFromBuffer(data, options) {
        return {
          width: options.width,
          height: options.height,
          components: options.components,
          async getData() { return data },
          dispose() {}
        }
      },
      async encodeImageData() { return 'preview' },
      async putPixels() {}
    }
  }
  const uxp = {
    storage: {
      formats: { binary: 'binary' },
      localFileSystem: {
        async getTemporaryFolder() {
          return {
            async createFile() {
              return {
                async write() {},
                async delete() { temporaryFileDeleted = true }
              }
            }
          }
        },
        createSessionToken() { return 'temporary-preview-token' }
      }
    }
  }

  const originalHostRequire = globalThis.require
  globalThis.require = (name) => {
    if (name === 'photoshop') return photoshop
    if (name === 'uxp') return uxp
    throw new Error(`Unexpected host module: ${name}`)
  }

  try {
    await canvasPrimitives.insertPreviewImage({
      id: 'generated-1',
      label: '生成图 1',
      width: 1,
      height: 1,
      sourceBounds: { left: 0, top: 0, right: 1, bottom: 1 },
      previewUrl: `data:image/png;base64,${tinyPng}`,
      rgba: new Uint8Array([255, 0, 0, 255])
    }, { left: 0, top: 0, width: 2, height: 1 })

    assert.equal(batchPlayCalls.some((command) => command._obj === 'placeEvent'), true)
    assert.equal(temporaryFileDeleted, true)
    const captured = await canvasPrimitives.captureVisibleComposite()
    assert.deepEqual(Array.from(captured.rgba), [255, 0, 0, 255, 0, 0, 255, 255])
    assert.equal(calls.length, 1)
    assert.equal(calls[0].documentID, sourceDocument.id)
    assert.equal('layerID' in calls[0], false, 'Visible capture must read the document composite without a layerID')
    assert.equal(duplicateCalls, 0, 'Visible capture must not duplicate a document containing a placed smart object')
  } finally {
    if (originalHostRequire === undefined) {
      delete globalThis.require
    } else {
      globalThis.require = originalHostRequire
    }
  }
}

async function testSelectionVisibleComposite(canvasPrimitives) {
  const calls = []
  let duplicateClosed = false
  let duplicateOptions
  const bounds = { left: 0, top: 0, right: 2, bottom: 1 }
  const activeLayer = { id: 7, name: 'active', bounds, boundsNoEffects: bounds }
  const lowerLayer = { id: 8, name: 'lower', bounds, boundsNoEffects: bounds }
  const mergedLayer = { id: 99, name: 'merged', bounds, boundsNoEffects: bounds }
  let photoshop

  const sourceDocument = {
    id: 1,
    width: 2,
    height: 1,
    activeLayers: [activeLayer, { id: 9, name: 'adjustment', bounds, boundsNoEffects: bounds }],
    layers: [activeLayer, lowerLayer],
    async duplicate(name, mergeLayersOnly) {
      duplicateOptions = { name, mergeLayersOnly }
      photoshop.app.activeDocument = mergedDocument
      return mergedDocument
    }
  }
  const mergedDocument = {
    id: 2,
    width: 2,
    height: 1,
    activeLayers: [mergedLayer],
    layers: [mergedLayer],
    closeWithoutSaving() {
      duplicateClosed = true
      photoshop.app.activeDocument = sourceDocument
    }
  }

  photoshop = {
    action: { async batchPlay() { return [] } },
    app: { activeDocument: sourceDocument },
    core: { async executeAsModal(target) { return target() } },
    imaging: {
      async getSelection() {
        return createImageResult({ width: 2, height: 1, components: 1, data: [255, 255], bounds })
      },
      async getPixels(options) {
        calls.push({ ...options })
        if (options.layerID === 99) {
          return createImageResult({
            width: 2,
            height: 1,
            components: 4,
            data: [255, 255, 255, 255, 0, 0, 0, 255],
            bounds
          })
        }

        return createImageResult({
          width: 2,
          height: 1,
          components: 4,
          data: [255, 255, 255, 255, 0, 0, 0, 0],
          bounds
        })
      },
      async createImageDataFromBuffer(data, options) {
        return {
          width: options.width,
          height: options.height,
          components: options.components,
          async getData() { return data },
          dispose() {}
        }
      },
      async encodeImageData() { return 'preview' },
      async putPixels() {}
    }
  }

  const originalHostRequire = globalThis.require
  globalThis.require = (name) => {
    assert.equal(name, 'photoshop')
    return photoshop
  }

  try {
    const captured = await canvasPrimitives.captureSelectionComposite()
    assert.deepEqual(Array.from(captured.rgba), [255, 255, 255, 255, 0, 0, 0, 255])
    assert.equal(duplicateOptions.mergeLayersOnly, true)
    assert.equal(duplicateClosed, true)
    assert.deepEqual(calls.map((call) => call.layerID), [99])

    duplicateClosed = false
    calls.length = 0
    photoshop.imaging.getPixels = async () => {
      throw new Error('merged read failed')
    }
    await assert.rejects(() => canvasPrimitives.captureSelectionComposite(), /merged read failed/)
    assert.equal(duplicateClosed, true, 'Merged read failures must still close the temporary document')

    photoshop.imaging.getPixels = async (options) => {
      calls.push({ ...options })
      return createImageResult({
        width: 2,
        height: 1,
        components: 4,
        data: [255, 255, 255, 255, 0, 0, 0, 255],
        bounds
      })
    }
    mergedDocument.closeWithoutSaving = () => {
      throw new Error('temporary close failed')
    }
    await assert.rejects(() => canvasPrimitives.captureSelectionComposite(), /temporary close failed/)
    photoshop.app.activeDocument = sourceDocument
  } finally {
    if (originalHostRequire === undefined) {
      delete globalThis.require
    } else {
      globalThis.require = originalHostRequire
    }
  }
}

async function testRemoteImageDimensionsAndPreviewStyle(requireFromBuild, outDir) {
  const originalImage = globalThis.Image
  const originalFetch = globalThis.fetch

  globalThis.fetch = async () => {
    throw new Error('CORS')
  }
  globalThis.Image = class MockImage {
    naturalWidth = 1600
    naturalHeight = 900
    crossOrigin = ''
    onload = null
    onerror = null

    set src(_value) {
      queueMicrotask(() => {
        if (this.crossOrigin === 'anonymous') {
          this.onerror?.(new Error('CORS'))
        } else {
          this.onload?.()
        }
      })
    }
  }

  try {
    const imagePixels = requireFromBuild(join(outDir, 'utils', 'imagePixels.js'))
    const image = await imagePixels.createCanvasImageFromApiAsset({
      id: 'generated-1',
      label: '生成图 1',
      modelConfigId: 'model-1',
      modelName: 'model',
      previewUrl: 'https://example.test/no-cors.png'
    })

    assert.equal(image.width, 1600)
    assert.equal(image.height, 900)
    assert.deepEqual(image.sourceBounds, { left: 0, top: 0, right: 1600, bottom: 900 })
  } finally {
    globalThis.Image = originalImage
    globalThis.fetch = originalFetch
  }

  const messageThread = await readFile(new URL('../src/components/lightyear/MessageThread.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(messageThread, /aspect-ratio:\s*1\s*\/\s*1/)
  assert.match(messageThread, /aspectRatio:\s*readResultAspectRatio\(image\)/)
  assert.match(messageThread, /@load="handleResultImageLoad\(\$event, image\)"/)
  assert.match(messageThread, /element\?\.naturalWidth/)
  assert.match(messageThread, /object-fit:\s*contain/)
}

async function main() {
  const outDir = join(tmpdir(), 'lightyear-banana-regression-smoke')
  compileRegressionSources(outDir)
  const requireFromBuild = createRequire(import.meta.url)

  try {
    const imageApi = requireFromBuild(join(outDir, 'services', 'imageApiClient.js'))
    const providerCapabilities = requireFromBuild(join(outDir, 'data', 'providerCapabilities.js'))
    const canvasPrimitives = requireFromBuild(join(outDir, 'uxp', 'canvasPrimitives.js'))
    await testProviderRatios(imageApi)
    testApimartAliasCapabilities(providerCapabilities)
    await testVisibleCompositeAfterPlacedSmartObject(canvasPrimitives)
    await testSelectionVisibleComposite(canvasPrimitives)
    await testRemoteImageDimensionsAndPreviewStyle(requireFromBuild, outDir)
    console.log('Canvas capture and source-ratio regressions passed.')
  } finally {
    rmSync(outDir, { force: true, recursive: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

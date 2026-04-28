import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'

const pluginDir = path.dirname(fileURLToPath(import.meta.url))
const source = readFileSync(path.join(pluginDir, 'main.js'), 'utf8')
const logs = []
const listeners = new Map()
const elements = new Map()
const createdLayers = []
const putPixelsCalls = []

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

class MockElement {
  constructor(tagName, id = '') {
    this.tagName = tagName
    this.id = id
    this.children = []
    this.attributes = {}
    this.listeners = {}
    this.classList = {
      values: new Set(),
      add: (...names) => names.forEach((name) => this.classList.values.add(name)),
      remove: (...names) => names.forEach((name) => this.classList.values.delete(name)),
      contains: (name) => this.classList.values.has(name),
      toggle: (name, force) => {
        const shouldAdd = force === undefined ? !this.classList.values.has(name) : Boolean(force)
        if (shouldAdd) {
          this.classList.values.add(name)
        } else {
          this.classList.values.delete(name)
        }
      }
    }
    this.disabled = false
    this.textContent = ''
    this.value = ''
    this.style = {}
    this.scrollTop = 0
    this.scrollHeight = 0
    this._innerHTML = ''
    Object.defineProperty(this, 'innerHTML', {
      get: () => this._innerHTML,
      set: (value) => {
        this._innerHTML = value
        this.children = []
      }
    })
  }

  append(...children) {
    this.children.push(...children)
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener
    if (this.id) {
      listeners.set(`${this.id}:${type}`, listener)
    }
  }

  querySelector(selector) {
    if (selector === 'sp-menu-item[selected]') {
      return {
        getAttribute: () => this.value || null
      }
    }

    return null
  }
}

function ensureElement(id) {
  if (!elements.has(id)) {
    elements.set(id, new MockElement('div', id))
  }

  return elements.get(id)
}

for (const id of [
  'pluginShell',
  'titleText',
  'runtimeStatus',
  'settingsButton',
  'backButton',
  'themeButton',
  'workspaceRoute',
  'settingsRoute',
  'threadContent',
  'statusToast',
  'addReferenceButton',
  'referenceMenu',
  'captureVisibleButton',
  'captureSelectionButton',
  'captureLayerButton',
  'uploadReferenceButton',
  'clipboardReferenceButton',
  'clearReferencesButton',
  'referenceCount',
  'referenceList',
  'referencePreview',
  'promptInput',
  'modelDropdown',
  'sizeDropdown',
  'qualityDropdown',
  'quantityDropdown',
  'ratioDropdown',
  'targetDropdown',
  'generationStatus',
  'generateButton',
  'statusLine'
]) {
  ensureElement(id)
}

ensureElement('targetDropdown').value = 'full-canvas'
ensureElement('modelDropdown').value = 'mock-image'
ensureElement('sizeDropdown').value = '512'
ensureElement('qualityDropdown').value = 'standard'
ensureElement('quantityDropdown').value = '1'
ensureElement('ratioDropdown').value = 'source'
ensureElement('promptInput').value = '生成一张蓝色测试图'

function createImageResult(width, height, components = 4, sourceBounds = { left: 0, top: 0, right: width, bottom: height }) {
  const data = new Uint8Array(width * height * components)
  for (let i = 0; i < width * height; i += 1) {
    const index = i * components
    data[index] = 40
    if (components > 1) {
      data[index + 1] = 120
      data[index + 2] = 220
    }
    if (components > 3) {
      data[index + 3] = 255
    }
  }

  return {
    imageData: {
      width,
      height,
      components,
      getData: async () => data,
      dispose: () => logs.push(`dispose:${width}x${height}`)
    },
    sourceBounds
  }
}

const photoshop = {
  app: {
    activeDocument: {
      id: 101,
      title: 'Smoke Test.psd',
      width: 640,
      height: 480,
      activeLayers: [{ id: 7, name: 'Layer 1', bounds: { left: 10, top: 20, right: 210, bottom: 180 } }]
    }
  },
  core: {
    executeAsModal: async (callback) => callback()
  },
  action: {
    batchPlay: async () => {
      const layer = { id: createdLayers.length + 20, name: 'Mock Layer' }
      photoshop.app.activeDocument.activeLayers = [layer]
      createdLayers.push(layer)
      return [{ layerID: layer.id }]
    }
  },
  imaging: {
    getPixels: async (options) => createImageResult(
      Math.max(1, (options.sourceBounds?.right || 128) - (options.sourceBounds?.left || 0)),
      Math.max(1, (options.sourceBounds?.bottom || 96) - (options.sourceBounds?.top || 0)),
      4,
      options.sourceBounds || { left: 0, top: 0, right: 128, bottom: 96 }
    ),
    getSelection: async () => {
      const width = 640
      const height = 480
      const data = new Uint8Array(width * height)
      for (let y = 80; y < 220; y += 1) {
        for (let x = 120; x < 340; x += 1) {
          data[y * width + x] = 255
        }
      }
      return {
        imageData: {
          width,
          height,
          components: 1,
          getData: async () => data,
          dispose: () => logs.push('dispose:selection')
        },
        sourceBounds: { left: 0, top: 0, right: width, bottom: height }
      }
    },
    createImageDataFromBuffer: async (data, options) => ({
      width: options.width,
      height: options.height,
      components: options.components,
      data,
      dispose: () => logs.push(`dispose:created:${options.width}x${options.height}`)
    }),
    encodeImageData: async () => 'mock-base64',
    putPixels: async (options) => {
      putPixelsCalls.push(options)
    }
  }
}

let entrypointsConfig
const context = {
  console,
  document: {
    getElementById: ensureElement,
    createElement: (tagName) => new MockElement(tagName)
  },
  require: (name) => {
    if (name === 'uxp') {
      return {
        entrypoints: {
          setup(config) {
            entrypointsConfig = config
          }
        }
      }
    }

    if (name === 'photoshop') {
      return photoshop
    }

    throw new Error(`Unexpected require: ${name}`)
  },
  Uint8Array,
  Date,
  Math,
  Number,
  String,
  Boolean,
  Error,
  Map,
  Set,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval
}

vm.runInNewContext(source, context, {
  filename: 'standalone-uxp-plugin/main.js'
})

assert(entrypointsConfig, 'entrypoints.setup was not called')
assert(entrypointsConfig.panels?.panel?.create, 'panel create entrypoint missing')
assert(entrypointsConfig.commands?.createLayer, 'createLayer command missing')

await entrypointsConfig.commands.createLayer()
assert(createdLayers.length === 1, 'createLayer did not create a layer')

entrypointsConfig.panels.panel.create()
assert(ensureElement('runtimeStatus').textContent.includes('Smoke Test.psd'), 'document status was not rendered')

await listeners.get('captureVisibleButton:click')()
assert(ensureElement('referenceList').children.length === 1, 'reference strip was not rendered')
assert(ensureElement('referenceCount').textContent === '1 / 4', 'reference count was not updated')

await listeners.get('generateButton:click')()
assert(ensureElement('threadContent').children.length === 1, 'result turn was not rendered')
assert(ensureElement('referenceCount').textContent === '0 / 4', 'references were not cleared after generate')

const turn = ensureElement('threadContent').children[0]
const assistantMessage = turn.children[1]
const resultGrid = assistantMessage.children[2]
const resultCard = resultGrid.children[0]
const resultActions = resultCard.children[1]
const placeAction = resultActions.children[0]
const upscaleAction = resultActions.children[1]
const referenceAction = resultActions.children[2]

referenceAction.listeners.click()
assert(ensureElement('referenceCount').textContent === '1 / 4', 'result was not added as reference')

upscaleAction.listeners.click()
assert(ensureElement('promptInput').value === '提升分辨率', 'upscale did not fill prompt')
assert(ensureElement('referenceCount').textContent === '1 / 4', 'upscale did not replace references')

listeners.get('clearReferencesButton:click')()
listeners.get('uploadReferenceButton:click')()
listeners.get('clipboardReferenceButton:click')()
assert(ensureElement('referenceCount').textContent === '2 / 4', 'mock reference sources were not added')

await placeAction.listeners.click()
assert(putPixelsCalls.length === 1, 'putPixels was not called')
assert(putPixelsCalls[0].documentID === 101, 'putPixels did not target active document')
assert(typeof putPixelsCalls[0].layerID === 'number', 'putPixels did not target created layer')

console.log('Standalone UXP plugin smoke test passed')

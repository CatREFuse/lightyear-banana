import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createConsecutiveActivation,
  createPrismLifecycle,
  installWordmarkFallback,
  resolveCcxReleaseUpdate
} from '../site/app.js'

function fakeStage() {
  const classes = new Set()
  return {
    classes,
    classList: {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value)
    }
  }
}

function fakeScene() {
  const calls = { dispose: 0, pause: 0, resume: 0 }
  return {
    calls,
    dispose: () => { calls.dispose += 1 },
    pause: () => { calls.pause += 1 },
    resume: () => { calls.resume += 1 }
  }
}

test('shows a readable Mugen fallback when the generated wordmark cannot load', () => {
  let onError
  const removed = []
  const classes = new Set()
  const image = {
    complete: false,
    naturalWidth: 0,
    addEventListener: (type, listener) => {
      assert.equal(type, 'error')
      onError = listener
    },
    removeEventListener: (type, listener) => removed.push([type, listener])
  }
  const brand = { classList: { add: (value) => classes.add(value) } }

  const dispose = installWordmarkFallback(image, brand)
  assert.equal(classes.has('wordmark-unavailable'), false)
  onError()
  assert.equal(classes.has('wordmark-unavailable'), true)
  dispose()
  assert.deepEqual(removed, [['error', onError]])

  const alreadyBroken = { ...image, complete: true }
  const immediateClasses = new Set()
  installWordmarkFallback(alreadyBroken, {
    classList: { add: (value) => immediateClasses.add(value) }
  })
  assert.equal(immediateClasses.has('wordmark-unavailable'), true)
})

test('validates one coherent CCX release update before changing the page', () => {
  const release = {
    ccxVersion: '1.2.3',
    downloads: {
      ccx: {
        filename: 'mugen-1.2.3.ccx',
        url: 'https://mugen.example/releases/1.2.3/mugen-1.2.3.ccx'
      }
    }
  }

  assert.deepEqual(
    resolveCcxReleaseUpdate(release, 'https://mugen.example/'),
    {
      href: 'https://mugen.example/releases/1.2.3/mugen-1.2.3.ccx',
      version: '1.2.3'
    }
  )
  assert.equal(resolveCcxReleaseUpdate({
    ...release,
    ccxVersion: '1.2.4'
  }, 'https://mugen.example/'), null)
  assert.equal(resolveCcxReleaseUpdate({
    ...release,
    downloads: { ccx: { ...release.downloads.ccx, url: '' } }
  }, 'https://mugen.example/'), null)
  assert.equal(resolveCcxReleaseUpdate({
    ...release,
    downloads: { ccx: { ...release.downloads.ccx, url: 'http://downloads.example/mugen.ccx' } }
  }, 'https://mugen.example/'), null)
  assert.equal(resolveCcxReleaseUpdate({
    ...release,
    downloads: { ccx: { ...release.downloads.ccx, url: 'https://mugen.example/releases/1.2.3/another.ccx' } }
  }, 'https://mugen.example/'), null)
  assert.equal(resolveCcxReleaseUpdate(release, 'not a valid base URL'), null)
})

test('pauses and resumes one scene across repeated BFCache visits', async () => {
  const stage = fakeStage()
  const scene = fakeScene()
  let loads = 0
  const lifecycle = createPrismLifecycle({
    stage,
    loadScene: async () => {
      loads += 1
      return scene
    }
  })

  await lifecycle.initialize()
  lifecycle.handlePageHide({ persisted: true })
  lifecycle.handlePageShow({ persisted: true })
  lifecycle.handlePageHide({ persisted: true })
  lifecycle.handlePageShow({ persisted: true })

  assert.equal(loads, 1)
  assert.deepEqual(scene.calls, { dispose: 0, pause: 2, resume: 2 })
  assert.equal(stage.classes.has('webgl-unavailable'), false)
})

test('disposes a scene that finishes loading after a terminal pagehide', async () => {
  const stage = fakeStage()
  const scene = fakeScene()
  let finishLoading
  const lifecycle = createPrismLifecycle({
    stage,
    loadScene: () => new Promise((resolve) => { finishLoading = resolve })
  })

  const initializing = lifecycle.initialize()
  lifecycle.handlePageHide({ persisted: false })
  finishLoading(scene)
  await initializing
  lifecycle.handlePageShow({ persisted: true })

  assert.deepEqual(scene.calls, { dispose: 1, pause: 0, resume: 0 })
})

test('keeps a fatal scene in the static fallback across BFCache restoration', async () => {
  const stage = fakeStage()
  const scene = fakeScene()
  let reportFatal
  let loads = 0
  const lifecycle = createPrismLifecycle({
    stage,
    loadScene: async (onFatal) => {
      loads += 1
      reportFatal = onFatal
      return scene
    }
  })

  await lifecycle.initialize()
  reportFatal(new Error('render failed'))
  lifecycle.handlePageHide({ persisted: true })
  lifecycle.handlePageShow({ persisted: true })

  assert.equal(stage.classes.has('webgl-unavailable'), true)
  assert.equal(loads, 1)
  assert.deepEqual(scene.calls, { dispose: 0, pause: 0, resume: 0 })
})

test('uses the static fallback when scene construction fails', async () => {
  const stage = fakeStage()
  const lifecycle = createPrismLifecycle({
    stage,
    loadScene: async () => { throw new Error('WebGL unavailable') }
  })

  await assert.doesNotReject(lifecycle.initialize())
  assert.equal(stage.classes.has('webgl-unavailable'), true)
})

test('unlocks the prism controls on five consecutive prism clicks', () => {
  let currentTime = 0
  let activations = 0
  const unlock = createConsecutiveActivation({
    onActivate: () => { activations += 1 },
    now: () => currentTime
  })

  for (let index = 0; index < 4; index += 1) {
    assert.equal(unlock.trigger(), false)
    currentTime += 120
  }
  assert.equal(unlock.trigger(), true)
  assert.equal(activations, 1)
})

test('resets the prism click sequence when clicks are too far apart', () => {
  let currentTime = 0
  let activations = 0
  const unlock = createConsecutiveActivation({
    onActivate: () => { activations += 1 },
    now: () => currentTime
  })

  for (let index = 0; index < 4; index += 1) {
    unlock.trigger()
    currentTime += 120
  }
  currentTime += 900
  assert.equal(unlock.trigger(), false)
  assert.equal(activations, 0)
})

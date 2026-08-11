import assert from 'node:assert/strict'
import test from 'node:test'
import { createApimartFixtureServer, expectedApiKey } from './apimart-smoke-server.mjs'

test('serves the APIMart upload, submit, poll, and cat result contract', async (context) => {
  const fixture = createApimartFixtureServer({ port: 0 })
  const baseUrl = await fixture.start()
  context.after(() => fixture.stop())
  const auth = { Authorization: `Bearer ${expectedApiKey}` }
  const models = await fetch(`${baseUrl}/v1/models`, { headers: auth })
  assert.equal(models.status, 200)
  assert.deepEqual((await models.json()).data.map((model) => model.id), [
    'gemini-3.1-flash-image-preview',
    'gpt-image-1'
  ])

  const form = new FormData()
  form.append('file', new Blob(['reference'], { type: 'image/jpeg' }), 'reference.jpg')
  const upload = await fetch(`${baseUrl}/v1/uploads/images`, { method: 'POST', headers: auth, body: form })
  assert.equal(upload.status, 200)
  const uploaded = await upload.json()
  assert.match(uploaded.url, /\/fixtures\/cat\.jpg$/)
  assert.equal(uploaded.content_type, 'image/jpeg')

  const submit = await fetch(`${baseUrl}/v1/images/generations`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gemini-3.1-flash-image-preview', prompt: '生成小猫', n: 1, size: '1:1', image_urls: [uploaded.url] })
  })
  assert.equal(submit.status, 200)
  const submitted = await submit.json()
  assert.equal(submitted.code, 200)
  assert.equal(submitted.data[0].status, 'submitted')

  const poll = await fetch(`${baseUrl}/v1/tasks/${submitted.data[0].task_id}?language=zh`, { headers: auth })
  assert.equal(poll.status, 200)
  const completed = await poll.json()
  assert.equal(completed.data.status, 'completed')
  assert.match(completed.data.result.images[0].url[0], /\/fixtures\/cat\.jpg$/)
  const cat = await fetch(completed.data.result.images[0].url[0])
  assert.equal(cat.headers.get('content-type'), 'image/jpeg')
  assert.ok((await cat.arrayBuffer()).byteLength > 0)

  const stateResponse = await fetch(`${baseUrl}/__smoke/state`)
  assert.equal(stateResponse.status, 200)
  const state = await stateResponse.json()
  assert.deepEqual({
    modelChecks: state.modelChecks,
    uploads: state.uploads,
    generations: state.generations,
    polls: state.polls,
    imageDownloads: state.imageDownloads
  }, { modelChecks: 1, uploads: 1, generations: 1, polls: 1, imageDownloads: 1 })
  assert.equal(state.lastUpload.hasFile, true)
  assert.ok(state.lastUpload.bytes > 0)
  assert.deepEqual(state.lastGeneration.image_urls, [uploaded.url])
  assert.deepEqual(state.requests.map((entry) => entry.phase), [
    'models.list',
    'reference.upload',
    'generation.submit',
    'generation.poll',
    'image.download'
  ])
  assert.deepEqual(state.requests.map((entry) => entry.sequence), [1, 2, 3, 4, 5])
})

test('resets counters, traces, and tasks between smoke runs', async (context) => {
  const fixture = createApimartFixtureServer({ port: 0 })
  const baseUrl = await fixture.start()
  context.after(() => fixture.stop())

  const unauthorized = await fetch(`${baseUrl}/v1/models`)
  assert.equal(unauthorized.status, 401)
  assert.equal(fixture.state.requests.length, 1)

  const reset = await fetch(`${baseUrl}/__smoke/reset`, { method: 'POST' })
  assert.equal(reset.status, 200)
  assert.deepEqual(await reset.json(), { ok: true })
  assert.deepEqual(fixture.state, {
    modelChecks: 0,
    uploads: 0,
    generations: 0,
    polls: 0,
    imageDownloads: 0,
    lastUpload: null,
    lastGeneration: null,
    requests: []
  })
})

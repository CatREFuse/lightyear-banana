import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { createConnection } from 'node:net'
import test from 'node:test'
import { createApimartFixtureServer, expectedApiKey } from './apimart-smoke-server.mjs'

async function waitFor(check, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail('Timed out waiting for fixture state')
}

function sendRawHttp({ host, port, request }) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port })
    let response = ''
    socket.setEncoding('utf8')
    socket.once('connect', () => socket.end(request))
    socket.on('data', (chunk) => { response += chunk })
    socket.once('end', () => resolve(response))
    socket.once('error', reject)
  })
}

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
    abortedRequests: state.abortedRequests,
    modelChecks: state.modelChecks,
    uploads: state.uploads,
    generations: state.generations,
    polls: state.polls,
    imageDownloads: state.imageDownloads
  }, { abortedRequests: 0, modelChecks: 1, uploads: 1, generations: 1, polls: 1, imageDownloads: 1 })
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
    abortedRequests: 0,
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

test('injects a recoverable generation error and records a browser-style poll abort', async (context) => {
  const fixture = createApimartFixtureServer({ port: 0 })
  const baseUrl = await fixture.start()
  context.after(() => fixture.stop())
  const auth = { Authorization: `Bearer ${expectedApiKey}`, 'Content-Type': 'application/json' }
  const generationBody = JSON.stringify({
    model: 'gemini-3.1-flash-image-preview',
    prompt: 'fixture negative smoke',
    n: 1,
    size: '1:1'
  })

  fixture.failNextGeneration({ status: 422, message: 'Fixture generation rejected' })
  const failed = await fetch(`${baseUrl}/v1/images/generations`, {
    method: 'POST',
    headers: auth,
    body: generationBody
  })
  assert.equal(failed.status, 422)
  assert.deepEqual(await failed.json(), { code: 422, message: 'Fixture generation rejected' })

  const submitted = await fetch(`${baseUrl}/v1/images/generations`, {
    method: 'POST',
    headers: auth,
    body: generationBody
  })
  assert.equal(submitted.status, 200)
  const taskId = (await submitted.json()).data[0].task_id

  fixture.delayNextPoll()
  const controller = new AbortController()
  const pollPromise = fetch(`${baseUrl}/v1/tasks/${taskId}?language=zh`, {
    headers: { Authorization: `Bearer ${expectedApiKey}` },
    signal: controller.signal
  })
  await waitFor(() => fixture.state.polls === 1)
  controller.abort()
  await assert.rejects(pollPromise, (error) => error?.name === 'AbortError')
  await waitFor(() => fixture.state.abortedRequests === 1)

  assert.deepEqual(fixture.state.requests.map(({ phase, status, result }) => ({ phase, status, result })), [
    { phase: 'generation.submit', status: 422, result: 'fixture-error' },
    { phase: 'generation.submit', status: 200, result: undefined },
    { phase: 'generation.poll', status: 499, result: 'aborted' }
  ])
  assert.equal(fixture.state.imageDownloads, 0)
})

test('contains oversized and interrupted request bodies without an unhandled rejection', async (context) => {
  const fixture = createApimartFixtureServer({ port: 0, requestBodyLimitBytes: 128 })
  const baseUrl = await fixture.start()
  context.after(() => fixture.stop())

  const oversized = await fetch(`${baseUrl}/v1/uploads/images`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${expectedApiKey}`,
      'Content-Type': 'multipart/form-data; boundary=fixture'
    },
    body: Buffer.alloc(512, 1)
  })
  assert.equal(oversized.status, 413)
  assert.deepEqual(await oversized.json(), { code: 413, message: 'Request body too large' })

  await new Promise((resolve) => {
    const request = httpRequest(`${baseUrl}/v1/uploads/images`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${expectedApiKey}`,
        'Content-Length': 1024,
        'Content-Type': 'multipart/form-data; boundary=fixture'
      }
    })
    request.on('error', resolve)
    request.write(Buffer.alloc(32, 1))
    setTimeout(() => request.destroy(), 20)
  })

  await waitFor(() => fixture.state.requests.some(({ phase, status }) => phase === 'request.error' && status === 499))
  assert.deepEqual(
    fixture.state.requests.filter(({ phase }) => phase === 'request.error').map(({ status, result }) => ({ status, result })),
    [
      { status: 413, result: 'request-too-large' },
      { status: 499, result: 'aborted' }
    ]
  )
})

test('contains a malformed Host header without rejecting the request listener promise', async (context) => {
  const fixture = createApimartFixtureServer({ port: 0 })
  const baseUrl = await fixture.start()
  context.after(() => fixture.stop())
  const address = new URL(baseUrl)

  const response = await sendRawHttp({
    host: address.hostname,
    port: Number(address.port),
    request: 'GET /health HTTP/1.1\r\nHost: [\r\nConnection: close\r\n\r\n'
  })

  assert.match(response, /^HTTP\/1\.1 400 /)
  assert.deepEqual(
    fixture.state.requests.filter(({ phase }) => phase === 'request.error').map(({ status, result }) => ({ status, result })),
    [{ status: 400, result: 'invalid-request' }]
  )
})

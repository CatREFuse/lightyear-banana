#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultFixturePath = path.resolve(moduleDirectory, '../public/mock-images/cats/cat-01.jpg')
const expectedApiKey = 'mock-apimart-good'

function createSmokeState() {
  return {
    abortedRequests: 0,
    modelChecks: 0,
    uploads: 0,
    generations: 0,
    polls: 0,
    imageDownloads: 0,
    lastUpload: null,
    lastGeneration: null,
    requests: []
  }
}

function resetSmokeState(state) {
  Object.assign(state, createSmokeState())
}

function recordRequest(state, request, url, phase, status, details = {}) {
  state.requests.push({
    sequence: state.requests.length + 1,
    phase,
    method: request.method || 'GET',
    path: `${url.pathname}${url.search}`,
    status,
    ...details
  })
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'Access-Control-Allow-Headers': 'authorization,content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8'
  })
  response.end(JSON.stringify(payload))
}

function readRequestBody(request, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false
    request.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > limit) {
        settled = true
        reject(new Error('REQUEST_TOO_LARGE'))
        request.resume()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks))
    })
    request.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    request.on('aborted', () => {
      if (settled) return
      settled = true
      reject(new Error('REQUEST_ABORTED'))
    })
  })
}

function requestOrigin(request, host, port) {
  return `http://${request.headers.host || `${host}:${port}`}`
}

function requestUrlForError(request, host, port) {
  try {
    return new URL(request.url || '/', requestOrigin(request, host, port))
  } catch {
    return new URL('/', 'http://127.0.0.1')
  }
}

function isAuthorized(request) {
  return request.headers.authorization === `Bearer ${expectedApiKey}`
}

export function createApimartFixtureServer({
  host = '127.0.0.1',
  port = 38323,
  fixturePath = defaultFixturePath,
  requestBodyLimitBytes = 25 * 1024 * 1024
} = {}) {
  if (!Number.isSafeInteger(requestBodyLimitBytes) || requestBodyLimitBytes < 1) {
    throw new TypeError('requestBodyLimitBytes must be a positive safe integer')
  }
  const catImage = readFileSync(fixturePath)
  const tasks = new Map()
  const generationFailures = []
  const delayedPolls = new Set()
  const state = createSmokeState()
  let nextPollDelayMs = 0

  function cancelDelayedPolls() {
    for (const pending of delayedPolls) {
      pending.settled = true
      clearTimeout(pending.timer)
      pending.response.off('close', pending.handleClose)
      pending.response.destroy()
    }
    delayedPolls.clear()
  }

  function completePoll(request, response, url, taskId, task) {
    const completed = Math.floor(Date.now() / 1000)
    recordRequest(state, request, url, 'generation.poll', 200, { taskId, result: 'cat' })
    sendJson(response, 200, {
      code: 200,
      data: {
        id: taskId,
        status: 'completed',
        progress: 100,
        result: { images: [{ url: [`${task.origin}/fixtures/cat.jpg`], expires_at: completed + 86400 }] },
        created: task.created,
        completed,
        estimated_time: 1,
        actual_time: Math.max(1, completed - task.created)
      }
    })
  }

  const server = createServer((request, response) => {
    const handleRequest = async () => {
    const url = new URL(request.url || '/', requestOrigin(request, host, port))
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Headers': 'authorization,content-type',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Origin': '*'
      })
      response.end()
      return
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { ok: true, service: 'apimart-smoke-fixture' })
      return
    }
    if (request.method === 'GET' && url.pathname === '/__smoke/state') {
      sendJson(response, 200, state)
      return
    }
    if (request.method === 'POST' && url.pathname === '/__smoke/reset') {
      cancelDelayedPolls()
      tasks.clear()
      generationFailures.length = 0
      nextPollDelayMs = 0
      resetSmokeState(state)
      sendJson(response, 200, { ok: true })
      return
    }
    if (request.method === 'GET' && url.pathname === '/fixtures/cat.jpg') {
      state.imageDownloads += 1
      recordRequest(state, request, url, 'image.download', 200, {
        bytes: catImage.length,
        contentType: 'image/jpeg'
      })
      response.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'Content-Length': catImage.length,
        'Content-Type': 'image/jpeg'
      })
      response.end(catImage)
      return
    }
    if (!isAuthorized(request)) {
      recordRequest(state, request, url, 'authorization', 401)
      sendJson(response, 401, { code: 401, message: 'Invalid API key' })
      return
    }

    if (request.method === 'GET' && url.pathname === '/v1/models') {
      state.modelChecks += 1
      recordRequest(state, request, url, 'models.list', 200)
      sendJson(response, 200, {
        object: 'list',
        data: [
          { id: 'gemini-3.1-flash-image-preview', object: 'model', owned_by: 'apimart' },
          { id: 'gpt-image-1', object: 'model', owned_by: 'apimart' }
        ]
      })
      return
    }

    if (request.method === 'POST' && url.pathname === '/v1/uploads/images') {
      const body = await readRequestBody(request, requestBodyLimitBytes)
      const contentType = String(request.headers['content-type'] || '')
      if (!contentType.startsWith('multipart/form-data;') || !body.includes(Buffer.from('name="file"'))) {
        recordRequest(state, request, url, 'reference.upload', 400)
        sendJson(response, 400, { code: 400, message: 'Missing file field' })
        return
      }
      state.uploads += 1
      state.lastUpload = {
        bytes: body.length,
        contentType: contentType.split(';', 1)[0],
        hasFile: true
      }
      recordRequest(state, request, url, 'reference.upload', 200, state.lastUpload)
      sendJson(response, 200, {
        url: `${url.origin}/fixtures/cat.jpg`,
        filename: 'mugen-reference.jpg',
        content_type: 'image/jpeg',
        bytes: catImage.length,
        created_at: Math.floor(Date.now() / 1000)
      })
      return
    }

    if (request.method === 'POST' && url.pathname === '/v1/images/generations') {
      let payload
      try {
        payload = JSON.parse((await readRequestBody(request, 1024 * 1024)).toString('utf8'))
      } catch {
        recordRequest(state, request, url, 'generation.submit', 400)
        sendJson(response, 400, { code: 400, message: 'Invalid JSON body' })
        return
      }
      if (!payload || typeof payload.model !== 'string' || typeof payload.prompt !== 'string' || !Number.isInteger(payload.n)) {
        recordRequest(state, request, url, 'generation.submit', 400)
        sendJson(response, 400, { code: 400, message: 'Invalid generation payload' })
        return
      }
      if (payload.image_urls !== undefined && (!Array.isArray(payload.image_urls) || !payload.image_urls.every((item) => typeof item === 'string'))) {
        recordRequest(state, request, url, 'generation.submit', 400)
        sendJson(response, 400, { code: 400, message: 'image_urls must be an array of URLs' })
        return
      }
      const generationFailure = generationFailures.shift()
      if (generationFailure) {
        recordRequest(state, request, url, 'generation.submit', generationFailure.status, {
          model: payload.model,
          prompt: payload.prompt,
          result: 'fixture-error'
        })
        sendJson(response, generationFailure.status, {
          code: generationFailure.status,
          message: generationFailure.message
        })
        return
      }
      const taskId = `task_${randomUUID().replaceAll('-', '')}`
      state.generations += 1
      state.lastGeneration = payload
      recordRequest(state, request, url, 'generation.submit', 200, {
        taskId,
        model: payload.model,
        prompt: payload.prompt,
        count: payload.n,
        size: payload.size,
        imageUrls: payload.image_urls ?? []
      })
      tasks.set(taskId, { created: Math.floor(Date.now() / 1000), origin: url.origin })
      sendJson(response, 200, { code: 200, data: [{ status: 'submitted', task_id: taskId }] })
      return
    }

    if (request.method === 'GET' && url.pathname.startsWith('/v1/tasks/')) {
      const taskId = decodeURIComponent(url.pathname.slice('/v1/tasks/'.length))
      const task = tasks.get(taskId)
      if (!task) {
        recordRequest(state, request, url, 'generation.poll', 404, { taskId })
        sendJson(response, 404, { code: 404, message: 'Task not found' })
        return
      }
      state.polls += 1
      const delayMs = nextPollDelayMs
      nextPollDelayMs = 0
      if (delayMs > 0) {
        const pending = {
          handleClose: undefined,
          response,
          settled: false,
          timer: undefined
        }
        pending.handleClose = () => {
          if (pending.settled || response.writableEnded) return
          pending.settled = true
          clearTimeout(pending.timer)
          delayedPolls.delete(pending)
          state.abortedRequests += 1
          recordRequest(state, request, url, 'generation.poll', 499, { taskId, result: 'aborted' })
        }
        pending.timer = setTimeout(() => {
          if (pending.settled) return
          pending.settled = true
          delayedPolls.delete(pending)
          response.off('close', pending.handleClose)
          completePoll(request, response, url, taskId, task)
        }, delayMs)
        delayedPolls.add(pending)
        response.once('close', pending.handleClose)
        return
      }
      completePoll(request, response, url, taskId, task)
      return
    }

    sendJson(response, 404, { code: 404, message: 'Not found' })
    }

    void handleRequest().catch((error) => {
      const url = requestUrlForError(request, host, port)
      const tooLarge = error instanceof Error && error.message === 'REQUEST_TOO_LARGE'
      const aborted = request.aborted || request.destroyed || response.destroyed
      const status = tooLarge ? 413 : aborted ? 499 : 400
      recordRequest(state, request, url, 'request.error', status, {
        result: tooLarge ? 'request-too-large' : aborted ? 'aborted' : 'invalid-request'
      })
      if (response.writableEnded || response.destroyed) return
      sendJson(response, status, {
        code: status,
        message: tooLarge ? 'Request body too large' : 'Invalid request body'
      })
    })
  })

  return {
    host,
    port,
    state,
    server,
    reset() {
      cancelDelayedPolls()
      tasks.clear()
      generationFailures.length = 0
      nextPollDelayMs = 0
      resetSmokeState(state)
    },
    failNextGeneration({ status = 422, message = 'Fixture generation rejected' } = {}) {
      if (!Number.isInteger(status) || status < 400 || status > 599) {
        throw new TypeError('Generation failure status must be an HTTP error status')
      }
      generationFailures.push({ status, message: String(message) })
    },
    delayNextPoll(delayMs = 30_000) {
      if (!Number.isFinite(delayMs) || delayMs <= 0) {
        throw new TypeError('Poll delay must be a positive number')
      }
      nextPollDelayMs = Math.round(delayMs)
    },
    start() {
      return new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen(port, host, () => {
          server.off('error', reject)
          const address = server.address()
          const activePort = typeof address === 'object' && address ? address.port : port
          resolve(`http://${host}:${activePort}`)
        })
      })
    },
    stop() {
      cancelDelayedPolls()
      return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = createApimartFixtureServer({
    host: process.env.MUGEN_APIMART_SMOKE_HOST || '127.0.0.1',
    port: Number(process.env.MUGEN_APIMART_SMOKE_PORT || 38323)
  })
  fixture.start().then((baseUrl) => {
    console.log(`APIMart smoke fixture: ${baseUrl}`)
    console.log(`API key: ${expectedApiKey}`)
  })
}

export { expectedApiKey }

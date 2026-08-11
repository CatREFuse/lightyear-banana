#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultFixturePath = path.resolve(moduleDirectory, '../public/mock-images/cats/cat-01.jpg')
const expectedApiKey = 'apimart-smoke-key'

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
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('REQUEST_TOO_LARGE'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

function requestOrigin(request, host, port) {
  return `http://${request.headers.host || `${host}:${port}`}`
}

function isAuthorized(request) {
  return request.headers.authorization === `Bearer ${expectedApiKey}`
}

export function createApimartFixtureServer({ host = '127.0.0.1', port = 38323, fixturePath = defaultFixturePath } = {}) {
  const catImage = readFileSync(fixturePath)
  const tasks = new Map()
  const state = { uploads: 0, generations: 0, polls: 0, lastGeneration: null }

  const server = createServer(async (request, response) => {
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
    if (request.method === 'GET' && url.pathname === '/fixtures/cat.jpg') {
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
      sendJson(response, 401, { code: 401, message: 'Invalid API key' })
      return
    }

    if (request.method === 'POST' && url.pathname === '/v1/uploads/images') {
      const body = await readRequestBody(request)
      const contentType = String(request.headers['content-type'] || '')
      if (!contentType.startsWith('multipart/form-data;') || !body.includes(Buffer.from('name="file"'))) {
        sendJson(response, 400, { code: 400, message: 'Missing file field' })
        return
      }
      state.uploads += 1
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
        sendJson(response, 400, { code: 400, message: 'Invalid JSON body' })
        return
      }
      if (!payload || typeof payload.model !== 'string' || typeof payload.prompt !== 'string' || !Number.isInteger(payload.n)) {
        sendJson(response, 400, { code: 400, message: 'Invalid generation payload' })
        return
      }
      if (payload.image_urls !== undefined && (!Array.isArray(payload.image_urls) || !payload.image_urls.every((item) => typeof item === 'string'))) {
        sendJson(response, 400, { code: 400, message: 'image_urls must be an array of URLs' })
        return
      }
      const taskId = `task_${randomUUID().replaceAll('-', '')}`
      state.generations += 1
      state.lastGeneration = payload
      tasks.set(taskId, { created: Math.floor(Date.now() / 1000), origin: url.origin })
      sendJson(response, 200, { code: 200, data: [{ status: 'submitted', task_id: taskId }] })
      return
    }

    if (request.method === 'GET' && url.pathname.startsWith('/v1/tasks/')) {
      const taskId = decodeURIComponent(url.pathname.slice('/v1/tasks/'.length))
      const task = tasks.get(taskId)
      if (!task) {
        sendJson(response, 404, { code: 404, message: 'Task not found' })
        return
      }
      state.polls += 1
      const completed = Math.floor(Date.now() / 1000)
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
      return
    }

    sendJson(response, 404, { code: 404, message: 'Not found' })
  })

  return {
    host,
    port,
    state,
    server,
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

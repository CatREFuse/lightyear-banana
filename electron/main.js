import { app, BrowserWindow, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname, extname, join, normalize } from 'node:path'
import http from 'node:http'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = join(__dirname, '..', 'dist')
const BRIDGE_HOST = '127.0.0.1'
const BRIDGE_PORT = Number(process.env.LIGHTYEAR_BRIDGE_PORT || 38321)
const BRIDGE_TOKEN = process.env.LIGHTYEAR_BRIDGE_TOKEN || 'lightyear-dev-token'
const UXP_CONNECTED_WINDOW_MS = 60000
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
}

const state = {
  server: null,
  uxpLastSeen: 0,
  uxpQueue: [],
  pollWaiters: [],
  pending: new Map(),
  lastDocumentLabel: '',
  startedAt: Date.now()
}

let mainWindow = null

function isUxpHttpConnected() {
  return Date.now() - state.uxpLastSeen < UXP_CONNECTED_WINDOW_MS
}

function isPhotoshopConnected() {
  return isUxpHttpConnected()
}

function readBridgeStatus() {
  return {
    bridge: {
      host: BRIDGE_HOST,
      port: BRIDGE_PORT,
      running: Boolean(state.server)
    },
    photoshop: {
      connected: isPhotoshopConnected(),
      documentLabel: state.lastDocumentLabel || undefined
    }
  }
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-origin': '*',
    'content-type': 'application/json; charset=utf-8'
  })
  response.end(JSON.stringify(payload))
}

async function readJsonBody(request) {
  const chunks = []
  for await (const chunk of request) {
    chunks.push(chunk)
  }

  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) {
    return {}
  }

  return JSON.parse(raw)
}

function broadcastRendererEvent(event) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  mainWindow.webContents.send('lightyear:event', event)
}

function resolvePending(message) {
  const pending = state.pending.get(message.id)
  if (!pending) {
    return false
  }

  clearTimeout(pending.timer)
  state.pending.delete(message.id)

  if (message.ok) {
    pending.resolve(message.payload)
  } else {
    const error = new Error(message.error?.message || 'Photoshop 操作失败')
    error.code = message.error?.code
    pending.reject(error)
  }

  return true
}

function sendToUxp(type, payload = {}) {
  if (!isPhotoshopConnected()) {
    return Promise.reject(new Error('Photoshop 插件未连接'))
  }

  const id = randomUUID()
  const message = {
    id,
    type,
    role: 'main',
    payload,
    createdAt: Date.now()
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.pending.delete(id)
      reject(new Error('Photoshop 操作超时'))
    }, 30000)

    state.pending.set(id, { resolve, reject, timer })
    state.uxpQueue.push(message)
    flushPollWaiters()
  })
}

function markUxpConnected(payload = {}) {
  state.uxpLastSeen = Date.now()
  state.lastDocumentLabel = payload.documentLabel || state.lastDocumentLabel
}

function flushPollWaiters() {
  while (state.pollWaiters.length && state.uxpQueue.length) {
    const waiter = state.pollWaiters.shift()
    clearTimeout(waiter.timer)
    sendJson(waiter.response, 200, state.uxpQueue.shift())
  }
}

async function handleHttpUxpRequest(request, response, url) {
  if (url.searchParams.get('token') !== BRIDGE_TOKEN) {
    sendJson(response, 403, { ok: false, error: 'Invalid token' })
    return true
  }

  if (request.method === 'POST' && url.pathname === '/uxp/hello') {
    const body = await readJsonBody(request)
    markUxpConnected(body.payload)
    broadcastRendererEvent({
      type: 'photoshop.connected',
      payload: readBridgeStatus()
    })
    sendJson(response, 200, { ok: true, ...readBridgeStatus() })
    return true
  }

  if (request.method === 'GET' && url.pathname === '/uxp/poll') {
    markUxpConnected()
    if (state.uxpQueue.length) {
      sendJson(response, 200, state.uxpQueue.shift())
      return true
    }

    const waiter = {
      response,
      timer: setTimeout(() => {
        state.pollWaiters = state.pollWaiters.filter((entry) => entry !== waiter)
        sendJson(response, 200, {
          id: `noop-${Date.now()}`,
          type: 'bridge.noop',
          role: 'main',
          payload: {},
          createdAt: Date.now()
        })
      }, 25000)
    }
    request.on('close', () => {
      state.pollWaiters = state.pollWaiters.filter((entry) => entry !== waiter)
      clearTimeout(waiter.timer)
    })
    state.pollWaiters.push(waiter)
    return true
  }

  if (request.method === 'POST' && url.pathname === '/uxp/respond') {
    const body = await readJsonBody(request)
    markUxpConnected(body.payload)
    if (body.id) {
      resolvePending(body)
    }
    sendJson(response, 200, { ok: true })
    return true
  }

  return false
}

async function sendStaticFile(request, response) {
  const url = new URL(request.url || '/', `http://${BRIDGE_HOST}:${BRIDGE_PORT}`)
  let pathname = decodeURIComponent(url.pathname)

  if (pathname === '/app' || pathname === '/app/') {
    pathname = '/index.html'
  } else if (pathname.startsWith('/app/')) {
    pathname = pathname.slice(4)
  }

  const filePath = normalize(join(DIST_DIR, pathname))
  if (!filePath.startsWith(DIST_DIR)) {
    response.writeHead(403, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: false, error: 'Forbidden' }))
    return
  }

  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) {
      throw new Error('Not file')
    }

    const contentType = MIME_TYPES[extname(filePath)] || 'application/octet-stream'
    response.writeHead(200, { 'content-type': contentType })
    createReadStream(filePath).pipe(response)
  } catch {
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: false, error: 'Not found' }))
  }
}

function startBridgeServer() {
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', `http://${BRIDGE_HOST}:${BRIDGE_PORT}`)

    if (request.method === 'OPTIONS') {
      sendJson(response, 204, {})
      return
    }

    if (url.pathname === '/health') {
      sendJson(response, 200, { ok: true, ...readBridgeStatus() })
      return
    }

    if (url.pathname === '/debug/state') {
      sendJson(response, 200, { ...readBridgeStatus(), startedAt: state.startedAt, queuedMessages: state.uxpQueue.length })
      return
    }

    if (url.pathname.startsWith('/uxp/') && (await handleHttpUxpRequest(request, response, url))) {
      return
    }

    sendStaticFile(request, response)
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
      state.server = server
      resolve()
    })
  })
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 390,
    height: 760,
    minWidth: 390,
    minHeight: 640,
    useContentSize: true,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: '#151b23',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    await mainWindow.loadURL(`${devServerUrl.replace(/\/$/, '')}/?runtime=electron`)
    return
  }

  await mainWindow.loadURL(`http://${BRIDGE_HOST}:${BRIDGE_PORT}/app/?runtime=electron`)
}

ipcMain.handle('lightyear:status', async () => readBridgeStatus())

ipcMain.handle('lightyear:invoke', async (_event, command, payload) => {
  if (command === 'app.status') {
    return readBridgeStatus()
  }

  return sendToUxp(command, payload)
})

app.whenReady().then(async () => {
  await startBridgeServer()
  await createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  state.server?.close()
})

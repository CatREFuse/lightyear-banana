import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, screen, shell } from 'electron'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, dirname, extname, join, normalize } from 'node:path'
import http from 'node:http'
import { promisify } from 'node:util'
import {
  defaultCodexImageServerHost,
  defaultCodexImageServerPort,
  listenCodexImageServer
} from './codexImageServer.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = join(__dirname, '..', 'dist')
const BRIDGE_HOST = '127.0.0.1'
const BRIDGE_PORT = Number(process.env.LIGHTYEAR_BRIDGE_PORT || 38321)
const BRIDGE_TOKEN = process.env.LIGHTYEAR_BRIDGE_TOKEN || 'lightyear-dev-token'
const UXP_CONNECTED_WINDOW_MS = 60000
const PANEL_WINDOW_WIDTH = 390
const UXP_PACKAGE_FILE = 'lightyear-banana-0.2.2.ccx'
const SETTINGS_FILE = 'lightyear-settings.json'
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.ccx': 'application/octet-stream',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
}
const REFERENCE_IMAGE_MIME_TYPES = {
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
}

const execFileAsync = promisify(execFile)
const WINDOW_DEPLOY_TIMEOUT_MS = 8000
const MAC_PERMISSION_URLS = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  automation: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Automation',
  screenCapture: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
}

const state = {
  server: null,
  codexImageServer: null,
  uxpLastSeen: 0,
  uxpQueue: [],
  pollWaiters: [],
  pending: new Map(),
  previewImages: new Map(),
  lastDocumentLabel: '',
  startedAt: Date.now()
}

let mainWindow = null
const previewWindows = new Set()

function isUxpHttpConnected() {
  return Date.now() - state.uxpLastSeen < UXP_CONNECTED_WINDOW_MS
}

function isPhotoshopConnected() {
  return isUxpHttpConnected()
}

function readLocalUxpPackage() {
  const filePath = join(DIST_DIR, UXP_PACKAGE_FILE)

  try {
    const fileStat = statSync(filePath)
    if (!fileStat.isFile()) {
      return undefined
    }

    return {
      fileName: UXP_PACKAGE_FILE,
      downloadUrl: `http://${BRIDGE_HOST}:${BRIDGE_PORT}/downloads/${UXP_PACKAGE_FILE}`
    }
  } catch {
    return undefined
  }
}

function readBridgeStatus() {
  const status = {
    bridge: {
      host: BRIDGE_HOST,
      port: BRIDGE_PORT,
      running: Boolean(state.server)
    },
    codexImageServer: {
      host: defaultCodexImageServerHost,
      port: defaultCodexImageServerPort,
      running: Boolean(state.codexImageServer)
    },
    photoshop: {
      connected: isPhotoshopConnected(),
      documentLabel: state.lastDocumentLabel || undefined
    }
  }

  const uxpPackage = readLocalUxpPackage()
  if (uxpPackage) {
    status.uxpPackage = uxpPackage
  }

  return status
}

function readSettingsFilePath() {
  return join(app.getPath('userData'), SETTINGS_FILE)
}

function readPersistedSettings() {
  try {
    return JSON.parse(readFileSync(readSettingsFilePath(), 'utf8'))
  } catch {
    return null
  }
}

function writePersistedSettings(settings) {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(readSettingsFilePath(), JSON.stringify(settings), 'utf8')
}

function normalizeDeploySide(value) {
  return value === 'right' ? 'right' : 'left'
}

function readDeploymentBounds(side) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    throw new Error('Lightyear App 窗口未启动')
  }

  const display = screen.getDisplayMatching(mainWindow.getBounds())
  const workArea = display.workArea
  const panelWidth = Math.min(PANEL_WINDOW_WIDTH, Math.max(320, Math.floor(workArea.width * 0.42)))
  const photoshopWidth = Math.max(320, workArea.width - panelWidth)
  const panelBounds =
    side === 'right'
      ? {
          x: workArea.x + workArea.width - panelWidth,
          y: workArea.y,
          width: panelWidth,
          height: workArea.height
        }
      : {
          x: workArea.x,
          y: workArea.y,
          width: panelWidth,
          height: workArea.height
        }
  const photoshopBounds =
    side === 'right'
      ? {
          x: workArea.x,
          y: workArea.y,
          width: photoshopWidth,
          height: workArea.height
        }
      : {
          x: workArea.x + panelWidth,
          y: workArea.y,
          width: photoshopWidth,
          height: workArea.height
        }

  return {
    panelBounds,
    photoshopBounds
  }
}

async function movePhotoshopWindowMac(bounds) {
  const script = `
on run argv
  set targetX to (item 1 of argv) as integer
  set targetY to (item 2 of argv) as integer
  set targetWidth to (item 3 of argv) as integer
  set targetHeight to (item 4 of argv) as integer
  tell application "System Events"
    set photoshopProcess to missing value
    repeat with candidateProcess in (processes whose background only is false)
      if (name of candidateProcess) contains "Photoshop" then
        set photoshopProcess to candidateProcess
        exit repeat
      end if
    end repeat
    if photoshopProcess is missing value then error "未找到 Photoshop 窗口"
    tell photoshopProcess
      if (count of windows) is 0 then error "未找到 Photoshop 窗口"
      set position of window 1 to {targetX, targetY}
      set size of window 1 to {targetWidth, targetHeight}
    end tell
  end tell
end run
`

  await execFileAsync(
    'osascript',
    ['-e', script, String(bounds.x), String(bounds.y), String(bounds.width), String(bounds.height)],
    { timeout: WINDOW_DEPLOY_TIMEOUT_MS }
  )
}

async function movePhotoshopWindowWindows(bounds) {
  const script = `
$ErrorActionPreference = "Stop"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class LightyearWin32 {
  [DllImport("user32.dll")]
  public static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);
}
"@
$photoshop = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.ProcessName -like "Photoshop*" } | Select-Object -First 1
if (-not $photoshop) { throw "未找到 Photoshop 窗口" }
$moved = [LightyearWin32]::MoveWindow($photoshop.MainWindowHandle, ${bounds.x}, ${bounds.y}, ${bounds.width}, ${bounds.height}, $true)
if (-not $moved) { throw "Photoshop 窗口调整失败" }
`

  await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    timeout: WINDOW_DEPLOY_TIMEOUT_MS
  })
}

async function movePhotoshopWindow(bounds) {
  if (process.platform === 'darwin') {
    await movePhotoshopWindowMac(bounds)
    return
  }

  if (process.platform === 'win32') {
    await movePhotoshopWindowWindows(bounds)
    return
  }

  throw new Error('当前系统暂不支持窗口部署')
}

async function deployWorkspaceWindows(payload = {}) {
  const side = normalizeDeploySide(payload.side)
  const { panelBounds, photoshopBounds } = readDeploymentBounds(side)

  mainWindow.setBounds(panelBounds, false)

  try {
    await movePhotoshopWindow(photoshopBounds)
    return {
      side,
      panelBounds,
      photoshopBounds,
      photoshopAdjusted: true,
      message: side === 'right' ? '已部署到右侧' : '已部署到左侧'
    }
  } catch (error) {
    return {
      side,
      panelBounds,
      photoshopBounds,
      photoshopAdjusted: false,
      message: error instanceof Error ? error.message : 'Photoshop 窗口调整失败'
    }
  }
}

async function openMacPermissionSettings(payload = {}) {
  if (process.platform !== 'darwin') {
    throw new Error('当前系统不支持此入口')
  }

  const pane = payload.pane in MAC_PERMISSION_URLS ? payload.pane : 'accessibility'
  const url = MAC_PERMISSION_URLS[pane]
  await shell.openExternal(url)

  return {
    pane,
    url,
    message: '已打开系统设置'
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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function readDataUrlParts(value) {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(value || ''))
  if (!match) {
    return null
  }

  return {
    data: match[3] ?? '',
    isBase64: Boolean(match[2]),
    mimeType: match[1] || 'image/png'
  }
}

function createSerializedReferenceImage({ idPrefix, label, previewUrl, width, height }) {
  return {
    id: `${idPrefix}-${Date.now()}`,
    label,
    width,
    height,
    sourceBounds: {
      left: 0,
      top: 0,
      right: width,
      bottom: height
    },
    previewUrl,
    rgba: ''
  }
}

function readReferenceMimeType(filePath) {
  return REFERENCE_IMAGE_MIME_TYPES[extname(filePath).toLowerCase()] || 'image/png'
}

function createReferenceImageFromNativeImage(image, label, idPrefix) {
  if (image.isEmpty()) {
    throw new Error('剪贴板里没有图片')
  }

  const size = image.getSize()
  if (!size.width || !size.height) {
    throw new Error('无法读取图片尺寸')
  }

  return createSerializedReferenceImage({
    idPrefix,
    label,
    width: Math.round(size.width),
    height: Math.round(size.height),
    previewUrl: `data:image/png;base64,${image.toPNG().toString('base64')}`
  })
}

function readNativeImageFromClipboardBuffer() {
  const imageFormat = clipboard.availableFormats().find((format) => /png|jpeg|jpg|tiff|tif|PNGf|JPEG|TIFF/i.test(format))
  if (!imageFormat) {
    return null
  }

  const buffer = clipboard.readBuffer(imageFormat)
  if (!buffer.length) {
    return null
  }

  const image = nativeImage.createFromBuffer(buffer)

  return image.isEmpty() ? null : image
}

async function pickReferenceImageFile() {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    title: '选择参考图',
    properties: ['openFile'],
    filters: [
      {
        name: 'Images',
        extensions: ['png', 'jpg', 'jpeg', 'webp']
      }
    ]
  })

  if (result.canceled || !result.filePaths[0]) {
    return null
  }

  const filePath = result.filePaths[0]
  const image = nativeImage.createFromPath(filePath)
  if (image.isEmpty()) {
    throw new Error('无法读取图片文件')
  }

  const size = image.getSize()
  if (!size.width || !size.height) {
    throw new Error('无法读取图片尺寸')
  }

  return createSerializedReferenceImage({
    idPrefix: 'upload',
    label: `上传图片：${basename(filePath)}`,
    width: Math.round(size.width),
    height: Math.round(size.height),
    previewUrl: `data:${readReferenceMimeType(filePath)};base64,${readFileSync(filePath).toString('base64')}`
  })
}

function readClipboardReferenceImage() {
  const image = clipboard.readImage()
  if (!image.isEmpty()) {
    return createReferenceImageFromNativeImage(image, '剪贴板', 'clipboard')
  }

  const fallbackImage = readNativeImageFromClipboardBuffer()
  if (!fallbackImage) {
    throw new Error('剪贴板里没有图片')
  }

  return createReferenceImageFromNativeImage(fallbackImage, '剪贴板', 'clipboard')
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

function readUxpCommandTimeout(command) {
  if (typeof command === 'string' && command.startsWith('canvas.capture')) {
    return 120000
  }

  return 30000
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
    }, readUxpCommandTimeout(type))

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

async function sendDownloadFile(response, fileName, headOnly = false) {
  if (fileName !== UXP_PACKAGE_FILE) {
    sendJson(response, 404, { ok: false, error: 'Not found' })
    return
  }

  const filePath = join(DIST_DIR, UXP_PACKAGE_FILE)

  try {
    const fileStat = await stat(filePath)
    if (!fileStat.isFile()) {
      throw new Error('Not file')
    }

    response.writeHead(200, {
      'content-disposition': `attachment; filename="${UXP_PACKAGE_FILE}"`,
      'content-length': String(fileStat.size),
      'content-type': MIME_TYPES['.ccx']
    })
    if (headOnly) {
      response.end()
      return
    }

    createReadStream(filePath).pipe(response)
  } catch {
    sendJson(response, 404, { ok: false, error: 'Plugin package not found' })
  }
}

function createPreviewHtml(record) {
  const title = `${record.label || '图片预览'} · ${record.width || '?'} × ${record.height || '?'}`

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: blob: http: https:; style-src 'unsafe-inline';">
  <title>${escapeHtml(title)}</title>
  <style>
    html,
    body {
      width: 100%;
      height: 100%;
      margin: 0;
      background: #0f141c;
      color: #f5f7fb;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    body {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
    }

    header {
      display: flex;
      min-width: 0;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      padding: 12px 16px;
      border-bottom: 1px solid rgba(178, 190, 205, 0.16);
      background: rgba(20, 27, 37, 0.96);
      box-sizing: border-box;
    }

    header span {
      overflow: hidden;
      color: #d7deea;
      font-size: 13px;
      line-height: 18px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    main {
      display: grid;
      place-items: center;
      min-width: 0;
      min-height: 0;
      overflow: auto;
      padding: 18px;
      box-sizing: border-box;
    }

    img {
      display: block;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      box-shadow: 0 18px 70px rgba(0, 0, 0, 0.34);
    }
  </style>
</head>
<body>
  <header><span>${escapeHtml(title)}</span></header>
  <main><img src="/preview/${encodeURIComponent(record.id)}/image" alt="${escapeHtml(record.label || '图片预览')}"></main>
</body>
</html>`
}

function sendPreviewImage(response, record, method) {
  const parts = readDataUrlParts(record.previewUrl)
  if (!parts) {
    response.writeHead(302, {
      Location: record.previewUrl
    })
    response.end()
    return
  }

  const buffer = parts.isBase64 ? Buffer.from(parts.data, 'base64') : Buffer.from(decodeURIComponent(parts.data), 'utf8')
  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Length': String(buffer.length),
    'Content-Type': parts.mimeType
  })
  if (method === 'HEAD') {
    response.end()
    return
  }

  response.end(buffer)
}

async function sendPreviewPage(request, response, url) {
  const match = /^\/preview\/([^/]+)(?:\/image)?$/.exec(url.pathname)
  if (!match) {
    return false
  }

  const id = decodeURIComponent(match[1])
  const record = state.previewImages.get(id)
  if (!record) {
    sendJson(response, 404, { ok: false, error: 'Preview not found' })
    return true
  }

  if (url.pathname.endsWith('/image')) {
    sendPreviewImage(response, record, request.method)
    return true
  }

  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': 'text/html; charset=utf-8'
  })
  response.end(createPreviewHtml(record))
  return true
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

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/downloads/')) {
      await sendDownloadFile(response, decodeURIComponent(url.pathname.replace('/downloads/', '')), request.method === 'HEAD')
      return
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith('/preview/')) {
      if (await sendPreviewPage(request, response, url)) {
        return
      }
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

async function startBuiltInCodexImageServer() {
  if (state.codexImageServer) {
    return
  }

  try {
    state.codexImageServer = await listenCodexImageServer()
  } catch (error) {
    if (error?.code === 'EADDRINUSE') {
      console.warn(`Codex Image Server port already in use: http://${defaultCodexImageServerHost}:${defaultCodexImageServerPort}`)
      return
    }

    throw error
  }
}

async function createMainWindow() {
  const isMac = process.platform === 'darwin'
  mainWindow = new BrowserWindow({
    width: PANEL_WINDOW_WIDTH,
    height: 760,
    minWidth: PANEL_WINDOW_WIDTH,
    minHeight: 640,
    useContentSize: true,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac
      ? { trafficLightPosition: { x: 12, y: 12 } }
      : {
          titleBarOverlay: {
            color: '#1a2028',
            symbolColor: '#aeb5c2',
            height: 44
          }
        }),
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
    await mainWindow.loadURL(`${devServerUrl.replace(/\/$/, '')}/?runtime=electron&platform=${process.platform}`)
    return
  }

  await mainWindow.loadURL(`http://${BRIDGE_HOST}:${BRIDGE_PORT}/app/?runtime=electron&platform=${process.platform}`)
}

async function openPreviewWindow(payload = {}) {
  const id = randomUUID()
  const record = {
    id,
    label: String(payload.label || '图片预览'),
    width: Number(payload.width) || 0,
    height: Number(payload.height) || 0,
    previewUrl: String(payload.previewUrl || '')
  }

  if (!record.previewUrl) {
    throw new Error('图片预览不可用')
  }

  state.previewImages.set(id, record)

  const display = mainWindow && !mainWindow.isDestroyed()
    ? screen.getDisplayMatching(mainWindow.getBounds())
    : screen.getPrimaryDisplay()
  const workArea = display.workArea
  const width = Math.min(1180, Math.max(720, Math.floor(workArea.width * 0.62)))
  const height = Math.min(920, Math.max(560, Math.floor(workArea.height * 0.72)))
  const previewWindow = new BrowserWindow({
    width,
    height,
    minWidth: 520,
    minHeight: 420,
    title: record.label,
    backgroundColor: '#0f141c',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  previewWindows.add(previewWindow)
  previewWindow.on('closed', () => {
    previewWindows.delete(previewWindow)
    state.previewImages.delete(id)
  })

  await previewWindow.loadURL(`http://${BRIDGE_HOST}:${BRIDGE_PORT}/preview/${encodeURIComponent(id)}`)
  return { ok: true }
}

ipcMain.handle('lightyear:status', async () => readBridgeStatus())

ipcMain.on('lightyear:settings:load', (event) => {
  event.returnValue = readPersistedSettings()
})

ipcMain.handle('lightyear:settings:save', async (_event, settings) => {
  writePersistedSettings(settings)
  return { ok: true }
})

ipcMain.handle('lightyear:preview:open', async (_event, payload) => openPreviewWindow(payload))

ipcMain.handle('lightyear:invoke', async (_event, command, payload) => {
  if (command === 'app.status') {
    return readBridgeStatus()
  }

  if (command === 'app.deployWindows') {
    return deployWorkspaceWindows(payload)
  }

  if (command === 'app.openMacPermissionSettings') {
    return openMacPermissionSettings(payload)
  }

  if (command === 'reference.pickUpload') {
    return pickReferenceImageFile()
  }

  if (command === 'reference.readClipboard') {
    return readClipboardReferenceImage()
  }

  return sendToUxp(command, payload)
})

app.whenReady().then(async () => {
  await startBridgeServer()
  await startBuiltInCodexImageServer()
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
  state.codexImageServer?.close()
})

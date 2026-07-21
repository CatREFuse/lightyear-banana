import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, powerMonitor, screen, shell } from 'electron'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createReadStream, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { release as osRelease, tmpdir, version as osVersion } from 'node:os'
import { basename, dirname, extname, join, normalize } from 'node:path'
import http from 'node:http'
import { promisify } from 'node:util'
import {
  defaultCodexImageServerHost,
  defaultCodexImageServerPort,
  listenCodexImageServer
} from './codexImageServer.js'
import { createDiagnosticLogger, normalizeDiagnosticError } from './diagnosticLogger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DIST_DIR = join(__dirname, '..', 'dist')
const BRIDGE_HOST = '127.0.0.1'
const DEFAULT_BRIDGE_PORT = 38321
const requestedBridgePort = Number(process.env.LIGHTYEAR_BRIDGE_PORT || DEFAULT_BRIDGE_PORT)
let bridgePort = Number.isFinite(requestedBridgePort) && requestedBridgePort > 0 ? requestedBridgePort : DEFAULT_BRIDGE_PORT
const BRIDGE_TOKEN = process.env.LIGHTYEAR_BRIDGE_TOKEN || 'lightyear-dev-token'
const UXP_CONNECTED_WINDOW_MS = 60000
const PANEL_WINDOW_WIDTH = 390
const UXP_PACKAGE_FILE = 'lightyear-banana-0.3.15.ccx'
const SETTINGS_FILE = 'lightyear-settings.json'
const DIAGNOSTICS_DIRECTORY = 'diagnostics'
const APP_UPDATE_MANIFEST_URL = 'https://cake.catrefuse.com/releases/latest.json'
const APP_UPDATE_TIMEOUT_MS = 10000
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
const REFERENCE_JPEG_MAX_EDGE = 4096
const REFERENCE_JPEG_MAX_BYTES = 9 * 1024 * 1024

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
  expiredRequests: new Map(),
  diagnosticEventIds: new Map(),
  crxClientEventIds: new Set(),
  lastDocumentLabel: '',
  startedAt: Date.now()
}

let mainWindow = null
let startupUpdateTimer = null
let diagnosticLogger = null
const previewWindows = new Set()

function readApplicationVersion() {
  if (!app.isPackaged) {
    return process.env.npm_package_version || UXP_PACKAGE_FILE.match(/lightyear-banana-(.+)\.ccx$/)?.[1] || app.getVersion()
  }

  return app.getVersion()
}

function readDiagnosticRuntime() {
  return {
    appVersion: readApplicationVersion(),
    arch: process.arch,
    chromeVersion: process.versions.chrome,
    electronVersion: process.versions.electron,
    locale: app.getLocale?.() || Intl.DateTimeFormat().resolvedOptions().locale,
    nodeVersion: process.versions.node,
    osRelease: osRelease(),
    osVersion: osVersion(),
    platform: process.platform,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  }
}

async function initializeDiagnostics() {
  diagnosticLogger = createDiagnosticLogger({
    directory: join(app.getPath('userData'), DIAGNOSTICS_DIRECTORY),
    runtime: readDiagnosticRuntime
  })
  await diagnosticLogger.initialize()
  await diagnosticLogger.log({
    category: 'app',
    operation: 'app.start',
    phase: 'success',
    details: {
      startedAt: new Date(state.startedAt).toISOString(),
      userDataPath: app.getPath('userData')
    }
  })
}

function writeDiagnostic(event) {
  if (!diagnosticLogger) {
    return Promise.resolve(null)
  }

  return diagnosticLogger.log(event)
}

function createCrxInteractionTracker(request, response, url) {
  const interactionId = randomUUID()
  const startedAt = Date.now()
  const details = {
    interactionId,
    method: request.method || 'GET',
    path: url.pathname
  }
  let failure
  let settled = false

  function finish(phase, error) {
    if (settled) {
      return
    }
    settled = true
    const statusCode = response.statusCode || 0
    const finalPhase = failure || error
      ? 'error'
      : phase || (statusCode >= 400 ? 'error' : 'success')
    void writeDiagnostic({
      level: finalPhase === 'error' ? 'error' : finalPhase === 'cancel' ? 'warn' : 'info',
      requestId: details.requestId,
      category: 'crx',
      operation: 'crx.interaction',
      phase: finalPhase,
      durationMs: Date.now() - startedAt,
      details: {
        ...details,
        authenticated: details.authenticated !== false,
        statusCode,
        queueLength: state.uxpQueue.length,
        pendingCount: state.pending.size
      },
      error: failure || error ? normalizeDiagnosticError(failure || error) : undefined
    })
  }

  response.once('finish', () => finish())
  response.once('close', () => {
    if (!response.writableFinished) {
      finish('cancel', new Error('插件连接在响应完成前中断'))
    }
  })
  response.once('error', (error) => finish('error', error))

  return {
    annotate(patch) {
      if (patch && typeof patch === 'object') {
        Object.assign(details, patch)
      }
    },
    fail(error) {
      failure = error
    }
  }
}

function ingestCrxClientInteractions(records) {
  if (!Array.isArray(records)) {
    return 0
  }

  let accepted = 0
  for (const record of records.slice(0, 200)) {
    if (!record || typeof record !== 'object' || !record.eventId || state.crxClientEventIds.has(record.eventId)) {
      continue
    }

    state.crxClientEventIds.add(record.eventId)
    if (state.crxClientEventIds.size > 500) {
      state.crxClientEventIds.delete(state.crxClientEventIds.values().next().value)
    }
    accepted += 1
    void writeDiagnostic({
      timestamp: record.timestamp,
      level: 'error',
      eventId: record.eventId,
      category: 'crx',
      operation: 'crx.client.interaction',
      phase: 'error',
      durationMs: record.durationMs,
      details: {
        source: 'uxp-replay',
        method: record.method,
        path: record.path
      },
      error: record.error
    })
  }

  return accepted
}

function readCommandPayloadSummary(command, payload) {
  if (!payload || typeof payload !== 'object') {
    return {}
  }

  if (command === 'app.deployWindows') {
    return { side: payload.side }
  }

  if (command === 'app.openMacPermissionSettings') {
    return { pane: payload.pane }
  }

  if (command === 'canvas.placeImage') {
    return {
      image: payload.image
        ? {
            height: payload.image.height,
            id: payload.image.id,
            label: payload.image.label,
            width: payload.image.width
          }
        : null,
      target: payload.target
    }
  }

  if (command === 'result.saveImage') {
    return {
      fileName: payload.fileName,
      previewKind: String(payload.previewUrl || '').startsWith('data:') ? 'data-url' : 'remote-url'
    }
  }

  return {}
}

function rememberDiagnosticEvent(requestId, eventId) {
  if (!requestId || !eventId) {
    return true
  }

  let eventIds = state.diagnosticEventIds.get(requestId)
  if (!eventIds) {
    eventIds = new Set()
    state.diagnosticEventIds.set(requestId, eventIds)
  }

  if (eventIds.has(eventId)) {
    return false
  }

  eventIds.add(eventId)
  if (state.diagnosticEventIds.size > 200) {
    state.diagnosticEventIds.delete(state.diagnosticEventIds.keys().next().value)
  }
  return true
}

function ingestUxpDiagnostic(requestId, event, source) {
  if (!event || typeof event !== 'object' || !rememberDiagnosticEvent(requestId, event.eventId)) {
    return false
  }

  void writeDiagnostic({
    timestamp: event.timestamp,
    level: event.phase === 'error' ? 'error' : event.phase === 'timeout' ? 'warn' : 'info',
    requestId,
    eventId: event.eventId,
    sequence: event.sequence,
    offsetMs: event.offsetMs,
    category: 'photoshop',
    operation: event.operation || 'photoshop.unknown',
    phase: event.phase || 'progress',
    durationMs: event.durationMs,
    details: {
      source,
      ...(event.details && typeof event.details === 'object' ? event.details : {})
    },
    error: event.error
  })
  return true
}

function ingestUxpTrace(requestId, diagnostics, source) {
  const events = Array.isArray(diagnostics) ? diagnostics : diagnostics?.events
  if (!Array.isArray(events)) {
    return 0
  }

  return events.reduce((count, event) => count + (ingestUxpDiagnostic(requestId, event, source) ? 1 : 0), 0)
}

function scheduleDiagnosticEventCleanup(requestId) {
  const timer = setTimeout(() => {
    state.diagnosticEventIds.delete(requestId)
    state.expiredRequests.delete(requestId)
  }, 10 * 60 * 1000)
  timer.unref?.()
}

function readBridgeOrigin() {
  return `http://${BRIDGE_HOST}:${bridgePort}`
}

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
      downloadUrl: `${readBridgeOrigin()}/downloads/${UXP_PACKAGE_FILE}`
    }
  } catch {
    return undefined
  }
}

function readBridgeStatus() {
  const photoshopConnected = isPhotoshopConnected()
  const status = {
    bridge: {
      host: BRIDGE_HOST,
      port: bridgePort,
      running: Boolean(state.server)
    },
    codexImageServer: {
      host: defaultCodexImageServerHost,
      port: defaultCodexImageServerPort,
      running: Boolean(state.codexImageServer)
    },
    photoshop: {
      connected: photoshopConnected,
      documentLabel: photoshopConnected && state.lastDocumentLabel ? state.lastDocumentLabel : undefined
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
  const startedAt = Date.now()
  const filePath = readSettingsFilePath()
  try {
    const raw = readFileSync(filePath, 'utf8')
    const settings = JSON.parse(raw)
    void writeDiagnostic({
      category: 'settings',
      operation: 'settings.read',
      phase: 'success',
      durationMs: Date.now() - startedAt,
      details: { byteLength: Buffer.byteLength(raw), filePath }
    })
    return settings
  } catch (error) {
    void writeDiagnostic({
      level: error?.code === 'ENOENT' ? 'info' : 'error',
      category: 'settings',
      operation: 'settings.read',
      phase: error?.code === 'ENOENT' ? 'cancel' : 'error',
      durationMs: Date.now() - startedAt,
      details: { filePath },
      error: normalizeDiagnosticError(error)
    })
    return null
  }
}

function writePersistedSettings(settings) {
  const startedAt = Date.now()
  const filePath = readSettingsFilePath()
  const content = JSON.stringify(settings)
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(filePath, content, 'utf8')
    void writeDiagnostic({
      category: 'settings',
      operation: 'settings.write',
      phase: 'success',
      durationMs: Date.now() - startedAt,
      details: { byteLength: Buffer.byteLength(content), filePath }
    })
  } catch (error) {
    void writeDiagnostic({
      level: 'error',
      category: 'settings',
      operation: 'settings.write',
      phase: 'error',
      durationMs: Date.now() - startedAt,
      details: { byteLength: Buffer.byteLength(content), filePath },
      error: normalizeDiagnosticError(error)
    })
    throw error
  }
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function normalizeVersionSegment(value) {
  const segment = Number.parseInt(value, 10)
  return Number.isFinite(segment) ? segment : 0
}

function compareVersions(left, right) {
  const [leftCore, leftPrerelease = ''] = String(left).replace(/^v/i, '').split('-', 2)
  const [rightCore, rightPrerelease = ''] = String(right).replace(/^v/i, '').split('-', 2)
  const leftSegments = leftCore.split('.').map(normalizeVersionSegment)
  const rightSegments = rightCore.split('.').map(normalizeVersionSegment)
  const maxLength = Math.max(leftSegments.length, rightSegments.length)

  for (let index = 0; index < maxLength; index += 1) {
    const delta = (leftSegments[index] ?? 0) - (rightSegments[index] ?? 0)
    if (delta !== 0) {
      return delta > 0 ? 1 : -1
    }
  }

  if (leftPrerelease && !rightPrerelease) {
    return -1
  }

  if (!leftPrerelease && rightPrerelease) {
    return 1
  }

  return leftPrerelease.localeCompare(rightPrerelease)
}

function readPlatformDownload(downloads) {
  if (!isPlainObject(downloads)) {
    return undefined
  }

  const key = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : ''
  if (!key) {
    return undefined
  }

  const download = downloads[key]
  if (!isPlainObject(download) || typeof download.url !== 'string') {
    return undefined
  }

  return {
    platform: key,
    fileName: typeof download.filename === 'string' ? download.filename : '',
    url: download.url,
    sha256: typeof download.sha256 === 'string' ? download.sha256 : '',
    size: typeof download.size === 'number' ? download.size : 0
  }
}

function normalizeUpdateManifest(value) {
  if (!isPlainObject(value) || value.product !== 'lightyear-banana' || typeof value.version !== 'string') {
    throw new Error('更新信息不可用')
  }

  const download = readPlatformDownload(value.downloads)
  const releaseUrl = typeof value.releaseUrl === 'string' ? value.releaseUrl : 'https://github.com/CatREFuse/lightyear-banana/releases'

  return {
    version: value.version,
    tag: typeof value.tag === 'string' ? value.tag : `v${value.version}`,
    releaseUrl,
    mandatory: Boolean(value.mandatory),
    minimumSupportedVersion: typeof value.minimumSupportedVersion === 'string' ? value.minimumSupportedVersion : '',
    download
  }
}

async function fetchUpdateManifest() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), APP_UPDATE_TIMEOUT_MS)
  const startedAt = Date.now()
  void writeDiagnostic({
    category: 'update',
    operation: 'update.manifest.fetch',
    phase: 'start',
    details: { url: APP_UPDATE_MANIFEST_URL }
  })

  try {
    const response = await fetch(APP_UPDATE_MANIFEST_URL, {
      cache: 'no-store',
      signal: controller.signal
    })

    if (!response.ok) {
      throw new Error(`更新检测失败 ${response.status}`)
    }

    const manifest = normalizeUpdateManifest(await response.json())
    void writeDiagnostic({
      category: 'update',
      operation: 'update.manifest.fetch',
      phase: 'success',
      durationMs: Date.now() - startedAt,
      details: {
        latestVersion: manifest.version,
        status: response.status,
        url: APP_UPDATE_MANIFEST_URL
      }
    })
    return manifest
  } catch (error) {
    void writeDiagnostic({
      level: 'error',
      category: 'update',
      operation: 'update.manifest.fetch',
      phase: error?.name === 'AbortError' ? 'timeout' : 'error',
      durationMs: Date.now() - startedAt,
      details: { url: APP_UPDATE_MANIFEST_URL },
      error: normalizeDiagnosticError(error)
    })
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function buildUpdateCheckResult(manifest) {
  const currentVersion = readApplicationVersion()
  const hasUpdate = compareVersions(manifest.version, currentVersion) > 0
  const belowMinimum =
    Boolean(manifest.minimumSupportedVersion) && compareVersions(currentVersion, manifest.minimumSupportedVersion) < 0
  const mandatory = manifest.mandatory || belowMinimum

  return {
    status: hasUpdate ? 'available' : 'current',
    currentVersion,
    latestVersion: manifest.version,
    mandatory,
    releaseUrl: manifest.releaseUrl,
    downloadUrl: manifest.download?.url ?? manifest.releaseUrl,
    fileName: manifest.download?.fileName ?? '',
    checkedAt: new Date().toISOString()
  }
}

async function promptForUpdate(result) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  const detail = result.fileName
    ? `${result.fileName}\n当前版本 v${result.currentVersion}`
    : `当前版本 v${result.currentVersion}`
  const response = await dialog.showMessageBox(mainWindow, {
    type: result.mandatory ? 'warning' : 'info',
    buttons: result.mandatory ? ['下载更新', '退出'] : ['下载更新', '稍后'],
    defaultId: 0,
    cancelId: result.mandatory ? 1 : 1,
    title: '发现新版本',
    message: `Lightyear Banana v${result.latestVersion} 可下载`,
    detail,
    noLink: true
  })

  if (response.response === 0) {
    await shell.openExternal(result.downloadUrl || result.releaseUrl)
    return
  }

  if (result.mandatory) {
    app.quit()
  }
}

async function checkForAppUpdate(options = {}) {
  const source = options.source === 'startup' ? 'startup' : 'manual'

  try {
    const manifest = await fetchUpdateManifest()
    const result = buildUpdateCheckResult(manifest)

    if (result.status === 'available') {
      await promptForUpdate(result)
    }

    if (source === 'startup' && result.status !== 'available') {
      return { ...result, silent: true }
    }

    return result
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError'
      ? '更新检测超时'
      : error instanceof Error
        ? error.message
        : '更新检测失败'

    if (source === 'startup') {
      return {
        status: 'error',
        currentVersion: readApplicationVersion(),
        latestVersion: '',
        mandatory: false,
        releaseUrl: '',
        downloadUrl: '',
        fileName: '',
        checkedAt: new Date().toISOString(),
        message,
        silent: true
      }
    }

    return {
      status: 'error',
      currentVersion: readApplicationVersion(),
      latestVersion: '',
      mandatory: false,
      releaseUrl: '',
      downloadUrl: '',
      fileName: '',
      checkedAt: new Date().toISOString(),
      message
    }
  }
}

function scheduleStartupUpdateCheck() {
  if (startupUpdateTimer) {
    clearTimeout(startupUpdateTimer)
  }

  startupUpdateTimer = setTimeout(() => {
    startupUpdateTimer = null
    void checkForAppUpdate({ source: 'startup' })
  }, 2400)
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

function resizeNativeReferenceImage(image) {
  const size = image.getSize()
  const scale = Math.min(1, REFERENCE_JPEG_MAX_EDGE / Math.max(size.width, size.height))
  if (scale >= 1) {
    return image
  }

  return image.resize({
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
    quality: 'best'
  })
}

function encodeNativeReferenceJpeg(image) {
  const resized = resizeNativeReferenceImage(image)
  for (const quality of [90, 82, 74, 66, 58, 50]) {
    const buffer = resized.toJPEG(quality)
    if (buffer.length <= REFERENCE_JPEG_MAX_BYTES) {
      return {
        buffer,
        image: resized
      }
    }
  }

  let current = resized
  for (const scale of [0.85, 0.72, 0.6]) {
    const size = current.getSize()
    current = current.resize({
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
      quality: 'best'
    })
    const buffer = current.toJPEG(70)
    if (buffer.length <= REFERENCE_JPEG_MAX_BYTES) {
      return {
        buffer,
        image: current
      }
    }
  }

  throw new Error('参考图压缩后仍超过 9MB')
}

async function compressReferenceImageFile(filePath) {
  if (process.platform !== 'darwin') {
    const image = nativeImage.createFromPath(filePath)
    if (image.isEmpty()) {
      throw new Error('无法读取图片文件')
    }

    return encodeNativeReferenceJpeg(image)
  }

  const outputPath = join(tmpdir(), `lightyear-reference-${randomUUID()}.jpg`)
  let lastError = null
  for (const quality of ['90', '82', '74', '66', '58', '50']) {
    try {
      await execFileAsync('/usr/bin/sips', [
        '-Z',
        String(REFERENCE_JPEG_MAX_EDGE),
        '-s',
        'format',
        'jpeg',
        '-s',
        'formatOptions',
        quality,
        filePath,
        '--out',
        outputPath
      ])
      if (statSync(outputPath).size <= REFERENCE_JPEG_MAX_BYTES) {
        const image = nativeImage.createFromPath(outputPath)
        if (image.isEmpty()) {
          throw new Error('无法读取图片文件')
        }

        return {
          buffer: readFileSync(outputPath),
          image
        }
      }
    } catch (error) {
      lastError = error
    }
  }

  if (lastError) {
    throw new Error('参考图压缩失败')
  }

  throw new Error('参考图压缩后仍超过 9MB')
}

function createReferenceImageFromNativeImage(image, label, idPrefix) {
  if (image.isEmpty()) {
    throw new Error('剪贴板里没有图片')
  }

  const encoded = encodeNativeReferenceJpeg(image)
  const size = encoded.image.getSize()
  if (!size.width || !size.height) {
    throw new Error('无法读取图片尺寸')
  }

  return createSerializedReferenceImage({
    idPrefix,
    label,
    width: Math.round(size.width),
    height: Math.round(size.height),
    previewUrl: `data:image/jpeg;base64,${encoded.buffer.toString('base64')}`
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
  const startedAt = Date.now()
  void writeDiagnostic({
    category: 'file',
    operation: 'reference.file.pick',
    phase: 'start'
  })
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
    void writeDiagnostic({
      category: 'file',
      operation: 'reference.file.pick',
      phase: 'cancel',
      durationMs: Date.now() - startedAt
    })
    return null
  }

  const filePath = result.filePaths[0]
  const fileStat = statSync(filePath)
  void writeDiagnostic({
    category: 'file',
    operation: 'reference.file.read',
    phase: 'start',
    details: { byteLength: fileStat.size, filePath }
  })

  let encoded
  try {
    encoded = await compressReferenceImageFile(filePath)
  } catch (error) {
    void writeDiagnostic({
      level: 'error',
      category: 'file',
      operation: 'reference.file.compress',
      phase: 'error',
      durationMs: Date.now() - startedAt,
      details: { byteLength: fileStat.size, filePath },
      error: normalizeDiagnosticError(error)
    })
    throw error
  }

  const size = encoded.image.getSize()
  if (!size.width || !size.height) {
    throw new Error('无法读取图片尺寸')
  }

  void writeDiagnostic({
    category: 'file',
    operation: 'reference.file.compress',
    phase: 'success',
    durationMs: Date.now() - startedAt,
    details: {
      filePath,
      inputByteLength: fileStat.size,
      outputByteLength: encoded.buffer.length,
      width: Math.round(size.width),
      height: Math.round(size.height)
    }
  })

  return createSerializedReferenceImage({
    idPrefix: 'upload',
    label: `上传图片：${basename(filePath)}`,
    width: Math.round(size.width),
    height: Math.round(size.height),
    previewUrl: `data:image/jpeg;base64,${encoded.buffer.toString('base64')}`
  })
}

function readClipboardReferenceImage() {
  const startedAt = Date.now()
  const formats = clipboard.availableFormats()
  void writeDiagnostic({
    category: 'clipboard',
    operation: 'clipboard.image.read',
    phase: 'start',
    details: { formats }
  })
  const image = clipboard.readImage()
  if (!image.isEmpty()) {
    const result = createReferenceImageFromNativeImage(image, '剪贴板', 'clipboard')
    void writeDiagnostic({
      category: 'clipboard',
      operation: 'clipboard.image.read',
      phase: 'success',
      durationMs: Date.now() - startedAt,
      details: { formats, height: result.height, width: result.width, source: 'readImage' }
    })
    return result
  }

  const fallbackImage = readNativeImageFromClipboardBuffer()
  if (!fallbackImage) {
    void writeDiagnostic({
      level: 'error',
      category: 'clipboard',
      operation: 'clipboard.image.read',
      phase: 'error',
      durationMs: Date.now() - startedAt,
      details: { formats },
      error: { message: '剪贴板里没有图片' }
    })
    throw new Error('剪贴板里没有图片')
  }

  const result = createReferenceImageFromNativeImage(fallbackImage, '剪贴板', 'clipboard')
  void writeDiagnostic({
    category: 'clipboard',
    operation: 'clipboard.image.read',
    phase: 'success',
    durationMs: Date.now() - startedAt,
    details: { formats, height: result.height, width: result.width, source: 'readBuffer' }
  })
  return result
}

function readImageSaveExtensionFromMime(mimeType = '') {
  const extension = mimeType.split('/')[1]?.split(';')[0]?.toLowerCase()
  if (extension === 'jpeg') {
    return 'jpg'
  }

  return ['gif', 'jpg', 'png', 'webp'].includes(extension) ? extension : ''
}

function readImageSaveExtensionFromName(fileName = '') {
  const extension = extname(fileName).replace('.', '').toLowerCase()

  return ['gif', 'jpg', 'jpeg', 'png', 'webp'].includes(extension) ? (extension === 'jpeg' ? 'jpg' : extension) : ''
}

function sanitizeSaveFileName(fileName = '') {
  const clean = basename(fileName)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim()

  return clean || 'lightyear-image.png'
}

function withImageSaveExtension(fileName, extension) {
  const currentExtension = readImageSaveExtensionFromName(fileName)
  if (currentExtension) {
    return fileName.replace(new RegExp(`${currentExtension}$`, 'i'), extension)
  }

  return `${fileName}.${extension}`
}

async function readImageSaveBuffer(previewUrl) {
  const dataUrlMatch = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(String(previewUrl || ''))
  if (dataUrlMatch) {
    const mimeType = dataUrlMatch[1] || 'image/png'
    const isBase64 = Boolean(dataUrlMatch[2])
    const raw = dataUrlMatch[3] || ''

    return {
      buffer: isBase64 ? Buffer.from(raw, 'base64') : Buffer.from(decodeURIComponent(raw)),
      extension: readImageSaveExtensionFromMime(mimeType) || 'png'
    }
  }

  const response = await fetch(previewUrl)
  if (!response.ok) {
    throw new Error('图片下载失败')
  }

  const mimeType = response.headers.get('content-type') || ''
  const fallbackExtension = readImageSaveExtensionFromName(new URL(previewUrl).pathname)

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    extension: readImageSaveExtensionFromMime(mimeType) || fallbackExtension || 'png'
  }
}

async function saveGeneratedImageFile(payload = {}) {
  const startedAt = Date.now()
  if (!payload.previewUrl) {
    throw new Error('图片地址为空')
  }

  void writeDiagnostic({
    category: 'file',
    operation: 'result.image.save',
    phase: 'start',
    details: {
      fileName: payload.fileName,
      source: String(payload.previewUrl).startsWith('data:') ? 'data-url' : 'remote-url'
    }
  })

  let imageData
  try {
    imageData = await readImageSaveBuffer(payload.previewUrl)
  } catch (error) {
    void writeDiagnostic({
      level: 'error',
      category: 'file',
      operation: 'result.image.decode',
      phase: 'error',
      durationMs: Date.now() - startedAt,
      error: normalizeDiagnosticError(error)
    })
    throw error
  }
  const fileName = withImageSaveExtension(sanitizeSaveFileName(payload.fileName), imageData.extension)
  const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
    title: '保存图片',
    defaultPath: fileName,
    filters: [
      {
        name: '图片',
        extensions: Array.from(new Set([imageData.extension, 'png', 'jpg', 'webp']))
      }
    ]
  })

  if (result.canceled || !result.filePath) {
    void writeDiagnostic({
      category: 'file',
      operation: 'result.image.save',
      phase: 'cancel',
      durationMs: Date.now() - startedAt,
      details: { byteLength: imageData.buffer.length, fileName }
    })
    return { saved: false }
  }

  try {
    writeFileSync(result.filePath, imageData.buffer)
  } catch (error) {
    void writeDiagnostic({
      level: 'error',
      category: 'file',
      operation: 'result.image.write',
      phase: 'error',
      durationMs: Date.now() - startedAt,
      details: { byteLength: imageData.buffer.length, filePath: result.filePath },
      error: normalizeDiagnosticError(error)
    })
    throw error
  }

  void writeDiagnostic({
    category: 'file',
    operation: 'result.image.write',
    phase: 'success',
    durationMs: Date.now() - startedAt,
    details: { byteLength: imageData.buffer.length, filePath: result.filePath }
  })

  return { saved: true, filePath: result.filePath }
}

function readDiagnosticExportFileName() {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13)
  return `lightyear-banana-diagnostics-${timestamp}.jsonl`
}

function readCrxLogExportFileName() {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 13)
  return `lightyear-banana-crx-logs-${timestamp}.jsonl`
}

async function exportDiagnosticLog() {
  if (!diagnosticLogger) {
    throw new Error('诊断日志尚未准备完成')
  }

  const startedAt = Date.now()
  void writeDiagnostic({
    category: 'diagnostics',
    operation: 'diagnostics.export',
    phase: 'start'
  })
  const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
    title: '下载诊断日志',
    defaultPath: readDiagnosticExportFileName(),
    filters: [
      {
        name: '诊断日志',
        extensions: ['jsonl']
      }
    ]
  })

  if (result.canceled || !result.filePath) {
    void writeDiagnostic({
      category: 'diagnostics',
      operation: 'diagnostics.export',
      phase: 'cancel',
      durationMs: Date.now() - startedAt
    })
    return { saved: false }
  }

  try {
    const exported = await diagnosticLogger.exportTo(result.filePath)
    void writeDiagnostic({
      category: 'diagnostics',
      operation: 'diagnostics.export',
      phase: 'success',
      durationMs: Date.now() - startedAt,
      details: exported
    })
    return { saved: true, ...exported }
  } catch (error) {
    void writeDiagnostic({
      level: 'error',
      category: 'diagnostics',
      operation: 'diagnostics.export',
      phase: 'error',
      durationMs: Date.now() - startedAt,
      details: { filePath: result.filePath },
      error: normalizeDiagnosticError(error)
    })
    throw error
  }
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
    const expired = state.expiredRequests.get(message.id)
    if (expired) {
      void writeDiagnostic({
        level: 'warn',
        requestId: message.id,
        category: 'bridge',
        operation: 'bridge.uxp.lateResponse',
        phase: message.ok ? 'success' : 'error',
        durationMs: Date.now() - expired.startedAt,
        details: { command: expired.command },
        error: message.ok ? undefined : message.error
      })
      scheduleDiagnosticEventCleanup(message.id)
    }
    return false
  }

  clearTimeout(pending.timer)
  state.pending.delete(message.id)
  scheduleDiagnosticEventCleanup(message.id)

  if (message.ok) {
    void writeDiagnostic({
      requestId: message.id,
      category: 'bridge',
      operation: 'bridge.uxp.command',
      phase: 'success',
      durationMs: Date.now() - pending.startedAt,
      details: { command: pending.command }
    })
    pending.resolve(message.payload)
  } else {
    const error = new Error(message.error?.message || 'Photoshop 操作失败')
    error.code = message.error?.code
    void writeDiagnostic({
      level: 'error',
      requestId: message.id,
      category: 'bridge',
      operation: 'bridge.uxp.command',
      phase: 'error',
      durationMs: Date.now() - pending.startedAt,
      details: { command: pending.command },
      error: message.error || normalizeDiagnosticError(error)
    })
    pending.reject(error)
  }

  return true
}

function readUxpCommandTimeout(command) {
  if (typeof command === 'string' && command.startsWith('canvas.capture')) {
    return 120000
  }

  if (command === 'canvas.placeImage') {
    return 120000
  }

  return 30000
}

function sendToUxp(type, payload = {}) {
  if (!isPhotoshopConnected()) {
    void writeDiagnostic({
      level: 'error',
      category: 'bridge',
      operation: 'bridge.uxp.command',
      phase: 'error',
      details: { command: type },
      error: { code: 'UXP_NOT_CONNECTED', message: 'Photoshop 插件未连接' }
    })
    return Promise.reject(new Error('Photoshop 插件未连接'))
  }

  const id = randomUUID()
  const startedAt = Date.now()
  const message = {
    id,
    type,
    role: 'main',
    payload,
    createdAt: Date.now()
  }

  void writeDiagnostic({
    requestId: id,
    category: 'bridge',
    operation: 'bridge.uxp.command',
    phase: 'start',
    details: {
      command: type,
      payload: readCommandPayloadSummary(type, payload),
      queueLength: state.uxpQueue.length
    }
  })

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.pending.delete(id)
      const error = new Error('Photoshop 操作超时')
      error.code = 'UXP_COMMAND_TIMEOUT'
      state.expiredRequests.set(id, { command: type, startedAt, timedOutAt: Date.now() })
      scheduleDiagnosticEventCleanup(id)
      void writeDiagnostic({
        level: 'error',
        requestId: id,
        category: 'bridge',
        operation: 'bridge.uxp.command',
        phase: 'timeout',
        durationMs: Date.now() - startedAt,
        details: { command: type, queueLength: state.uxpQueue.length },
        error: normalizeDiagnosticError(error)
      })
      reject(error)
    }, readUxpCommandTimeout(type))

    state.pending.set(id, { command: type, resolve, reject, startedAt, timer })
    state.uxpQueue.push(message)
    flushPollWaiters()
  })
}

function markUxpConnected(payload = {}) {
  state.uxpLastSeen = Date.now()
  state.lastDocumentLabel = payload.documentLabel || state.lastDocumentLabel
}

function shiftUxpMessage() {
  const message = state.uxpQueue.shift()
  if (message) {
    void writeDiagnostic({
      requestId: message.id,
      category: 'bridge',
      operation: 'bridge.uxp.dispatch',
      phase: 'success',
      details: { command: message.type, queueLength: state.uxpQueue.length }
    })
  }
  return message
}

function flushPollWaiters() {
  while (state.pollWaiters.length && state.uxpQueue.length) {
    const waiter = state.pollWaiters.shift()
    clearTimeout(waiter.timer)
    const message = shiftUxpMessage()
    waiter.tracker?.annotate({ command: message?.type, requestId: message?.id, result: 'command' })
    sendJson(waiter.response, 200, message)
  }
}

async function exportCrxLog() {
  if (!diagnosticLogger) {
    throw new Error('连接日志尚未准备完成')
  }

  const startedAt = Date.now()
  void writeDiagnostic({ category: 'crx', operation: 'crx.logs.export', phase: 'start' })
  const result = await dialog.showSaveDialog(mainWindow ?? undefined, {
    title: '导出 Photoshop 连接日志',
    defaultPath: readCrxLogExportFileName(),
    filters: [{ name: 'CRX 日志', extensions: ['jsonl'] }]
  })

  if (result.canceled || !result.filePath) {
    void writeDiagnostic({
      category: 'crx',
      operation: 'crx.logs.export',
      phase: 'cancel',
      durationMs: Date.now() - startedAt
    })
    return { saved: false }
  }

  try {
    const exported = await diagnosticLogger.exportTo(result.filePath, {
      category: 'crx',
      operation: 'crx.logs.export.snapshot',
      filter: (record) => ['crx', 'bridge', 'photoshop'].includes(record.category)
    })
    void writeDiagnostic({
      category: 'crx',
      operation: 'crx.logs.export',
      phase: 'success',
      durationMs: Date.now() - startedAt,
      details: exported
    })
    return { saved: true, ...exported }
  } catch (error) {
    void writeDiagnostic({
      level: 'error',
      category: 'crx',
      operation: 'crx.logs.export',
      phase: 'error',
      durationMs: Date.now() - startedAt,
      details: { filePath: result.filePath },
      error: normalizeDiagnosticError(error)
    })
    throw error
  }
}

async function handleHttpUxpRequest(request, response, url, tracker) {
  if (url.searchParams.get('token') !== BRIDGE_TOKEN) {
    tracker?.annotate({ authenticated: false, result: 'forbidden' })
    sendJson(response, 403, { ok: false, error: 'Invalid token' })
    return true
  }

  tracker?.annotate({ authenticated: true })

  if (request.method === 'POST' && url.pathname === '/uxp/hello') {
    const body = await readJsonBody(request)
    tracker?.annotate({ requestId: body.id, command: body.type, result: 'hello' })
    markUxpConnected(body.payload)
    void writeDiagnostic({
      category: 'bridge',
      operation: 'bridge.uxp.hello',
      phase: 'success',
      details: {
        documentLabel: body.payload?.documentLabel,
        photoshopVersion: body.payload?.photoshopVersion,
        uxpVersion: body.payload?.uxpVersion
      }
    })
    broadcastRendererEvent({
      type: 'photoshop.connected',
      payload: readBridgeStatus()
    })
    sendJson(response, 200, { ok: true, ...readBridgeStatus() })
    return true
  }

  if (request.method === 'POST' && url.pathname === '/uxp/diagnostics') {
    const body = await readJsonBody(request)
    tracker?.annotate({ requestId: body.requestId, result: 'diagnostic' })
    markUxpConnected(body.payload)
    const accepted = ingestUxpDiagnostic(body.requestId, body.event, 'live')
    sendJson(response, 200, { ok: true, accepted })
    return true
  }

  if (request.method === 'POST' && url.pathname === '/uxp/logs') {
    const body = await readJsonBody(request)
    const accepted = ingestCrxClientInteractions(body.records)
    tracker?.annotate({ result: 'replayed-client-logs', acceptedCount: accepted })
    markUxpConnected()
    sendJson(response, 200, { ok: true, accepted })
    return true
  }

  if (request.method === 'GET' && url.pathname === '/uxp/poll') {
    markUxpConnected()
    if (state.uxpQueue.length) {
      const message = shiftUxpMessage()
      tracker?.annotate({ command: message?.type, requestId: message?.id, result: 'command' })
      sendJson(response, 200, message)
      return true
    }

    const waiter = {
      response,
      timer: setTimeout(() => {
        state.pollWaiters = state.pollWaiters.filter((entry) => entry !== waiter)
        tracker?.annotate({ result: 'noop' })
        sendJson(response, 200, {
          id: `noop-${Date.now()}`,
          type: 'bridge.noop',
          role: 'main',
          payload: {},
          createdAt: Date.now()
        })
      }, 25000),
      tracker
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
    tracker?.annotate({ requestId: body.id, result: body.ok ? 'command-success' : 'command-error' })
    markUxpConnected(body.payload)
    if (body.id) {
      ingestUxpTrace(body.id, body.diagnostics, 'final-response')
      resolvePending(body)
    }
    sendJson(response, 200, { ok: true })
    return true
  }

  return false
}

async function sendStaticFile(request, response) {
  const url = new URL(request.url || '/', readBridgeOrigin())
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

function readPreviewFileName(record) {
  return withImageSaveExtension(
    sanitizeSaveFileName(`${record.label || 'lightyear-image'}-${record.width || 0}x${record.height || 0}.png`),
    'png'
  )
}

function readMimeTypeFromExtension(extension) {
  return REFERENCE_IMAGE_MIME_TYPES[`.${extension}`] || 'image/png'
}

async function readPreviewImageData(record) {
  const parts = readDataUrlParts(record.previewUrl)
  if (parts) {
    return {
      buffer: parts.isBase64 ? Buffer.from(parts.data, 'base64') : Buffer.from(decodeURIComponent(parts.data), 'utf8'),
      contentType: parts.mimeType,
      extension: readImageSaveExtensionFromMime(parts.mimeType) || 'png'
    }
  }

  const imageData = await readImageSaveBuffer(record.previewUrl)

  return {
    ...imageData,
    contentType: readMimeTypeFromExtension(imageData.extension)
  }
}

function createPreviewHtml(record) {
  const title = `${record.label || '图片预览'} · ${record.width || '?'} × ${record.height || '?'}`
  const imageUrl = `/preview/${encodeURIComponent(record.id)}/image`
  const downloadUrl = `${imageUrl}?download=1`

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

    .actions {
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      gap: 8px;
    }

    a {
      display: inline-flex;
      height: 28px;
      align-items: center;
      justify-content: center;
      padding: 0 10px;
      border-radius: 8px;
      color: #cbd4e2;
      font-size: 12px;
      text-decoration: none;
    }

    a:hover {
      background: rgba(255, 255, 255, 0.06);
      color: #ffffff;
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
  <header>
    <span>${escapeHtml(title)}</span>
    <div class="actions">
      <a href="${downloadUrl}" download="${escapeHtml(readPreviewFileName(record))}">下载</a>
      <a href="/preview/${encodeURIComponent(record.id)}/save">保存</a>
    </div>
  </header>
  <main><img src="${imageUrl}" alt="${escapeHtml(record.label || '图片预览')}"></main>
</body>
</html>`
}

function createPreviewSaveHtml(saved) {
  const message = saved ? '已保存到本地' : '已取消保存'

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(message)}</title>
  <style>
    body {
      display: grid;
      min-height: 100vh;
      margin: 0;
      place-items: center;
      background: #0f141c;
      color: #f5f7fb;
      font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
  </style>
</head>
<body>${escapeHtml(message)}</body>
</html>`
}

async function sendPreviewImage(response, record, method, download = false) {
  const imageData = await readPreviewImageData(record)
  const headers = {
    'Cache-Control': 'no-store',
    'Content-Length': String(imageData.buffer.length),
    'Content-Type': imageData.contentType
  }

  if (download) {
    headers['Content-Disposition'] = `attachment; filename="${readPreviewFileName(record)}"`
  }

  response.writeHead(200, headers)
  if (method === 'HEAD') {
    response.end()
    return
  }

  response.end(imageData.buffer)
}

async function sendPreviewPage(request, response, url) {
  const match = /^\/preview\/([^/]+)(?:\/(image|save))?$/.exec(url.pathname)
  if (!match) {
    return false
  }

  const id = decodeURIComponent(match[1])
  const action = match[2]
  const record = state.previewImages.get(id)
  if (!record) {
    sendJson(response, 404, { ok: false, error: 'Preview not found' })
    return true
  }

  if (action === 'image') {
    await sendPreviewImage(response, record, request.method, url.searchParams.get('download') === '1')
    return true
  }

  if (action === 'save') {
    const result = await saveGeneratedImageFile({
      ...record,
      fileName: readPreviewFileName(record)
    })
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8'
    })
    response.end(createPreviewSaveHtml(result.saved))
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
    const url = new URL(request.url || '/', readBridgeOrigin())
    const crxTracker = url.pathname.startsWith('/uxp/')
      ? createCrxInteractionTracker(request, response, url)
      : null

    try {
      if (request.method === 'OPTIONS') {
        crxTracker?.annotate({ result: 'preflight' })
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

      if (url.pathname.startsWith('/uxp/') && (await handleHttpUxpRequest(request, response, url, crxTracker))) {
        return
      }

      sendStaticFile(request, response)
    } catch (error) {
      crxTracker?.fail(error)
      if (!response.headersSent) {
        sendJson(response, error instanceof SyntaxError ? 400 : 500, { ok: false, error: 'Request failed' })
      } else {
        response.destroy(error)
      }
    }
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(bridgePort, BRIDGE_HOST, () => {
      state.server = server
      resolve()
    })
  })
}

async function startBridgeServerWithFallback() {
  const preferredPorts = [
    bridgePort,
    DEFAULT_BRIDGE_PORT,
    bridgePort + 1,
    bridgePort + 2,
    DEFAULT_BRIDGE_PORT + 1,
    DEFAULT_BRIDGE_PORT + 2
  ].filter((port, index, ports) => Number.isFinite(port) && port > 0 && ports.indexOf(port) === index)

  let lastError
  for (const port of preferredPorts) {
    bridgePort = port
    try {
      await startBridgeServer()
      if (port !== requestedBridgePort) {
        console.warn(`Lightyear bridge port switched to ${readBridgeOrigin()} because ${BRIDGE_HOST}:${requestedBridgePort} is unavailable`)
      }
      return
    } catch (error) {
      lastError = error
      if (error?.code !== 'EADDRINUSE') {
        throw error
      }
      console.warn(`Lightyear bridge port already in use: http://${BRIDGE_HOST}:${port}`)
    }
  }

  throw lastError ?? new Error('Lightyear bridge unavailable')
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

  await mainWindow.loadURL(`${readBridgeOrigin()}/app/?runtime=electron&platform=${process.platform}`)
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
  const ratio = record.width > 0 && record.height > 0 ? record.width / record.height : 1
  const maxWidth = Math.min(1180, Math.floor(workArea.width * 0.72))
  const maxHeight = Math.min(920, Math.floor(workArea.height * 0.82))
  const chromeHeight = 54
  const imageMaxHeight = Math.max(260, maxHeight - chromeHeight)
  let width = Math.min(maxWidth, Math.round(imageMaxHeight * ratio))
  let height = Math.round(width / ratio) + chromeHeight
  if (height > maxHeight) {
    height = maxHeight
    width = Math.round((height - chromeHeight) * ratio)
  }
  width = Math.min(maxWidth, Math.max(360, width))
  height = Math.min(maxHeight, Math.max(320, height))
  const previewWindow = new BrowserWindow({
    width,
    height,
    minWidth: 320,
    minHeight: 320,
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

  await previewWindow.loadURL(`${readBridgeOrigin()}/preview/${encodeURIComponent(id)}`)
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

async function runRendererCommand(command, payload) {
  if (command === 'app.status') {
    return readBridgeStatus()
  }

  if (command === 'app.deployWindows') {
    return deployWorkspaceWindows(payload)
  }

  if (command === 'app.openMacPermissionSettings') {
    return openMacPermissionSettings(payload)
  }

  if (command === 'app.checkForUpdates') {
    return checkForAppUpdate({ source: 'manual' })
  }

  if (command === 'diagnostics.export') {
    return exportDiagnosticLog()
  }

  if (command === 'crx.logs.export') {
    return exportCrxLog()
  }

  if (command === 'reference.pickUpload') {
    return pickReferenceImageFile()
  }

  if (command === 'reference.readClipboard') {
    return readClipboardReferenceImage()
  }

  if (command === 'result.saveImage') {
    return saveGeneratedImageFile(payload)
  }

  return sendToUxp(command, payload)
}

ipcMain.handle('lightyear:invoke', async (_event, command, payload) => {
  const startedAt = Date.now()
  void writeDiagnostic({
    category: 'app',
    operation: 'renderer.invoke',
    phase: 'start',
    details: { command, payload: readCommandPayloadSummary(command, payload) }
  })

  try {
    const result = await runRendererCommand(command, payload)
    void writeDiagnostic({
      category: 'app',
      operation: 'renderer.invoke',
      phase: result?.saved === false ? 'cancel' : 'success',
      durationMs: Date.now() - startedAt,
      details: { command }
    })
    return result
  } catch (error) {
    void writeDiagnostic({
      level: 'error',
      category: 'app',
      operation: 'renderer.invoke',
      phase: 'error',
      durationMs: Date.now() - startedAt,
      details: { command },
      error: normalizeDiagnosticError(error)
    })
    throw error
  }
})

app.whenReady().then(async () => {
  try {
    await initializeDiagnostics()
  } catch (error) {
    diagnosticLogger = null
    console.error('[Lightyear diagnostics] initialization failed', error)
  }

  await startBridgeServerWithFallback()
  void writeDiagnostic({
    category: 'bridge',
    operation: 'bridge.server.start',
    phase: 'success',
    details: { origin: readBridgeOrigin() }
  })
  await startBuiltInCodexImageServer()
  await createMainWindow()
  void writeDiagnostic({
    category: 'app',
    operation: 'app.window.create',
    phase: 'success',
    details: { bounds: mainWindow?.getBounds() }
  })
  powerMonitor.on('resume', () => {
    void diagnosticLogger?.prune()
    void writeDiagnostic({
      category: 'app',
      operation: 'app.resume',
      phase: 'success'
    })
  })
  scheduleStartupUpdateCheck()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createMainWindow().then(scheduleStartupUpdateCheck).catch((error) => console.error(error))
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  void writeDiagnostic({
    category: 'app',
    operation: 'app.quit',
    phase: 'start',
    details: { uptimeMs: Date.now() - state.startedAt }
  })
  if (startupUpdateTimer) {
    clearTimeout(startupUpdateTimer)
    startupUpdateTimer = null
  }
  state.server?.close()
  state.codexImageServer?.close()
  void diagnosticLogger?.close()
})

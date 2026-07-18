import { randomUUID } from 'node:crypto'
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export const DIAGNOSTIC_RETENTION_MS = 24 * 60 * 60 * 1000

const LOG_FILE_PATTERN = /^diagnostics-(\d{4}-\d{2}-\d{2}T\d{2})\.jsonl$/
const SECRET_KEY_PATTERN = /(?:api[-_]?key|authorization|cookie|credential|password|secret|access[-_]?token|refresh[-_]?token|bridge[-_]?token)/i
const OMITTED_KEY_PATTERN = /^(?:base64|body|imageData|pixels|previewUrl|prompt|requestBody|responseBody|rgba)$/i
const LARGE_STRING_LIMIT = 4096

function redactString(value) {
  if (/^data:/i.test(value)) {
    return `[DATA_URL omitted; length=${value.length}]`
  }

  const redacted = value
    .replace(/([?&](?:api[-_]?key|key|token|access[-_]?token|secret|password)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=:-]+/gi, '$1 [REDACTED]')
    .replace(/\b(api[-_ ]?key|authorization|password|secret|access[-_ ]?token|refresh[-_ ]?token|token)(\s*[=:]\s*)[^\s,;}"]+/gi, '$1$2[REDACTED]')

  if (redacted.length > LARGE_STRING_LIMIT) {
    return `${redacted.slice(0, LARGE_STRING_LIMIT)}…[truncated ${redacted.length - LARGE_STRING_LIMIT} chars]`
  }

  return redacted
}

function sanitizeValue(value, key, seen) {
  if (SECRET_KEY_PATTERN.test(key)) {
    return '[REDACTED]'
  }

  if (OMITTED_KEY_PATTERN.test(key)) {
    return `[OMITTED ${key}]`
  }

  if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') {
    return value ?? null
  }

  if (typeof value === 'string') {
    return redactString(value)
  }

  if (typeof value === 'bigint') {
    return value.toString()
  }

  if (typeof value === 'function' || typeof value === 'symbol') {
    return String(value)
  }

  if (ArrayBuffer.isView(value)) {
    return {
      type: value.constructor?.name || 'TypedArray',
      byteLength: value.byteLength
    }
  }

  if (value instanceof ArrayBuffer) {
    return {
      type: 'ArrayBuffer',
      byteLength: value.byteLength
    }
  }

  if (seen.has(value)) {
    return '[Circular]'
  }

  seen.add(value)
  if (Array.isArray(value)) {
    const result = value.slice(0, 100).map((entry, index) => sanitizeValue(entry, String(index), seen))
    if (value.length > 100) {
      result.push(`[${value.length - 100} items omitted]`)
    }
    seen.delete(value)
    return result
  }

  const result = {}
  for (const property of Object.keys(value)) {
    result[property] = sanitizeValue(value[property], property, seen)
  }
  seen.delete(value)
  return result
}

export function sanitizeDiagnosticValue(value) {
  return sanitizeValue(value, '', new WeakSet())
}

export function normalizeDiagnosticError(error) {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) {
    return {
      message: redactString(String(error ?? 'Unknown error'))
    }
  }

  const source = error
  const normalized = {}
  for (const key of [
    'name',
    'message',
    'number',
    'code',
    'errno',
    'syscall',
    'path',
    'stack',
    'descriptor',
    'details'
  ]) {
    try {
      if (source[key] !== undefined) {
        normalized[key] = sanitizeValue(source[key], key, new WeakSet())
      }
    } catch {
    }
  }

  try {
    if (source.cause !== undefined) {
      normalized.cause = normalizeDiagnosticError(source.cause)
    }
  } catch {
  }

  if (!normalized.message) {
    normalized.message = redactString(String(error))
  }

  return normalized
}

export function diagnosticFileNameForTimestamp(timestamp) {
  return `diagnostics-${new Date(timestamp).toISOString().slice(0, 13)}.jsonl`
}

function parseRecord(line) {
  if (!line.trim()) {
    return null
  }

  const record = JSON.parse(line)
  const time = Date.parse(record.timestamp)
  if (!Number.isFinite(time)) {
    throw new Error('Diagnostic timestamp is invalid')
  }

  return { record, time }
}

function compareRecords(left, right) {
  return (
    Date.parse(left.timestamp) - Date.parse(right.timestamp) ||
    String(left.requestId ?? '').localeCompare(String(right.requestId ?? '')) ||
    Number(left.sequence ?? 0) - Number(right.sequence ?? 0) ||
    String(left.eventId ?? '').localeCompare(String(right.eventId ?? ''))
  )
}

export function createDiagnosticLogger(options) {
  const {
    directory,
    runtime = () => ({}),
    now = () => Date.now(),
    retentionMs = DIAGNOSTIC_RETENTION_MS,
    sessionId = randomUUID(),
    schedule = true,
    reportError = (error) => console.error('[Lightyear diagnostics]', error)
  } = options

  if (!directory) {
    throw new Error('Diagnostic directory is required')
  }

  let queue = Promise.resolve()
  let expiryTimer
  let closed = false

  function clearExpiryTimer() {
    if (expiryTimer) {
      clearTimeout(expiryTimer)
      expiryTimer = undefined
    }
  }

  function scheduleExpiry(oldestTime, snapshotTime) {
    clearExpiryTimer()
    if (!schedule || closed || !Number.isFinite(oldestTime)) {
      return
    }

    const delay = Math.max(1, oldestTime + retentionMs - snapshotTime + 1)
    expiryTimer = setTimeout(() => {
      expiryTimer = undefined
      void prune()
    }, Math.min(delay, 2_147_483_647))
    expiryTimer.unref?.()
  }

  function enqueue(task, { swallow = false } = {}) {
    const result = queue.then(task, task)
    queue = result.catch((error) => {
      reportError(error)
    })

    return swallow ? result.catch(() => null) : result
  }

  async function ensureDirectory() {
    await mkdir(directory, { recursive: true, mode: 0o700 })
  }

  async function readLogFiles() {
    await ensureDirectory()
    const entries = await readdir(directory)
    return entries.filter((entry) => LOG_FILE_PATTERN.test(entry)).sort()
  }

  async function writeAtomic(filePath, content) {
    const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(temporaryPath, content, { encoding: 'utf8', mode: 0o600 })
    try {
      await rename(temporaryPath, filePath)
    } catch (error) {
      if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') {
        await rm(temporaryPath, { force: true })
        throw error
      }
      await rm(filePath, { force: true })
      await rename(temporaryPath, filePath)
    }
  }

  async function cleanupTemporaryFiles() {
    await ensureDirectory()
    const entries = await readdir(directory)
    await Promise.all(
      entries
        .filter((entry) => entry.includes('.tmp-'))
        .map((entry) => rm(join(directory, entry), { force: true }))
    )
  }

  async function readRecentInternal(snapshotTime, { rewrite = false } = {}) {
    const cutoff = snapshotTime - retentionMs
    const records = []
    const corrupt = []
    let oldestTime = Number.POSITIVE_INFINITY

    for (const fileName of await readLogFiles()) {
      const filePath = join(directory, fileName)
      const raw = await readFile(filePath, 'utf8')
      const keptLines = []
      let changed = false

      for (const [index, line] of raw.split(/\r?\n/).entries()) {
        if (!line.trim()) {
          continue
        }

        try {
          const parsed = parseRecord(line)
          if (!parsed || parsed.time < cutoff || parsed.time > snapshotTime) {
            changed = true
            continue
          }

          oldestTime = Math.min(oldestTime, parsed.time)
          keptLines.push(JSON.stringify(parsed.record))
          records.push(parsed.record)
        } catch (error) {
          changed = true
          corrupt.push({
            fileName,
            line: index + 1,
            error: normalizeDiagnosticError(error)
          })
        }
      }

      if (rewrite && changed) {
        if (keptLines.length) {
          await writeAtomic(filePath, `${keptLines.join('\n')}\n`)
        } else {
          await rm(filePath, { force: true })
        }
      }
    }

    records.sort(compareRecords)
    scheduleExpiry(oldestTime, snapshotTime)
    return { cutoff, corrupt, records, snapshotTime }
  }

  async function pruneInternal(snapshotTime) {
    return readRecentInternal(snapshotTime, { rewrite: true })
  }

  function initialize() {
    return enqueue(async () => {
      await cleanupTemporaryFiles()
      return pruneInternal(now())
    }, { swallow: true })
  }

  function log(event) {
    return enqueue(async () => {
      const timestamp = event.timestamp || new Date(now()).toISOString()
      const record = sanitizeDiagnosticValue({
        ...event,
        timestamp,
        level: event.level || 'info',
        sessionId,
        runtime: runtime()
      })
      const filePath = join(directory, diagnosticFileNameForTimestamp(record.timestamp))
      await ensureDirectory()
      await appendFile(filePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 })
      await pruneInternal(now())
      return record
    }, { swallow: true })
  }

  function prune(snapshotTime = now()) {
    return enqueue(() => pruneInternal(snapshotTime), { swallow: true })
  }

  function readRecent(snapshotTime = now()) {
    return enqueue(() => readRecentInternal(snapshotTime))
  }

  function exportTo(filePath, options = {}) {
    return enqueue(async () => {
      const snapshotTime = now()
      const snapshot = await pruneInternal(snapshotTime)
      const records = typeof options.filter === 'function'
        ? snapshot.records.filter((record) => options.filter(record))
        : snapshot.records
      const metadata = sanitizeDiagnosticValue({
        timestamp: new Date(snapshotTime).toISOString(),
        level: 'info',
        sessionId,
        category: options.category || 'diagnostics',
        operation: options.operation || 'diagnostics.export.snapshot',
        phase: 'success',
        runtime: runtime(),
        details: {
          cutoff: new Date(snapshot.cutoff).toISOString(),
          snapshotTime: new Date(snapshotTime).toISOString(),
          recordCount: records.length,
          corruptRecordCount: snapshot.corrupt.length,
          corruptRecords: snapshot.corrupt
        }
      })
      const content = `${[metadata, ...records].map((record) => JSON.stringify(record)).join('\n')}\n`
      await writeAtomic(filePath, content)
      return {
        fileName: basename(filePath),
        filePath,
        recordCount: records.length,
        cutoff: new Date(snapshot.cutoff).toISOString(),
        snapshotTime: new Date(snapshotTime).toISOString()
      }
    })
  }

  async function close() {
    closed = true
    clearExpiryTimer()
    await queue
  }

  return {
    close,
    directory,
    exportTo,
    flush: () => queue,
    initialize,
    log,
    prune,
    readRecent,
    retentionMs,
    sessionId
  }
}

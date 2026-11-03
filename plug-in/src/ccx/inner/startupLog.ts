import { getHostRequire } from '../photoshopHost'

export type StartupLogEndpoint = 'photoshop' | 'ccx' | 'webui'

export type StartupLogEntry = {
  sequence: number
  timestamp: string
  elapsedMs: number
  source: StartupLogEndpoint
  target: StartupLogEndpoint
  event: string
  details?: unknown
}

type TextFile = {
  write: (contents: string) => Promise<void>
}

const SENSITIVE_KEY = /(?:api[-_]?key|authorization|cookie|credential|password|secret|token|prompt|workflow|image|rgba|base64|body|content|file[-_]?data|preview[-_]?url|chunk|bytes|(?:^|[_-])data(?:$|[_-]))/i
const DATA_URL = /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi
const BEARER_TOKEN = /Bearer\s+[a-z0-9._~+/=-]+/gi
const API_KEY = /\bsk-[a-z0-9_-]{8,}\b/gi
const LOCAL_PATH = /(?:[A-Za-z]:\\|\/(?:Users|home|var|private|tmp)\/)[^\s"']+/g
const HTTP_URL = /https?:\/\/[^\s"']+/gi

function sanitizeText(value: string) {
  return value
    .replace(DATA_URL, (match) => `[IMAGE_DATA:${match.length}]`)
    .replace(BEARER_TOKEN, 'Bearer [REDACTED]')
    .replace(API_KEY, '[REDACTED_API_KEY]')
    .replace(LOCAL_PATH, '[LOCAL_PATH]')
    .replace(HTTP_URL, (candidate) => {
      try {
        const url = new URL(candidate)
        url.username = ''
        url.password = ''
        url.search = ''
        url.hash = ''
        return url.toString()
      } catch {
        return '[URL]'
      }
    })
}

export function sanitizeStartupLog(value: unknown, key = '', seen = new WeakSet<object>()): unknown {
  if (SENSITIVE_KEY.test(key)) {
    if (typeof value === 'string' && value.startsWith('data:image/')) return `[IMAGE_DATA:${value.length}]`
    return '[REDACTED]'
  }
  if (typeof value === 'string') return sanitizeText(value)
  if (value instanceof ArrayBuffer) return `[BINARY:${value.byteLength}]`
  if (ArrayBuffer.isView(value)) return `[BINARY:${value.byteLength}]`
  if (Array.isArray(value)) return value.map((item) => sanitizeStartupLog(item, '', seen))
  if (value && typeof value === 'object') {
    if (seen.has(value)) return '[CIRCULAR]'
    seen.add(value)
    const sanitized = Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([childKey, childValue]) => [childKey, sanitizeStartupLog(childValue, childKey, seen)])
    )
    seen.delete(value)
    return sanitized
  }
  return value
}

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    }
  }
  return { error }
}

export class StartupLog {
  private readonly startedAt = Date.now()
  private readonly records: StartupLogEntry[] = []
  private readonly version: string
  private completed = false

  constructor(version: string, sessionId: string) {
    this.version = version
    this.record('ccx', 'ccx', 'startup.begin', {
      version,
      sessionId,
      runtime: this.runtimeDetails()
    })
  }

  record(source: StartupLogEndpoint, target: StartupLogEndpoint, event: string, details?: unknown) {
    if (this.completed) return
    const entry: StartupLogEntry = {
      sequence: this.records.length + 1,
      timestamp: new Date().toISOString(),
      elapsedMs: Date.now() - this.startedAt,
      source,
      target,
      event,
      ...(details === undefined ? {} : { details: sanitizeStartupLog(details) })
    }
    this.records.push(entry)
    return entry
  }

  finish(details?: unknown) {
    this.record('webui', 'ccx', 'startup.ready', details)
    this.completed = true
  }

  snapshot() {
    return this.records.map((record) => sanitizeStartupLog(record) as StartupLogEntry)
  }

  async export() {
    const hostRequire = getHostRequire()
    const fileSystem = hostRequire?.('uxp')?.storage?.localFileSystem as {
      getFileForSaving?: (name: string, options?: Record<string, unknown>) => Promise<TextFile | null>
    } | undefined
    if (!fileSystem?.getFileForSaving) throw new Error('文件保存器不可用')

    const fileName = `mugen-startup-${this.version}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`
    const file = await fileSystem.getFileForSaving(fileName, { types: ['jsonl'] })
    if (!file) return { saved: false as const }

    this.record('ccx', 'ccx', 'startup-log.export', { fileName })
    const jsonl = this.snapshot().map((record) => JSON.stringify(record)).join('\n')
    await file.write(`${jsonl}\n`)
    return { saved: true as const, fileName }
  }

  private runtimeDetails() {
    const hostRequire = getHostRequire()
    if (!hostRequire) return { uxp: 'unavailable' }
    try {
      const photoshop = hostRequire('photoshop')
      const uxp = hostRequire('uxp')
      return {
        photoshopVersion: photoshop?.app?.version ?? 'unknown',
        uxpVersion: uxp?.versions?.uxp ?? 'unknown'
      }
    } catch (error) {
      return { runtimeError: errorDetails(error) }
    }
  }
}

export function toStartupErrorDetails(error: unknown) {
  return sanitizeStartupLog(errorDetails(error))
}

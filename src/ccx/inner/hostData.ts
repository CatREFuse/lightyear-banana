import { isGenerationSnapshot, type HistoryEntry, type HistoryUpsertEntry, type HostAssetPointer, type RequestLog } from '../../../packages/inner-protocol/src/index'
import { getHostRequire } from '../photoshopHost'
import { AssetStore } from './assetStore'
import { utf8ByteLength } from './utf8'

type TextFile = {
  read: () => Promise<string>
  write: (data: string) => Promise<void>
  delete?: () => Promise<unknown>
}

type DataFolder = {
  getEntry: (name: string) => Promise<TextFile>
  createFile: (name: string, options?: { overwrite?: boolean }) => Promise<TextFile>
}

function getLocalFileSystem() {
  const hostRequire = getHostRequire()
  if (!hostRequire) throw new Error('Photoshop UXP runtime is unavailable.')
  return hostRequire('uxp').storage?.localFileSystem as {
    getDataFolder?: () => Promise<DataFolder>
    getFileForSaving?: (name: string, options?: Record<string, unknown>) => Promise<TextFile | null>
  } | undefined
}

async function readJsonFile<T>(name: string, fallback: T): Promise<T> {
  const fileSystem = getLocalFileSystem()
  if (!fileSystem?.getDataFolder) return fallback
  try {
    const file = await (await fileSystem.getDataFolder()).getEntry(name)
    return JSON.parse(await file.read()) as T
  } catch {
    return fallback
  }
}

async function writeJsonFile(name: string, value: unknown) {
  const fileSystem = getLocalFileSystem()
  if (!fileSystem?.getDataFolder) throw new Error('本地存储不可用')
  const file = await (await fileSystem.getDataFolder()).createFile(name, { overwrite: true })
  await file.write(JSON.stringify(value))
}

async function deleteDataFile(name: string) {
  const fileSystem = getLocalFileSystem()
  if (!fileSystem?.getDataFolder) throw new Error('本地存储不可用')
  let file: TextFile
  try {
    file = await (await fileSystem.getDataFolder()).getEntry(name)
  } catch {
    return
  }
  if (typeof file.delete !== 'function') throw new Error('本地存储不支持删除文件')
  await file.delete()
}

const HISTORY_FILE = 'mugen-inner-history.v1.json'
const MAX_HISTORY_ITEMS = 100
const MAX_HISTORY_RESPONSE_BYTES = 700 * 1024
const HISTORY_ASSET_PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,%3Csvg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240"%3E%3Crect width="320" height="240" fill="%231a2028"/%3E%3Cpath d="M80 164l54-58 38 38 28-28 40 48H80z" fill="%238b5cf6" opacity=".45"/%3E%3C/svg%3E'

function serializedBytes(value: unknown) {
  const serialized = JSON.stringify(value)
  return utf8ByteLength(serialized)
}

const historySources = new Set<HostAssetPointer['source']>(['visible', 'selection', 'layer', 'upload', 'clipboard', 'generated'])

function sanitizedHistoryPointer(value: unknown): HostAssetPointer | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const asset = value as Record<string, unknown>
  if (
    typeof asset.assetId !== 'string' || !asset.assetId || asset.assetId.length > 256 ||
    typeof asset.label !== 'string' ||
    !historySources.has(asset.source as HostAssetPointer['source']) ||
    !Number.isFinite(asset.width) || Number(asset.width) <= 0 ||
    !Number.isFinite(asset.height) || Number(asset.height) <= 0
  ) return undefined
  const rawBounds = asset.sourceBounds && typeof asset.sourceBounds === 'object' && !Array.isArray(asset.sourceBounds)
    ? asset.sourceBounds as Record<string, unknown>
    : undefined
  const bounds = rawBounds && Number.isFinite(rawBounds.left) && Number.isFinite(rawBounds.top)
    ? {
        left: Number(rawBounds.left),
        top: Number(rawBounds.top),
        ...(Number.isFinite(rawBounds.width) ? { width: Number(rawBounds.width) } : {}),
        ...(Number.isFinite(rawBounds.height) ? { height: Number(rawBounds.height) } : {}),
        ...(Number.isFinite(rawBounds.right) ? { right: Number(rawBounds.right) } : {}),
        ...(Number.isFinite(rawBounds.bottom) ? { bottom: Number(rawBounds.bottom) } : {})
      }
    : undefined
  return {
    assetId: asset.assetId,
    label: asset.label.slice(0, 256),
    source: asset.source as HostAssetPointer['source'],
    width: Math.max(1, Math.round(Number(asset.width))),
    height: Math.max(1, Math.round(Number(asset.height))),
    ...(typeof asset.mimeType === 'string' && asset.mimeType.startsWith('image/') ? { mimeType: asset.mimeType.slice(0, 128) } : {}),
    ...(asset.status === 'missing' ? { status: 'missing' as const } : {}),
    ...(bounds ? { sourceBounds: bounds } : {}),
    ...(typeof asset.documentId === 'string' ? { documentId: asset.documentId.slice(0, 256) } : {})
  }
}

function sanitizedHistoryEntry(entry: HistoryUpsertEntry): HistoryUpsertEntry {
  const record = entry as Record<string, unknown>
  const rawSnapshot = record.snapshot && typeof record.snapshot === 'object'
    ? record.snapshot as Record<string, unknown>
    : undefined
  const snapshot = rawSnapshot
    ? {
        configId: typeof rawSnapshot.configId === 'string' ? rawSnapshot.configId.slice(0, 256) : '',
        prompt: typeof rawSnapshot.prompt === 'string' ? rawSnapshot.prompt.slice(0, 100_000) : '',
        references: Array.isArray(rawSnapshot.references)
          ? rawSnapshot.references.map(sanitizedHistoryPointer).filter((asset): asset is HostAssetPointer => Boolean(asset)).slice(0, 16)
          : [],
        size: typeof rawSnapshot.size === 'string' ? rawSnapshot.size.slice(0, 128) : '',
        quality: typeof rawSnapshot.quality === 'string' ? rawSnapshot.quality.slice(0, 128) : '',
        count: Number.isInteger(rawSnapshot.count) ? Number(rawSnapshot.count) : 1,
        ratio: typeof rawSnapshot.ratio === 'string' ? rawSnapshot.ratio.slice(0, 128) : '',
        submittedAt: typeof rawSnapshot.submittedAt === 'string' ? rawSnapshot.submittedAt.slice(0, 64) : new Date().toISOString()
      }
    : undefined
  const safeSnapshot = snapshot && isGenerationSnapshot(snapshot) ? snapshot : undefined
  const logs = Array.isArray(record.logs)
    ? record.logs.filter((log): log is Record<string, unknown> => Boolean(log && typeof log === 'object')).slice(0, 50).map((log): RequestLog => ({
        id: typeof log.id === 'string' ? log.id.slice(0, 256) : `log-${Date.now()}`,
        method: typeof log.method === 'string' ? log.method.slice(0, 16) : '',
        url: typeof log.url === 'string' ? log.url.slice(0, 2048) : '',
        status: Number(log.status) || 0,
        durationMs: Math.max(0, Number(log.durationMs) || 0),
        createdAt: typeof log.createdAt === 'string' ? log.createdAt.slice(0, 64) : new Date().toISOString()
      }))
    : undefined
  const status = ['completed', 'failed', 'cancelled'].includes(String(record.status))
    ? String(record.status) as 'completed' | 'failed' | 'cancelled'
    : undefined
  const updatedTimestamp = Date.parse(entry.updatedAt)
  return {
    id: entry.id.slice(0, 256),
    updatedAt: Number.isFinite(updatedTimestamp) ? new Date(updatedTimestamp).toISOString() : new Date().toISOString(),
    prompt: typeof entry.prompt === 'string' ? entry.prompt.slice(0, 100_000) : '',
    assets: Array.isArray(entry.assets) ? entry.assets.map(sanitizedHistoryPointer).filter((asset): asset is HostAssetPointer => Boolean(asset)).slice(0, 16) : [],
    ...(Array.isArray(entry.references) ? { references: entry.references.map(sanitizedHistoryPointer).filter((asset): asset is HostAssetPointer => Boolean(asset)).slice(0, 16) } : {}),
    ...(safeSnapshot ? { snapshot: safeSnapshot } : {}),
    ...(logs ? { logs } : {}),
    ...(status ? { status } : {}),
    ...(Number.isFinite(Number(record.elapsedSeconds)) ? { elapsedSeconds: Math.max(0, Number(record.elapsedSeconds)) } : {}),
    ...(typeof record.error === 'string' ? { error: record.error.slice(0, 2048) } : {})
  }
}

function persistentAssetIds(entries: HistoryUpsertEntry[]) {
  const ids = new Set<string>()
  for (const entry of entries) {
    for (const asset of entry.assets) ids.add(asset.assetId)
    for (const asset of entry.references ?? []) if (asset.source === 'generated') ids.add(asset.assetId)
    for (const asset of entry.snapshot?.references ?? []) if (asset.source === 'generated') ids.add(asset.assetId)
  }
  return ids
}

function historyAssetIds(entry: HistoryUpsertEntry) {
  return new Set([
    ...entry.assets.map((asset) => asset.assetId),
    ...(entry.references ?? []).map((asset) => asset.assetId),
    ...(entry.snapshot?.references ?? []).map((asset) => asset.assetId)
  ])
}

function sessionHistoryAssetIds(entry: HistoryUpsertEntry) {
  return new Set([
    ...(entry.references ?? []).filter((asset) => asset.source !== 'generated').map((asset) => asset.assetId),
    ...(entry.snapshot?.references ?? []).filter((asset) => asset.source !== 'generated').map((asset) => asset.assetId)
  ])
}

function historyOwner(entryId: string) {
  return `history:${entryId}`
}

function compactHistoryEntry(entry: HistoryEntry) {
  const candidate: HistoryEntry = {
    ...entry,
    assets: entry.assets.map((asset) => ({ ...asset })),
    ...(entry.references ? { references: entry.references.map((asset) => ({ ...asset })) } : {})
  }
  const previews = [...candidate.assets, ...(candidate.references ?? [])]
    .sort((left, right) => (right.previewUrl?.length ?? 0) - (left.previewUrl?.length ?? 0))
  for (const asset of previews) {
    if (serializedBytes(candidate) <= MAX_HISTORY_RESPONSE_BYTES) break
    asset.previewUrl = HISTORY_ASSET_PLACEHOLDER
    asset.thumbnailUrl = HISTORY_ASSET_PLACEHOLDER
  }
  return candidate
}

export class HistoryStore {
  private entries?: HistoryUpsertEntry[]
  private readonly assets: AssetStore
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(assets: AssetStore) {
    this.assets = assets
  }

  private async load() {
    if (!this.entries) {
      const stored = await readJsonFile<unknown>(HISTORY_FILE, [])
      this.entries = Array.isArray(stored)
        ? stored
            .filter((item): item is HistoryUpsertEntry => Boolean(item && typeof item === 'object' && typeof (item as HistoryUpsertEntry).id === 'string'))
            .map(sanitizedHistoryEntry)
            .slice(0, MAX_HISTORY_ITEMS)
        : []
      for (const entry of this.entries) {
        await this.assets.retainAvailable([...sessionHistoryAssetIds(entry)], historyOwner(entry.id))
      }
    }
    return this.entries
  }

  async list(cursor?: string, limit = 30) {
    const entries = await this.load()
    const start = cursor ? Math.max(0, Number.parseInt(cursor, 10) || 0) : 0
    const cleanLimit = Math.min(50, Math.max(1, Math.round(limit)))
    const items: HistoryEntry[] = []
    for (const entry of entries.slice(start, start + cleanLimit)) {
      const candidate = compactHistoryEntry(await this.hydrate(entry))
      if (items.length > 0 && serializedBytes([...items, candidate]) > MAX_HISTORY_RESPONSE_BYTES) break
      items.push(candidate)
    }
    const next = start + items.length
    return { items, ...(next < entries.length ? { nextCursor: String(next) } : {}) }
  }

  upsert(entry: HistoryUpsertEntry) {
    return this.mutate(async () => {
      const entries = await this.load()
      const clean = sanitizedHistoryEntry(entry)
      const next = [clean, ...entries.filter((item) => item.id !== clean.id)].slice(0, MAX_HISTORY_ITEMS)
      const previous = entries.find((item) => item.id === clean.id)
      const previousIds = previous ? historyAssetIds(previous) : new Set<string>()
      const cleanIds = historyAssetIds(clean)
      const addedIds = [...cleanIds].filter((assetId) => !previousIds.has(assetId))
      const removedIds = [...previousIds].filter((assetId) => !cleanIds.has(assetId))
      const owner = historyOwner(clean.id)
      await this.assets.retain(addedIds, owner)
      try {
        await this.assets.persist([...persistentAssetIds(next)])
        await writeJsonFile(HISTORY_FILE, next)
      } catch (error) {
        for (const assetId of addedIds) this.assets.releaseAssetOwner(assetId, owner, true)
        throw error
      }
      this.entries = next
      for (const assetId of removedIds) this.assets.releaseAssetOwner(assetId, owner, true)
      for (const evicted of entries.filter((item) => !next.some((candidate) => candidate.id === item.id))) {
        this.assets.releaseOwner(historyOwner(evicted.id), true)
      }
      this.assets.releaseOwner(`task:${clean.id}`, true)
      const retained = persistentAssetIds(next)
      const removed = [...persistentAssetIds(entries)].filter((assetId) => !retained.has(assetId))
      await this.assets.removePersistent(removed).catch(() => undefined)
      return { entry: compactHistoryEntry(await this.hydrate(clean)) }
    })
  }

  clear() {
    return this.mutate(async () => {
      const entries = await this.load()
      await writeJsonFile(HISTORY_FILE, [])
      this.entries = []
      await this.assets.removePersistent([...persistentAssetIds(entries)])
      for (const entry of entries) this.assets.releaseOwner(historyOwner(entry.id), true)
      return { cleared: true }
    })
  }

  clearAllLocalData() {
    return this.mutate(async () => {
      await this.assets.clearPersistent()
      await deleteDataFile(HISTORY_FILE)
      this.entries = []
      return { cleared: true }
    })
  }

  private mutate<T>(operation: () => Promise<T>) {
    const run = this.mutationQueue.then(operation, operation)
    this.mutationQueue = run.then(() => undefined, () => undefined)
    return run
  }

  private async hydrate(entry: HistoryUpsertEntry): Promise<HistoryEntry> {
    const { assets: _assets, references: _references, ...metadata } = entry
    const referencePointers = entry.references ?? entry.snapshot?.references
    const [assets, references] = await Promise.all([
      Promise.all(entry.assets.map((asset) => this.assets.resolvePointer(asset))),
      referencePointers ? Promise.all(referencePointers.map((asset) => this.assets.resolvePointer(asset))) : undefined
    ])
    return {
      ...metadata,
      assets,
      ...(references ? { references } : {})
    }
  }
}

type DiagnosticRecord = {
  id: string
  timestamp: string
  category: string
  operation: string
  phase: 'start' | 'success' | 'error' | 'notice'
  durationMs?: number
  details?: Record<string, unknown>
}

const DIAGNOSTICS_FILE = 'mugen-inner-diagnostics.v1.json'
const MAX_DIAGNOSTIC_RECORDS = 500
const DIAGNOSTIC_RETENTION_MS = 24 * 60 * 60 * 1000
const secretPattern = /(?:api[-_]?key|authorization|cookie|credential|password|secret|token|prompt|workflow|image|rgba|base64|body|content)/i
const dataUrlPattern = /^data:/i
const windowsPathPattern = /(?:[a-z]:\\|\\\\)[^\s"']+/gi
const posixPathPattern = /\/(?:Users|home|tmp|var|private|Volumes)\/[^\s"']+/g
const bearerPattern = /\bBearer\s+[^\s,;]+/gi
const apiKeyPattern = /\b(?:sk|key)-[A-Za-z0-9_-]{8,}\b/g

function sanitizeText(input: string) {
  let value = input.replace(bearerPattern, 'Bearer [REDACTED]').replace(apiKeyPattern, '[REDACTED]')
  value = value.replace(windowsPathPattern, '[LOCAL_PATH]').replace(posixPathPattern, '[LOCAL_PATH]')
  value = value.replace(/https?:\/\/[^\s"']+/gi, (candidate) => {
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
  return value.length > 2048 ? `${value.slice(0, 2048)}…` : value
}

function sanitize(value: unknown, key = ''): unknown {
  if (secretPattern.test(key)) return '[REDACTED]'
  if (typeof value === 'string') {
    if (dataUrlPattern.test(value)) return `[IMAGE_DATA:${value.length}]`
    return sanitizeText(value)
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [childKey, sanitize(childValue, childKey)]))
  }
  return value
}

function isDiagnosticRecord(value: unknown): value is DiagnosticRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<DiagnosticRecord>
  return (
    typeof record.id === 'string'
    && typeof record.timestamp === 'string'
    && Number.isFinite(Date.parse(record.timestamp))
    && typeof record.category === 'string'
    && typeof record.operation === 'string'
    && ['start', 'success', 'error', 'notice'].includes(String(record.phase))
  )
}

function retainedDiagnostics(records: DiagnosticRecord[], now = Date.now()) {
  const cutoff = now - DIAGNOSTIC_RETENTION_MS
  return records
    .filter((record) => Date.parse(record.timestamp) >= cutoff)
    .slice(-MAX_DIAGNOSTIC_RECORDS)
}

export class DiagnosticStore {
  private records?: DiagnosticRecord[]
  private mutationQueue: Promise<void> = Promise.resolve()

  record(record: Omit<DiagnosticRecord, 'id' | 'timestamp'>) {
    const candidate: DiagnosticRecord = {
      ...record,
      id: `diag-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      ...(record.details ? { details: sanitize(record.details) as Record<string, unknown> } : {})
    }
    const task = this.mutate(async () => {
      const records = await this.load()
      this.records = retainedDiagnostics([...records, candidate])
      await writeJsonFile(DIAGNOSTICS_FILE, { schemaVersion: 1, records: this.records })
    })
    void task.catch(() => undefined)
    return task
  }

  async export() {
    await this.flush()
    const records = retainedDiagnostics(await this.load())
    const fileSystem = getLocalFileSystem()
    if (!fileSystem?.getFileForSaving) throw new Error('文件保存器不可用')
    const fileName = `mugen-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`
    const file = await fileSystem.getFileForSaving(fileName, { types: ['jsonl'] })
    if (!file) return { saved: false }
    const jsonl = records.map((record) => JSON.stringify(sanitize(record))).join('\n')
    await file.write(jsonl ? `${jsonl}\n` : '')
    return { saved: true, fileName }
  }

  clear() {
    return this.mutate(async () => {
      this.records = []
      await deleteDataFile(DIAGNOSTICS_FILE)
    })
  }

  flush() {
    return this.mutationQueue
  }

  private async load() {
    if (!this.records) {
      const stored = await readJsonFile<{ schemaVersion?: unknown; records?: unknown }>(DIAGNOSTICS_FILE, {})
      this.records = retainedDiagnostics(
        stored.schemaVersion === 1 && Array.isArray(stored.records)
          ? stored.records.filter(isDiagnosticRecord).map((record) => sanitize(record) as DiagnosticRecord)
          : []
      )
    }
    return this.records
  }

  private mutate(operation: () => Promise<void>) {
    const run = this.mutationQueue.then(operation, operation)
    this.mutationQueue = run.then(() => undefined, () => undefined)
    return run
  }
}

export const PROTOCOL_VERSION = 1 as const
export const INNER_HOST_PROTOCOL = 'inner-host/v1' as const
// These wire identifiers stay stable so a Mugen host can load an already deployed v1 WebUI.
export const CLIENT_READY_SIGNAL = 'lightyear-banana:client-ready:v1' as const
export const LOCATION_BRIDGE_QUERY = '__lightyear_bridge' as const
export const MAX_BRIDGE_MESSAGE_BYTES = 1024 * 1024

export type ThemeMode = 'dark' | 'light' | 'system'
export type HostTheme = 'dark' | 'light'
export type ReferenceSource = 'visible' | 'selection' | 'layer' | 'upload' | 'clipboard' | 'generated'
export type AssetStatus = 'available' | 'missing'
export type TaskPhase = 'waiting' | 'uploading' | 'requesting' | 'polling' | 'downloading' | 'retrying' | 'completed' | 'failed' | 'cancelled'
export type ProviderId = 'openai' | 'iMini' | 'gemini' | 'apimart' | 'seedream' | 'qwen' | 'kling' | 'flux' | 'comfyui' | 'custom-openai' | 'codex-image-server'

export type Bounds = {
  left: number
  top: number
  width?: number
  height?: number
  right?: number
  bottom?: number
}

export type HostAssetRef = {
  assetId: string
  label: string
  source: ReferenceSource
  mimeType?: string
  width: number
  height: number
  previewUrl: string
  /** Compatibility alias used by the initial WebUI components. */
  thumbnailUrl?: string
  status?: AssetStatus
  sourceBounds?: Bounds
  documentId?: string
  expiresAt?: string
}

export type HostAssetPointer = Pick<HostAssetRef, 'assetId' | 'label' | 'source' | 'width' | 'height'> &
  Partial<Pick<HostAssetRef, 'mimeType' | 'status' | 'sourceBounds' | 'documentId' | 'expiresAt'>>

export type HostContext = {
  ready: boolean
  hostVersion: string
  photoshopVersion: string
  uxpVersion?: string
  platform: 'win32' | 'darwin' | 'mock'
  theme: HostTheme
  document?: { id: string; name: string; width: number; height: number }
  capabilities: string[]
}

export type HostReady = {
  protocolVersion: number
  hostNonce: string
  hostVersion?: string
}

export type Handshake = {
  protocolVersion: number
  webVersion: string
  clientNonce: string
  /** Added by WebViewHostClient after host.ready. Callers do not need to set it. */
  hostNonce?: string
}

export type HandshakeResult = {
  sessionId: string
  protocolVersion: number
  clientNonce: string
  hostNonce: string
  context: HostContext
}

export type ProviderCapability = {
  id: ProviderId
  name: string
  models: string[]
  referenceLimit: number
  sizes: string[]
  qualities: string[]
  counts: number[]
  ratios: string[]
  supportsCustomSize: boolean
  customSize?: import('./providerCapabilityData').SerializableCustomSizeConstraint
}

export type ModelConfig = {
  id: string
  name: string
  provider: ProviderId
  model: string
  models?: string[]
  baseUrl: string
  enabled: boolean
  hasCredential: boolean
  credentialState?: 'missing' | 'stored'
  customFormat?: 'openai-images' | 'openai-chat' | 'gemini'
  workflow?: string
  comfyUi?: {
    workflow: string
    workflowNodes: Array<Record<string, unknown>>
    timeoutMs: number
    pollIntervalMs: number
  }
}

export type PublicModelConfig = Omit<ModelConfig, 'hasCredential'> & {
  credentialState: 'missing' | 'stored'
  hasCredential?: boolean
}

export type SettingsSnapshot = {
  activeConfigId?: string
  configs: PublicModelConfig[]
}

export type GenerationSnapshot = {
  configId: string
  prompt: string
  references: HostAssetPointer[]
  size: string
  quality: string
  count: number
  ratio: string
  submittedAt: string
}

export type TaskEvent = {
  taskId: string
  phase: TaskPhase
  elapsedSeconds: number
  message?: string
  attempt?: number
}

export type GenerationResult = { taskId: string; assets: HostAssetRef[]; logs: RequestLog[] }
export type RequestLog = { id: string; method: string; url: string; status: number; durationMs: number; createdAt: string }
export type PlacementTarget =
  | { type: 'default' | 'original-size' | 'full-canvas' | 'current-selection' }
  | { type: 'reference-selection'; referenceAssetId: string; bounds: Bounds }
export type PlacementResult = { layerName: string; target: PlacementTarget }
export type DiagnosticExport = { saved: boolean; fileName?: string }
export type LocalDataCategory = 'credentials' | 'settings' | 'history' | 'assets' | 'diagnostics'
export type LocalDataClearResult = { cleared: boolean; deleted: LocalDataCategory[] }

export type HistoryEntry = {
  id: string
  updatedAt: string
  prompt: string
  assets: HostAssetRef[]
  references?: HostAssetRef[]
  snapshot?: GenerationSnapshot
  logs?: RequestLog[]
  status?: 'completed' | 'failed' | 'cancelled'
  elapsedSeconds?: number
  error?: string
  [key: string]: unknown
}

export type HistoryUpsertEntry = {
  id: string
  updatedAt: string
  prompt: string
  assets: HostAssetPointer[]
  references?: HostAssetPointer[]
  snapshot?: GenerationSnapshot
  logs?: RequestLog[]
  status?: 'completed' | 'failed' | 'cancelled'
  elapsedSeconds?: number
  error?: string
  [key: string]: unknown
}

export type BridgeKind = 'request' | 'response' | 'event'
export type BridgeError = {
  code: string
  message: string
  recoverable: boolean
  details?: Record<string, string | number | boolean | null>
}

export type BridgeEnvelope<T = unknown> = {
  protocol: typeof INNER_HOST_PROTOCOL
  kind: BridgeKind
  messageId: string
  sessionId: string
  command: string
  timestamp: string
  payload?: T
  error?: BridgeError
}

export interface HostCommandMap {
  'host.handshake': { payload: Handshake; result: HandshakeResult }
  'host.getContext': { payload: undefined; result: HostContext }
  'host.openReleasePage': { payload: undefined; result: { opened: boolean } }
  'settings.get': { payload: undefined; result: SettingsSnapshot }
  'settings.save': { payload: SettingsSnapshot; result: SettingsSnapshot }
  'history.list': { payload: { cursor?: string; limit?: number }; result: { items: HistoryEntry[]; nextCursor?: string } }
  'history.upsert': { payload: { entry: HistoryUpsertEntry }; result: { entry: HistoryEntry } }
  'history.clear': { payload: undefined; result: { cleared: boolean } }
  'credential.set': { payload: { configId: string; apiKey: string }; result: { configId: string; credentialState: 'stored' } }
  'credential.remove': { payload: { configId: string }; result: { configId: string; credentialState: 'missing' } }
  'canvas.captureVisible': { payload: undefined; result: HostAssetRef | null }
  'canvas.captureSelection': { payload: undefined; result: HostAssetRef | null }
  'canvas.captureLayer': { payload: undefined; result: HostAssetRef | null }
  'canvas.readSize': { payload: undefined; result: { width: number; height: number } }
  'reference.pickFile': { payload: undefined; result: HostAssetRef | null }
  'reference.readClipboard': { payload: undefined; result: HostAssetRef | null }
  'generation.start': { payload: GenerationSnapshot; result: { taskId: string } }
  'generation.cancel': { payload: { taskId: string }; result: { taskId?: string; cancelled?: boolean } | undefined }
  'generation.testConfig': { payload: { configId: string }; result: { ok: boolean; message: string } }
  'canvas.placeAsset': { payload: { assetId: string; target: PlacementTarget }; result: PlacementResult }
  'asset.save': { payload: { assetId: string }; result: { saved: boolean; fileName?: string } }
  'asset.retain': { payload: { assetId: string }; result: HostAssetRef }
  'asset.release': { payload: { assetId: string }; result: { assetId: string; released: boolean } }
  'diagnostics.export': { payload: undefined; result: DiagnosticExport }
  'storage.clearAll': { payload: undefined; result: LocalDataClearResult }
}

export type HostCommand = keyof HostCommandMap
export type HostCommandPayload<TCommand extends HostCommand> = HostCommandMap[TCommand]['payload']
export type HostCommandResult<TCommand extends HostCommand> = HostCommandMap[TCommand]['result']

export interface HostEventMap {
  'host.ready': HostReady
  'host.contextChanged': HostContext
  'generation.progress': TaskEvent
  'generation.completed': GenerationResult
  'generation.failed': { taskId: string; error: BridgeError }
  'asset.invalidated': { assetId: string; reason?: string }
  'diagnostics.notice': { level: 'info' | 'warning' | 'error'; message: string; code?: string }
}

export type HostEventName = keyof HostEventMap
export type HostEventPayload<TEvent extends HostEventName> = HostEventMap[TEvent]

/** Compatibility event shape consumed by the current workspace store. */
export type HostEvent =
  | { type: 'contextChanged'; context: HostContext }
  | { type: 'taskProgress'; event: TaskEvent }
  | { type: 'generationCompleted'; result: GenerationResult }
  | { type: 'generationFailed'; taskId: string; error: BridgeError }
  | { type: 'assetInvalidated'; assetId: string; reason?: string }
  | { type: 'diagnosticsNotice'; level: 'info' | 'warning' | 'error'; message: string; code?: string }

export type HostRequestOptions = { signal?: AbortSignal; timeoutMs?: number }

export interface HostClient {
  readonly mode: 'webview' | 'mock' | 'unavailable'
  handshake(payload: Handshake): Promise<HandshakeResult>
  invoke<TCommand extends HostCommand>(command: TCommand, payload: HostCommandPayload<TCommand>, options?: HostRequestOptions): Promise<HostCommandResult<TCommand>>
  on<TEvent extends HostEventName>(event: TEvent, listener: (payload: HostEventPayload<TEvent>) => void): () => void
  getContext(): Promise<HostContext>
  captureReference(source: Exclude<ReferenceSource, 'generated'>): Promise<HostAssetRef | null>
  startGeneration(snapshot: GenerationSnapshot): Promise<{ taskId: string }>
  cancelGeneration(taskId: string): Promise<void>
  placeAsset(assetId: string, target: PlacementTarget): Promise<PlacementResult>
  saveAsset(assetId: string): Promise<{ saved: boolean; fileName?: string }>
  getConfigs(): Promise<ModelConfig[]>
  saveConfig(config: ModelConfig, apiKey?: string): Promise<ModelConfig>
  deleteConfig(configId: string): Promise<void>
  testConfig(config: ModelConfig, apiKey?: string): Promise<{ ok: boolean; message: string }>
  clearHistory(): Promise<void>
  exportDiagnostics(): Promise<DiagnosticExport>
  clearLocalData(): Promise<LocalDataClearResult>
  onEvent(listener: (event: HostEvent) => void): () => void
}

export class HostClientError extends Error {
  readonly code: string
  readonly recoverable: boolean
  readonly details?: BridgeError['details']

  constructor(error: BridgeError) {
    super(error.message)
    this.name = 'HostClientError'
    this.code = error.code
    this.recoverable = error.recoverable
    this.details = error.details
  }
}

export class BridgeValidationError extends Error {
  readonly code: 'INVALID_MESSAGE' | 'MESSAGE_TOO_LARGE' | 'UNSUPPORTED_PROTOCOL' | 'INVALID_PAYLOAD'

  constructor(code: BridgeValidationError['code'], message: string) {
    super(message)
    this.name = 'BridgeValidationError'
    this.code = code
  }
}

const taskPhases = new Set<TaskPhase>(['waiting', 'uploading', 'requesting', 'polling', 'downloading', 'retrying', 'completed', 'failed', 'cancelled'])
const referenceSources = new Set<ReferenceSource>(['visible', 'selection', 'layer', 'upload', 'clipboard', 'generated'])
const assetStatuses = new Set<AssetStatus>(['available', 'missing'])
const platforms = new Set<HostContext['platform']>(['win32', 'darwin', 'mock'])
const hostThemes = new Set<HostTheme>(['dark', 'light'])
const providerIds = new Set<ProviderId>(['openai', 'iMini', 'gemini', 'apimart', 'seedream', 'qwen', 'kling', 'flux', 'comfyui', 'custom-openai', 'codex-image-server'])
const bridgeKinds = new Set<BridgeKind>(['request', 'response', 'event'])
const hostCommands = new Set<string>([
  'host.handshake', 'host.getContext', 'host.openReleasePage', 'settings.get', 'settings.save',
  'history.list', 'history.upsert', 'history.clear', 'credential.set', 'credential.remove',
  'canvas.captureVisible', 'canvas.captureSelection', 'canvas.captureLayer', 'canvas.readSize',
  'reference.pickFile', 'reference.readClipboard', 'generation.start', 'generation.cancel',
  'generation.testConfig', 'canvas.placeAsset', 'asset.save', 'asset.retain', 'asset.release', 'diagnostics.export',
  'storage.clearAll'
])
const hostEvents = new Set<string>([
  'host.ready', 'host.contextChanged', 'generation.progress', 'generation.completed',
  'generation.failed', 'asset.invalidated', 'diagnostics.notice'
])

export const HOST_COMMANDS = Object.freeze([...hostCommands]) as readonly HostCommand[]
export const HOST_EVENTS = Object.freeze([...hostEvents]) as readonly HostEventName[]

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyText(value: unknown, maxLength = 512): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isBridgeError(value: unknown): value is BridgeError {
  if (!isRecord(value) || !nonEmptyText(value.code, 128) || !nonEmptyText(value.message, 2048) || typeof value.recoverable !== 'boolean') return false
  if (value.details === undefined) return true
  if (!isRecord(value.details)) return false
  return Object.values(value.details).every(item => item === null || typeof item === 'string' || typeof item === 'boolean' || finiteNumber(item))
}

export function serializedMessageSize(value: unknown): number {
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new BridgeValidationError('INVALID_MESSAGE', '消息无法序列化')
  }
  if (serialized === undefined) throw new BridgeValidationError('INVALID_MESSAGE', '消息无法序列化')
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(serialized).byteLength
  return unescape(encodeURIComponent(serialized)).length
}

export function assertMessageSize(value: unknown): void {
  if (serializedMessageSize(value) > MAX_BRIDGE_MESSAGE_BYTES) {
    throw new BridgeValidationError('MESSAGE_TOO_LARGE', '消息超过 1 MB 限制')
  }
}

export function createLocationBridgeUrl(currentUrl: string, message: unknown): string {
  assertMessageSize(message)
  const serialized = JSON.stringify(message)
  if (serialized === undefined) throw new BridgeValidationError('INVALID_MESSAGE', '消息无法序列化')
  const url = new URL(currentUrl)
  const fragment = url.hash.replace(/^#/, '')
  const queryIndex = fragment.indexOf('?')
  const path = queryIndex >= 0 ? fragment.slice(0, queryIndex) : fragment
  const query = new URLSearchParams(queryIndex >= 0 ? fragment.slice(queryIndex + 1) : '')
  query.set(LOCATION_BRIDGE_QUERY, serialized)
  url.hash = `${path || '/'}?${query.toString()}`
  return url.href
}

export function readLocationBridgeMessage(hash: string): string | undefined {
  const fragment = hash.replace(/^#/, '')
  const queryIndex = fragment.indexOf('?')
  if (queryIndex < 0) return undefined
  return new URLSearchParams(fragment.slice(queryIndex + 1)).get(LOCATION_BRIDGE_QUERY) ?? undefined
}

export function parseBridgeEnvelope(value: unknown, expectedKind?: BridgeKind): BridgeEnvelope {
  assertMessageSize(value)
  if (!isRecord(value)) throw new BridgeValidationError('INVALID_MESSAGE', '消息格式无效')
  if (value.protocol !== INNER_HOST_PROTOCOL) throw new BridgeValidationError('UNSUPPORTED_PROTOCOL', '宿主协议不兼容')
  if (!bridgeKinds.has(value.kind as BridgeKind) || (expectedKind && value.kind !== expectedKind)) throw new BridgeValidationError('INVALID_MESSAGE', '消息类型无效')
  if (!nonEmptyText(value.messageId, 256) || !nonEmptyText(value.sessionId, 256) || !nonEmptyText(value.command, 256)) {
    throw new BridgeValidationError('INVALID_MESSAGE', '消息标识无效')
  }
  if (!nonEmptyText(value.timestamp, 64) || Number.isNaN(Date.parse(value.timestamp))) throw new BridgeValidationError('INVALID_MESSAGE', '消息时间无效')
  if (value.error !== undefined && !isBridgeError(value.error)) throw new BridgeValidationError('INVALID_MESSAGE', '错误结构无效')
  if (value.kind !== 'response' && value.error !== undefined) throw new BridgeValidationError('INVALID_MESSAGE', '消息错误结构无效')
  if (value.error !== undefined && value.payload !== undefined) throw new BridgeValidationError('INVALID_MESSAGE', '响应结构无效')
  if (value.kind === 'request' && !hostCommands.has(value.command)) throw new BridgeValidationError('INVALID_MESSAGE', '宿主命令无效')
  if (value.kind === 'response' && !hostCommands.has(value.command)) throw new BridgeValidationError('INVALID_MESSAGE', '响应命令无效')
  if (value.kind === 'event' && !hostEvents.has(value.command)) throw new BridgeValidationError('INVALID_MESSAGE', '宿主事件无效')
  return value as BridgeEnvelope
}

export function isBridgeEnvelope(value: unknown, expectedKind?: BridgeKind): value is BridgeEnvelope {
  try {
    parseBridgeEnvelope(value, expectedKind)
    return true
  } catch {
    return false
  }
}

export function createRequestEnvelope<TCommand extends HostCommand>(options: {
  command: TCommand
  messageId?: string
  sessionId: string
  payload: HostCommandPayload<TCommand>
}): BridgeEnvelope<HostCommandPayload<TCommand>> {
  const envelope: BridgeEnvelope<HostCommandPayload<TCommand>> = {
    protocol: INNER_HOST_PROTOCOL,
    kind: 'request',
    messageId: options.messageId ?? createMessageId(),
    sessionId: options.sessionId,
    command: options.command,
    timestamp: new Date().toISOString(),
    ...(options.payload === undefined ? {} : { payload: options.payload })
  }
  validateCommandPayload(options.command, options.payload)
  assertMessageSize(envelope)
  return envelope
}

function isHostAssetRef(value: unknown): value is HostAssetRef {
  if (!isRecord(value) || !nonEmptyText(value.assetId) || !nonEmptyText(value.label) || !referenceSources.has(value.source as ReferenceSource) || !finiteNumber(value.width) || value.width <= 0 || !finiteNumber(value.height) || value.height <= 0) return false
  const preview = value.previewUrl ?? value.thumbnailUrl
  if (!nonEmptyText(preview, MAX_BRIDGE_MESSAGE_BYTES)) return false
  if (value.mimeType !== undefined && typeof value.mimeType !== 'string') return false
  if (value.status !== undefined && !assetStatuses.has(value.status as AssetStatus)) return false
  if (value.sourceBounds !== undefined && !isBounds(value.sourceBounds)) return false
  return optionalString(value.documentId) && optionalString(value.expiresAt)
}

export function isHostAssetPointer(value: unknown): value is HostAssetPointer {
  if (!isRecord(value) || value.previewUrl !== undefined || value.thumbnailUrl !== undefined) return false
  if (!nonEmptyText(value.assetId) || !nonEmptyText(value.label) || !referenceSources.has(value.source as ReferenceSource) || !finiteNumber(value.width) || value.width <= 0 || !finiteNumber(value.height) || value.height <= 0) return false
  if (value.mimeType !== undefined && typeof value.mimeType !== 'string') return false
  if (value.status !== undefined && !assetStatuses.has(value.status as AssetStatus)) return false
  if (value.sourceBounds !== undefined && !isBounds(value.sourceBounds)) return false
  return optionalString(value.documentId) && optionalString(value.expiresAt)
}

export function toHostAssetPointer(asset: HostAssetRef | HostAssetPointer): HostAssetPointer {
  return {
    assetId: asset.assetId,
    label: asset.label,
    source: asset.source,
    width: asset.width,
    height: asset.height,
    ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
    ...(asset.status ? { status: asset.status } : {}),
    ...(asset.sourceBounds ? { sourceBounds: { ...asset.sourceBounds } } : {}),
    ...(asset.documentId ? { documentId: asset.documentId } : {}),
    ...(asset.expiresAt ? { expiresAt: asset.expiresAt } : {})
  }
}

function isHostContext(value: unknown): value is HostContext {
  if (!isRecord(value) || typeof value.ready !== 'boolean' || !nonEmptyText(value.hostVersion) || typeof value.photoshopVersion !== 'string' || !platforms.has(value.platform as HostContext['platform']) || !hostThemes.has(value.theme as HostTheme)) return false
  if (value.uxpVersion !== undefined && typeof value.uxpVersion !== 'string') return false
  if (!Array.isArray(value.capabilities) || !value.capabilities.every(item => typeof item === 'string')) return false
  if (value.document === undefined) return true
  return isRecord(value.document) && nonEmptyText(value.document.id) && nonEmptyText(value.document.name) && finiteNumber(value.document.width) && value.document.width > 0 && finiteNumber(value.document.height) && value.document.height > 0
}

function isTaskEvent(value: unknown): value is TaskEvent {
  return isRecord(value) && nonEmptyText(value.taskId) && taskPhases.has(value.phase as TaskPhase) && finiteNumber(value.elapsedSeconds)
}

function isGenerationResult(value: unknown): value is GenerationResult {
  return isRecord(value) && nonEmptyText(value.taskId) && Array.isArray(value.assets) && value.assets.every(isHostAssetRef) && Array.isArray(value.logs) && value.logs.every(isRequestLog)
}

function isBounds(value: unknown): value is Bounds {
  if (!isRecord(value) || !finiteNumber(value.left) || !finiteNumber(value.top)) return false
  const size = finiteNumber(value.width) && value.width >= 0 && finiteNumber(value.height) && value.height >= 0
  const edges = finiteNumber(value.right) && finiteNumber(value.bottom)
  return size || edges
}

function isPlacementTarget(value: unknown): value is PlacementTarget {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (['default', 'original-size', 'full-canvas', 'current-selection'].includes(value.type)) return true
  return value.type === 'reference-selection' && nonEmptyText(value.referenceAssetId) && isBounds(value.bounds)
}

function isPublicModelConfig(value: unknown): value is PublicModelConfig {
  if (!isRecord(value) || !nonEmptyText(value.id) || !nonEmptyText(value.name) || !providerIds.has(value.provider as ProviderId) || !nonEmptyText(value.model) || !nonEmptyText(value.baseUrl, 2048) || typeof value.enabled !== 'boolean') return false
  try {
    const url = new URL(value.baseUrl)
    if (!['http:', 'https:'].includes(url.protocol)) return false
  } catch {
    return false
  }
  if (value.hasCredential !== undefined && typeof value.hasCredential !== 'boolean') return false
  if (!['missing', 'stored'].includes(String(value.credentialState))) return false
  if (value.models !== undefined && (!Array.isArray(value.models) || !value.models.every(item => nonEmptyText(item)))) return false
  if (value.customFormat !== undefined && !['openai-images', 'openai-chat', 'gemini'].includes(String(value.customFormat))) return false
  if (value.workflow !== undefined && typeof value.workflow !== 'string') return false
  if (value.comfyUi !== undefined) {
    if (!isRecord(value.comfyUi) || typeof value.comfyUi.workflow !== 'string' || !Array.isArray(value.comfyUi.workflowNodes) || !value.comfyUi.workflowNodes.every(isRecord)) return false
    if (!finiteNumber(value.comfyUi.timeoutMs) || value.comfyUi.timeoutMs < 1 || !finiteNumber(value.comfyUi.pollIntervalMs) || value.comfyUi.pollIntervalMs < 1) return false
  }
  return true
}

function isSettingsSnapshot(value: unknown): value is SettingsSnapshot {
  return isRecord(value) && optionalString(value.activeConfigId) && Array.isArray(value.configs) && value.configs.every(isPublicModelConfig)
}

export function isGenerationSnapshot(value: unknown): value is GenerationSnapshot {
  if (!isRecord(value) || !nonEmptyText(value.configId) || typeof value.prompt !== 'string' || value.prompt.length > 100_000 || !Array.isArray(value.references) || !value.references.every(isHostAssetPointer)) return false
  if (!nonEmptyText(value.size) || typeof value.quality !== 'string' || !nonEmptyText(value.ratio) || !Number.isInteger(value.count) || Number(value.count) < 1 || Number(value.count) > 16) return false
  return nonEmptyText(value.submittedAt, 64) && !Number.isNaN(Date.parse(value.submittedAt))
}

function isRequestLog(value: unknown): value is RequestLog {
  return isRecord(value) && nonEmptyText(value.id) && nonEmptyText(value.method) && typeof value.url === 'string' && finiteNumber(value.status) && finiteNumber(value.durationMs) && nonEmptyText(value.createdAt, 64) && !Number.isNaN(Date.parse(value.createdAt))
}

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!isRecord(value) || !nonEmptyText(value.id) || !nonEmptyText(value.updatedAt, 64) || Number.isNaN(Date.parse(value.updatedAt)) || typeof value.prompt !== 'string' || !Array.isArray(value.assets) || !value.assets.every(isHostAssetRef)) return false
  if (value.references !== undefined && (!Array.isArray(value.references) || !value.references.every(isHostAssetRef))) return false
  if (value.snapshot !== undefined && !isGenerationSnapshot(value.snapshot)) return false
  if (value.logs !== undefined && (!Array.isArray(value.logs) || !value.logs.every(isRequestLog))) return false
  if (value.status !== undefined && !['completed', 'failed', 'cancelled'].includes(String(value.status))) return false
  if (value.elapsedSeconds !== undefined && (!finiteNumber(value.elapsedSeconds) || Number(value.elapsedSeconds) < 0)) return false
  return value.error === undefined || typeof value.error === 'string'
}

function isHistoryUpsertEntry(value: unknown): value is HistoryUpsertEntry {
  if (!isRecord(value) || !nonEmptyText(value.id) || !nonEmptyText(value.updatedAt, 64) || Number.isNaN(Date.parse(value.updatedAt)) || typeof value.prompt !== 'string' || !Array.isArray(value.assets) || !value.assets.every(isHostAssetPointer)) return false
  if (value.references !== undefined && (!Array.isArray(value.references) || !value.references.every(isHostAssetPointer))) return false
  if (value.snapshot !== undefined && !isGenerationSnapshot(value.snapshot)) return false
  if (value.logs !== undefined && (!Array.isArray(value.logs) || !value.logs.every(isRequestLog))) return false
  if (value.status !== undefined && !['completed', 'failed', 'cancelled'].includes(String(value.status))) return false
  if (value.elapsedSeconds !== undefined && (!finiteNumber(value.elapsedSeconds) || Number(value.elapsedSeconds) < 0)) return false
  return value.error === undefined || typeof value.error === 'string'
}

function requireRecord(payload: unknown, label: string): Record<string, unknown> {
  if (!isRecord(payload)) throw new BridgeValidationError('INVALID_PAYLOAD', `${label}参数无效`)
  return payload
}

function requireUndefined(payload: unknown, label: string): void {
  if (payload !== undefined) throw new BridgeValidationError('INVALID_PAYLOAD', `${label}不接受参数`)
}

export function validateCommandPayload<TCommand extends HostCommand>(command: TCommand, payload: unknown): asserts payload is HostCommandPayload<TCommand> {
  switch (command) {
    case 'host.getContext': case 'host.openReleasePage': case 'settings.get': case 'history.clear':
    case 'canvas.captureVisible': case 'canvas.captureSelection': case 'canvas.captureLayer': case 'canvas.readSize':
    case 'reference.pickFile': case 'reference.readClipboard': case 'diagnostics.export': case 'storage.clearAll':
      requireUndefined(payload, command)
      return
    case 'host.handshake': {
      const value = requireRecord(payload, command)
      if (!finiteNumber(value.protocolVersion) || !nonEmptyText(value.webVersion) || !nonEmptyText(value.clientNonce) || !optionalString(value.hostNonce)) throw new BridgeValidationError('INVALID_PAYLOAD', '握手参数无效')
      return
    }
    case 'generation.start': {
      if (!isGenerationSnapshot(payload)) throw new BridgeValidationError('INVALID_PAYLOAD', '生成参数无效')
      return
    }
    case 'settings.save': {
      if (!isSettingsSnapshot(payload)) throw new BridgeValidationError('INVALID_PAYLOAD', '设置参数无效')
      return
    }
    case 'credential.set': {
      const value = requireRecord(payload, command)
      if (!nonEmptyText(value.configId) || !nonEmptyText(value.apiKey, 8192)) throw new BridgeValidationError('INVALID_PAYLOAD', '凭据参数无效')
      return
    }
    case 'credential.remove': case 'asset.save': case 'asset.retain': case 'asset.release': {
      const value = requireRecord(payload, command)
      if (!nonEmptyText(value.configId ?? value.assetId)) throw new BridgeValidationError('INVALID_PAYLOAD', `${command}参数无效`)
      return
    }
    case 'generation.cancel': {
      const value = requireRecord(payload, command)
      if (!nonEmptyText(value.taskId)) throw new BridgeValidationError('INVALID_PAYLOAD', '取消参数无效')
      return
    }
    case 'canvas.placeAsset': {
      const value = requireRecord(payload, command)
      if (!nonEmptyText(value.assetId) || !isPlacementTarget(value.target)) throw new BridgeValidationError('INVALID_PAYLOAD', '置入参数无效')
      return
    }
    case 'generation.testConfig': {
      const value = requireRecord(payload, command)
      if (!nonEmptyText(value.configId)) throw new BridgeValidationError('INVALID_PAYLOAD', '配置测试参数无效')
      return
    }
    case 'history.list': {
      const value = requireRecord(payload, command)
      if (!optionalString(value.cursor) || (value.limit !== undefined && (!Number.isInteger(value.limit) || Number(value.limit) < 1 || Number(value.limit) > 100))) throw new BridgeValidationError('INVALID_PAYLOAD', '历史参数无效')
      return
    }
    case 'history.upsert': {
      const value = requireRecord(payload, command)
      if (!isHistoryUpsertEntry(value.entry)) throw new BridgeValidationError('INVALID_PAYLOAD', '历史记录无效')
      return
    }
  }
}

export function validateCommandResult<TCommand extends HostCommand>(command: TCommand, payload: unknown): asserts payload is HostCommandResult<TCommand> {
  switch (command) {
    case 'host.handshake': {
      const value = requireRecord(payload, command)
      if (!nonEmptyText(value.sessionId) || !finiteNumber(value.protocolVersion) || !nonEmptyText(value.clientNonce) || !nonEmptyText(value.hostNonce) || !isHostContext(value.context)) throw new BridgeValidationError('INVALID_PAYLOAD', '宿主握手响应无效')
      return
    }
    case 'host.getContext':
      if (!isHostContext(payload)) throw new BridgeValidationError('INVALID_PAYLOAD', '宿主上下文无效')
      return
    case 'canvas.captureVisible': case 'canvas.captureSelection': case 'canvas.captureLayer': case 'reference.pickFile': case 'reference.readClipboard':
      if (payload !== null && !isHostAssetRef(payload)) throw new BridgeValidationError('INVALID_PAYLOAD', '资产响应无效')
      return
    case 'generation.start': {
      const value = requireRecord(payload, command)
      if (!nonEmptyText(value.taskId)) throw new BridgeValidationError('INVALID_PAYLOAD', '生成任务响应无效')
      return
    }
    case 'settings.get': case 'settings.save': {
      if (!isSettingsSnapshot(payload)) throw new BridgeValidationError('INVALID_PAYLOAD', '设置响应无效')
      return
    }
    case 'generation.testConfig': {
      const value = requireRecord(payload, command)
      if (typeof value.ok !== 'boolean' || typeof value.message !== 'string') throw new BridgeValidationError('INVALID_PAYLOAD', '配置测试响应无效')
      return
    }
    case 'host.openReleasePage': {
      const value = requireRecord(payload, command)
      if (typeof value.opened !== 'boolean') throw new BridgeValidationError('INVALID_PAYLOAD', '发布页响应无效')
      return
    }
    case 'history.list': {
      const value = requireRecord(payload, command)
      if (!Array.isArray(value.items) || !value.items.every(isHistoryEntry) || !optionalString(value.nextCursor)) throw new BridgeValidationError('INVALID_PAYLOAD', '历史响应无效')
      return
    }
    case 'history.upsert': {
      const value = requireRecord(payload, command)
      if (!isHistoryEntry(value.entry)) throw new BridgeValidationError('INVALID_PAYLOAD', '历史响应无效')
      return
    }
    case 'history.clear': {
      const value = requireRecord(payload, command)
      if (typeof value.cleared !== 'boolean') throw new BridgeValidationError('INVALID_PAYLOAD', '历史清理响应无效')
      return
    }
    case 'credential.set': case 'credential.remove': {
      const value = requireRecord(payload, command)
      const expected = command === 'credential.set' ? 'stored' : 'missing'
      if (!nonEmptyText(value.configId) || value.credentialState !== expected) throw new BridgeValidationError('INVALID_PAYLOAD', '凭据响应无效')
      return
    }
    case 'canvas.readSize': {
      const value = requireRecord(payload, command)
      if (!finiteNumber(value.width) || value.width <= 0 || !finiteNumber(value.height) || value.height <= 0) throw new BridgeValidationError('INVALID_PAYLOAD', '画布尺寸响应无效')
      return
    }
    case 'generation.cancel': {
      if (payload === undefined) return
      const value = requireRecord(payload, command)
      if (!optionalString(value.taskId) || (value.cancelled !== undefined && typeof value.cancelled !== 'boolean')) throw new BridgeValidationError('INVALID_PAYLOAD', '取消响应无效')
      return
    }
    case 'canvas.placeAsset': {
      const value = requireRecord(payload, command)
      if (!nonEmptyText(value.layerName) || !isPlacementTarget(value.target)) throw new BridgeValidationError('INVALID_PAYLOAD', '置入响应无效')
      return
    }
    case 'asset.save': {
      const value = requireRecord(payload, command)
      if (typeof value.saved !== 'boolean' || !optionalString(value.fileName)) throw new BridgeValidationError('INVALID_PAYLOAD', '保存响应无效')
      return
    }
    case 'asset.retain': {
      if (!isHostAssetRef(payload)) throw new BridgeValidationError('INVALID_PAYLOAD', '资产持有响应无效')
      return
    }
    case 'asset.release': {
      const value = requireRecord(payload, command)
      if (!nonEmptyText(value.assetId) || typeof value.released !== 'boolean') throw new BridgeValidationError('INVALID_PAYLOAD', '资产释放响应无效')
      return
    }
    case 'diagnostics.export': {
      const value = requireRecord(payload, command)
      if (typeof value.saved !== 'boolean' || !optionalString(value.fileName)) throw new BridgeValidationError('INVALID_PAYLOAD', '诊断响应无效')
      return
    }
    case 'storage.clearAll': {
      const value = requireRecord(payload, command)
      const categories = new Set<LocalDataCategory>(['credentials', 'settings', 'history', 'assets', 'diagnostics'])
      if (
        value.cleared !== true
        || !Array.isArray(value.deleted)
        || value.deleted.length !== categories.size
        || new Set(value.deleted).size !== categories.size
        || !value.deleted.every(item => categories.has(item as LocalDataCategory))
      ) {
        throw new BridgeValidationError('INVALID_PAYLOAD', '本地数据清理响应无效')
      }
      return
    }
  }
}

export function validateHostEventPayload<TEvent extends HostEventName>(event: TEvent, payload: unknown): asserts payload is HostEventPayload<TEvent> {
  switch (event) {
    case 'host.ready': {
      const value = requireRecord(payload, event)
      if (!finiteNumber(value.protocolVersion) || !nonEmptyText(value.hostNonce) || !optionalString(value.hostVersion)) throw new BridgeValidationError('INVALID_PAYLOAD', '宿主就绪事件无效')
      return
    }
    case 'host.contextChanged':
      if (!isHostContext(payload)) throw new BridgeValidationError('INVALID_PAYLOAD', '宿主上下文事件无效')
      return
    case 'generation.progress':
      if (!isTaskEvent(payload)) throw new BridgeValidationError('INVALID_PAYLOAD', '任务进度事件无效')
      return
    case 'generation.completed':
      if (!isGenerationResult(payload)) throw new BridgeValidationError('INVALID_PAYLOAD', '生成完成事件无效')
      return
    case 'generation.failed': {
      const value = requireRecord(payload, event)
      if (!nonEmptyText(value.taskId) || !isBridgeError(value.error)) throw new BridgeValidationError('INVALID_PAYLOAD', '生成失败事件无效')
      return
    }
    case 'asset.invalidated': {
      const value = requireRecord(payload, event)
      if (!nonEmptyText(value.assetId) || !optionalString(value.reason)) throw new BridgeValidationError('INVALID_PAYLOAD', '资产失效事件无效')
      return
    }
    case 'diagnostics.notice': {
      const value = requireRecord(payload, event)
      if (!['info', 'warning', 'error'].includes(String(value.level)) || !nonEmptyText(value.message, 2048) || !optionalString(value.code)) throw new BridgeValidationError('INVALID_PAYLOAD', '诊断事件无效')
    }
  }
}

export function createMessageId(prefix = 'msg') {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === 'function') return `${prefix}-${cryptoApi.randomUUID()}`
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export function isProtocolCompatible(version: number) {
  return version === PROTOCOL_VERSION
}

export function isHostEvent(value: unknown): value is HostEvent {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (value.type === 'contextChanged') return isHostContext(value.context)
  if (value.type === 'taskProgress') return isTaskEvent(value.event)
  if (value.type === 'generationCompleted') return isGenerationResult(value.result)
  if (value.type === 'generationFailed') return nonEmptyText(value.taskId) && isBridgeError(value.error)
  if (value.type === 'assetInvalidated') return nonEmptyText(value.assetId)
  if (value.type === 'diagnosticsNotice') return typeof value.message === 'string'
  return false
}

export function toWebUiAssetRef(value: HostAssetRef): HostAssetRef {
  const preview = value.thumbnailUrl || value.previewUrl
  return { ...value, previewUrl: value.previewUrl || preview, thumbnailUrl: preview, status: value.status || 'available' }
}

export function toModelConfig(value: PublicModelConfig): ModelConfig {
  return {
    ...value,
    provider: value.provider,
    models: value.models ?? [],
    hasCredential: value.hasCredential ?? value.credentialState === 'stored'
  }
}

export { providerCapabilities, providerUsesApiKey, readProviderCapability } from './providerCapabilities'
export { validateProviderGenerationParameters } from './providerCapabilityData'
export type {
  ProviderGenerationParameters,
  ProviderGenerationValidationCode,
  ProviderGenerationValidationResult,
  SerializableCustomSizeConstraint
} from './providerCapabilityData'

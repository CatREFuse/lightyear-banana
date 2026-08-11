import type { PublicModelConfig, SettingsSnapshot } from '../../../packages/inner-protocol/src/index'
import { providerCapabilities, providerRequiresApiKey } from '../../data/providerCapabilities'
import { getHostRequire } from '../photoshopHost'
import { decodeUtf8, encodeUtf8, utf8ByteLength } from './utf8'

type StoredModelConfig = Omit<PublicModelConfig, 'credentialState' | 'hasCredential'>
export type CredentialBindingConfig = Pick<StoredModelConfig, 'id' | 'provider' | 'baseUrl'>
type SettingsState = {
  schemaVersion: 1
  activeConfigId?: string
  configs: StoredModelConfig[]
}

type UxpFile = {
  read: (options?: unknown) => Promise<string>
  write: (data: string) => Promise<void>
  delete?: () => Promise<unknown>
}

type UxpStorage = {
  secureStorage?: {
    getItem: (key: string) => Promise<ArrayBuffer | Uint8Array | undefined>
    setItem: (key: string, value: Uint8Array) => Promise<void>
    removeItem: (key: string) => Promise<void>
  }
  localFileSystem?: {
    getDataFolder: () => Promise<{
      getEntry: (name: string) => Promise<UxpFile>
      createFile: (name: string, options?: { overwrite?: boolean }) => Promise<UxpFile>
    }>
  }
}

const SETTINGS_FILE = 'mugen-inner-settings.v1.json'
const MAX_SETTINGS_BYTES = 800 * 1024
const MAX_WORKFLOW_BYTES = 600 * 1024
const PROVIDER_IDS = new Set<PublicModelConfig['provider']>([
  'openai', 'iMini', 'gemini', 'apimart', 'seedream', 'qwen', 'kling', 'flux',
  'comfyui', 'custom-openai', 'codex-image-server'
])
const credentialKey = (configId: string) => `mugen.provider-credential.v1.${configId}`
const CREDENTIAL_RECORD_KIND = 'mugen.provider-credential'
const LOCAL_PROVIDER_DEFAULTS: Partial<Record<PublicModelConfig['provider'], string>> = {
  comfyui: 'http://127.0.0.1:8000',
  'codex-image-server': 'http://127.0.0.1:17341'
}
type CredentialBinding = {
  provider: PublicModelConfig['provider']
  origin: string
}

type StoredCredentialRecord = CredentialBinding & {
  kind: typeof CREDENTIAL_RECORD_KIND
  schemaVersion: 1
  apiKey: string
}

function serializedBytes(value: unknown) {
  return utf8ByteLength(typeof value === 'string' ? value : JSON.stringify(value))
}

function getStorage() {
  const hostRequire = getHostRequire()
  if (!hostRequire) throw new Error('Photoshop UXP runtime is unavailable.')
  return hostRequire('uxp').storage as UxpStorage
}

function readText(record: Record<string, unknown>, key: string, fallback = '', maxLength = 2048) {
  return typeof record[key] === 'string' ? record[key].slice(0, maxLength) : fallback
}

function validateBaseUrl(value: string) {
  if (!value) return ''
  const url = new URL(value)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Base URL 仅支持 HTTPS；本地服务可使用 loopback HTTP')
  }
  if (url.username || url.password) throw new Error('Base URL 不能包含登录凭据')
  return url.href.replace(/\/$/, '')
}

function resolveCredentialEndpoint(config: CredentialBindingConfig) {
  const capability = providerCapabilities[config.provider]
  if (capability.officialBaseUrl && config.provider !== 'custom-openai' && !capability.supportsBaseUrl) {
    return capability.officialBaseUrl
  }
  return config.baseUrl || capability.officialBaseUrl || LOCAL_PROVIDER_DEFAULTS[config.provider] || ''
}

export function resolveCredentialBinding(config: CredentialBindingConfig): CredentialBinding | undefined {
  const endpoint = resolveCredentialEndpoint(config)
  if (!endpoint) return undefined
  let url: URL
  try {
    url = new URL(endpoint)
    if (url.hostname.endsWith('.')) url.hostname = url.hostname.slice(0, -1)
  } catch {
    return undefined
  }
  return { provider: config.provider, origin: url.origin }
}

function sameCredentialBinding(left: CredentialBinding | undefined, right: CredentialBinding | undefined) {
  return Boolean(left && right && left.provider === right.provider && left.origin === right.origin)
}

function isDevelopmentApimartFixture(config: CredentialBindingConfig) {
  if (config.id !== 'apimart-smoke' || config.provider !== 'apimart') return false
  try {
    const hostname = new URL(config.baseUrl).hostname.toLowerCase()
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
}

function encodeCredentialRecord(record: StoredCredentialRecord) {
  return encodeUtf8(JSON.stringify(record))
}

function decodeCredentialRecord(value: ArrayBuffer | Uint8Array): StoredCredentialRecord | undefined {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
  let parsed: Partial<StoredCredentialRecord>
  try {
    parsed = JSON.parse(decodeUtf8(bytes)) as Partial<StoredCredentialRecord>
  } catch {
    return undefined
  }
  if (
    parsed.kind !== CREDENTIAL_RECORD_KIND
    || parsed.schemaVersion !== 1
    || !PROVIDER_IDS.has(parsed.provider as PublicModelConfig['provider'])
    || typeof parsed.origin !== 'string'
    || typeof parsed.apiKey !== 'string'
    || !parsed.apiKey
    || parsed.apiKey.length > 8192
  ) return undefined
  return parsed as StoredCredentialRecord
}

async function readStoredCredential(configId: string, strict = false) {
  const secureStorage = getStorage().secureStorage
  if (!secureStorage) {
    if (strict) throw new Error('安全存储不可用')
    return undefined
  }
  try {
    return await secureStorage.getItem(credentialKey(configId))
  } catch (error) {
    if (strict) throw error
    return undefined
  }
}

async function clearStoredCredential(configId: string, strict: boolean) {
  const secureStorage = getStorage().secureStorage
  if (!secureStorage) {
    if (strict) throw new Error('安全存储不可用')
    return
  }
  let stored: ArrayBuffer | Uint8Array | undefined
  try {
    stored = await secureStorage.getItem(credentialKey(configId))
  } catch (error) {
    if (strict) throw error
    return
  }
  if (!stored) return
  try {
    await secureStorage.removeItem(credentialKey(configId))
  } catch (error) {
    if (strict) throw error
  }
}

function validateConfig(value: unknown): StoredModelConfig {
  const config = value as Record<string, unknown>
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('配置无效')
  const id = readText(config, 'id', '', 96)
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(id)) throw new Error('配置 ID 无效')
  const name = readText(config, 'name', '', 128).trim()
  const provider = readText(config, 'provider', '', 64)
  const model = readText(config, 'model', '', 256).trim()
  if (!name || !provider || !model) throw new Error('配置信息不完整')
  if (!PROVIDER_IDS.has(provider as PublicModelConfig['provider'])) throw new Error('配置使用了不受支持的模型服务')
  const models = Array.isArray(config.models)
    ? Array.from(new Set(config.models.filter((item): item is string => typeof item === 'string').map((item) => item.trim().slice(0, 256)).filter(Boolean))).slice(0, 50)
    : [model]
  const customFormat = config.customFormat === 'openai-images' || config.customFormat === 'openai-chat' || config.customFormat === 'gemini'
    ? config.customFormat
    : undefined
  const workflow = readText(config, 'workflow', '', MAX_WORKFLOW_BYTES)
  const comfyInput = config.comfyUi as Record<string, unknown> | undefined
  const comfyUi = provider === 'comfyui'
    ? {
        workflow: typeof comfyInput?.workflow === 'string' ? comfyInput.workflow.slice(0, MAX_WORKFLOW_BYTES) : workflow,
        workflowNodes: Array.isArray(comfyInput?.workflowNodes)
          ? comfyInput.workflowNodes.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item))).slice(0, 200)
          : [],
        timeoutMs: Math.min(30 * 60 * 1000, Math.max(10_000, Number(comfyInput?.timeoutMs) || 10 * 60 * 1000)),
        pollIntervalMs: Math.min(30_000, Math.max(500, Number(comfyInput?.pollIntervalMs) || 2_000))
      }
    : undefined

  return {
    id,
    name,
    provider: provider as StoredModelConfig['provider'],
    model,
    models: models.length ? models : [model],
    baseUrl: validateBaseUrl(readText(config, 'baseUrl', '', 2048).trim()),
    enabled: config.enabled !== false,
    ...(customFormat ? { customFormat } : {}),
    ...(workflow ? { workflow } : {}),
    ...(comfyUi ? { comfyUi } : {})
  }
}

async function readState(): Promise<SettingsState> {
  const localFileSystem = getStorage().localFileSystem
  if (!localFileSystem) return { schemaVersion: 1, configs: [] }
  let serialized: string
  try {
    const file = await (await localFileSystem.getDataFolder()).getEntry(SETTINGS_FILE)
    serialized = await file.read()
  } catch {
    return { schemaVersion: 1, configs: [] }
  }
  if (serializedBytes(serialized) > MAX_SETTINGS_BYTES) throw new Error('本地模型配置超过大小限制，请缩小 ComfyUI 工作流')
  let parsed: Partial<SettingsState>
  try {
    parsed = JSON.parse(serialized) as Partial<SettingsState>
  } catch {
    throw new Error('本地模型配置已损坏，请重新保存配置')
  }
  if (parsed.schemaVersion !== undefined && parsed.schemaVersion !== 1) throw new Error('本地模型配置版本不受支持')
  const configs = Array.isArray(parsed.configs) ? parsed.configs.map(validateConfig) : []
  if (configs.length > 50) throw new Error('本地模型配置数量超过上限')
  const activeConfigId = typeof parsed.activeConfigId === 'string' && configs.some((config) => config.id === parsed.activeConfigId)
    ? parsed.activeConfigId
    : configs.find((config) => config.enabled)?.id
  return { schemaVersion: 1, ...(activeConfigId ? { activeConfigId } : {}), configs }
}

async function writeState(state: SettingsState) {
  const localFileSystem = getStorage().localFileSystem
  if (!localFileSystem) throw new Error('本地存储不可用')
  const serialized = JSON.stringify(state)
  if (serializedBytes(serialized) > MAX_SETTINGS_BYTES) throw new Error('模型配置超过大小限制，请缩小 ComfyUI 工作流')
  const file = await (await localFileSystem.getDataFolder()).createFile(SETTINGS_FILE, { overwrite: true })
  await file.write(serialized)
}

async function readCredentialState(config: CredentialBindingConfig): Promise<'missing' | 'stored'> {
  return (await getCredential(config)) ? 'stored' : 'missing'
}

export async function getSettings(): Promise<SettingsSnapshot> {
  const state = await readState()
  return {
    activeConfigId: state.activeConfigId,
    configs: await Promise.all(state.configs.map(async (config) => {
      const credentialState = await readCredentialState(config)
      return { ...config, credentialState, hasCredential: credentialState === 'stored' }
    }))
  }
}

export async function saveSettings(payload: Record<string, unknown>): Promise<SettingsSnapshot> {
  const previous = await readState()
  const configs = Array.isArray(payload.configs) ? payload.configs.map(validateConfig) : []
  if (configs.length === 0) throw new Error('至少保留一个模型配置')
  if (configs.length > 50) throw new Error('配置数量超过上限')
  if (new Set(configs.map((config) => config.id)).size !== configs.length) throw new Error('配置 ID 重复')
  const activeConfigId = typeof payload.activeConfigId === 'string' && configs.some((config) => config.id === payload.activeConfigId)
    ? payload.activeConfigId
    : configs.find((config) => config.enabled)?.id
  const nextConfigs = new Map(configs.map((config) => [config.id, config]))
  const invalidatedIds = previous.configs
    .filter((oldConfig) => {
      const nextConfig = nextConfigs.get(oldConfig.id)
      if (!nextConfig) return true
      if (!providerRequiresApiKey(oldConfig.provider) && !providerRequiresApiKey(nextConfig.provider)) return false
      return !sameCredentialBinding(resolveCredentialBinding(oldConfig), resolveCredentialBinding(nextConfig))
    })
    .map((config) => config.id)

  // Invalidate first. If secure storage cannot confirm deletion, keep the old
  // settings active so an existing secret can never cross a trust boundary.
  for (const configId of invalidatedIds) {
    await clearStoredCredential(configId, true)
  }
  await writeState({ schemaVersion: 1, ...(activeConfigId ? { activeConfigId } : {}), configs })
  return getSettings()
}

export async function getCredential(config: CredentialBindingConfig) {
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(config.id)) throw new Error('配置 ID 无效')
  if (!providerRequiresApiKey(config.provider)) return ''
  if (__MUGEN_APP_ENV__ !== 'production' && isDevelopmentApimartFixture(config)) return 'mock-good-apimart'
  const expectedBinding = resolveCredentialBinding(config)
  if (!expectedBinding) return ''
  const value = await readStoredCredential(config.id)
  if (!value) return ''
  const record = decodeCredentialRecord(value)
  if (!record || !sameCredentialBinding(record, expectedBinding)) {
    // Unbound legacy values and mismatched records are never returned. Removal
    // is best-effort here; settings.save performs strict invalidation on change.
    await clearStoredCredential(config.id, false)
    return ''
  }
  return record.apiKey
}

export async function setCredential(payload: Record<string, unknown>) {
  const configId = typeof payload.configId === 'string' ? payload.configId : ''
  const apiKey = typeof payload.apiKey === 'string' ? payload.apiKey.trim() : ''
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(configId) || !apiKey || apiKey.length > 8192) throw new Error('凭据无效')
  const config = (await readState()).configs.find((item) => item.id === configId)
  if (!config) throw new Error('找不到模型配置')
  if (!providerRequiresApiKey(config.provider)) throw new Error('该本地模型不需要 API Key')
  const binding = resolveCredentialBinding(config)
  if (!binding) throw new Error('请先配置模型服务地址')
  const secureStorage = getStorage().secureStorage
  if (!secureStorage) throw new Error('安全存储不可用')
  await secureStorage.setItem(credentialKey(configId), encodeCredentialRecord({
    kind: CREDENTIAL_RECORD_KIND,
    schemaVersion: 1,
    ...binding,
    apiKey
  }))
  return { configId, credentialState: 'stored' as const }
}

export async function removeCredential(payload: Record<string, unknown>) {
  const configId = typeof payload.configId === 'string' ? payload.configId : ''
  if (!/^[a-zA-Z0-9_-]{1,96}$/.test(configId)) throw new Error('配置 ID 无效')
  await clearStoredCredential(configId, true)
  return { configId, credentialState: 'missing' as const }
}

export async function clearAllSettingsAndCredentials() {
  const state = await readState()
  for (const config of state.configs) {
    await clearStoredCredential(config.id, true)
  }

  const localFileSystem = getStorage().localFileSystem
  if (!localFileSystem) throw new Error('本地存储不可用')
  const folder = await localFileSystem.getDataFolder()
  let file: UxpFile
  try {
    file = await folder.getEntry(SETTINGS_FILE)
  } catch {
    return
  }
  if (typeof file.delete !== 'function') throw new Error('本地存储不支持删除配置')
  await file.delete()
}

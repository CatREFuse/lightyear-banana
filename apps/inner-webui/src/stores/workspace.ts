import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { GenerationSnapshot, HistoryEntry, HistoryUpsertEntry, HostAssetRef, HostContext, ModelConfig, RequestLog, TaskPhase } from '@lightyear-banana/inner-protocol'
import { PROTOCOL_VERSION, createMessageId, isGenerationSnapshot, isProtocolCompatible, providerCapabilities, providerUsesApiKey, readProviderCapability, toHostAssetPointer, toModelConfig } from '@lightyear-banana/inner-protocol'
import { createHostClient } from '@/host'

export type ChatTurn = {
  id: string
  prompt: string
  references: HostAssetRef[]
  snapshot: GenerationSnapshot
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  phase: TaskPhase
  elapsed: number
  results: HostAssetRef[]
  logs: RequestLog[]
  error?: string
}

export const capabilities = Object.values(providerCapabilities)

export function isConfigUsable(config: ModelConfig) {
  const hasCredential = config.hasCredential || config.credentialState === 'stored'
  return config.enabled && Boolean(config.name.trim() && config.model.trim() && config.baseUrl.trim()) && (!providerUsesApiKey(config.provider) || hasCredential)
}

export function pickActiveConfigId(configs: ModelConfig[], activeConfigId?: string) {
  const enabled = configs.filter(isConfigUsable)
  return enabled.some((config) => config.id === activeConfigId) ? activeConfigId! : (enabled[0]?.id || '')
}

export function historyEntryToTurn(entry: HistoryEntry): ChatTurn | null {
  if (!entry.snapshot || !isGenerationSnapshot(entry.snapshot)) return null
  const status = entry.status ?? 'completed'
  return {
    id: entry.id,
    prompt: entry.prompt,
    references: entry.references ?? [],
    snapshot: entry.snapshot,
    status,
    phase: status,
    elapsed: entry.elapsedSeconds ?? 0,
    results: entry.assets,
    logs: entry.logs ?? [],
    error: entry.error
  }
}

export function turnToHistoryEntry(turn: ChatTurn): HistoryUpsertEntry {
  return {
    id: turn.id,
    updatedAt: new Date().toISOString(),
    prompt: turn.prompt,
    assets: turn.results.map(toHostAssetPointer),
    references: turn.references.map(toHostAssetPointer),
    snapshot: turn.snapshot,
    logs: turn.logs,
    status: turn.status === 'running' ? 'failed' : turn.status,
    elapsedSeconds: turn.elapsed,
    error: turn.error
  }
}

export function canRetryTurn(turn: ChatTurn) {
  return turn.snapshot.references.every((pointer) => (
    turn.references.some((reference) => reference.assetId === pointer.assetId && reference.status !== 'missing')
  ))
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const host = createHostClient()
  const status = ref<'loading' | 'ready' | 'incompatible' | 'error'>('loading')
  const context = ref<HostContext | null>(null)
  const error = ref('')
  const configs = ref<ModelConfig[]>([])
  const references = ref<HostAssetRef[]>([])
  const turns = ref<ChatTurn[]>([])
  const selectedConfigId = ref('')
  const theme = ref<'dark' | 'light' | 'system'>((localStorage.getItem('lb-theme') as 'dark' | 'light' | 'system') || 'system')
  const isPreview = host.mode === 'mock'
  const enabledConfigs = computed(() => configs.value.filter(isConfigUsable))
  const currentConfig = computed(() => enabledConfigs.value.find((config) => config.id === selectedConfigId.value) || enabledConfigs.value[0])
  const currentCapability = computed(() => readProviderCapability(currentConfig.value))
  const canAddReference = computed(() => references.value.length < currentCapability.value.referenceLimit)
  const resolvedTheme = computed(() => theme.value === 'system' ? (context.value?.theme || 'dark') : theme.value)
  let activeConfigSave: Promise<void> = Promise.resolve()
  let referenceMutation: Promise<void> = Promise.resolve()

  function mutateReferences<T>(operation: () => Promise<T>) {
    const run = referenceMutation.then(operation, operation)
    referenceMutation = run.then(() => undefined, () => undefined)
    return run
  }

  async function initialize() {
    status.value = 'loading'
    error.value = ''
    try {
      const response = await host.handshake({ protocolVersion: PROTOCOL_VERSION, webVersion: __WEBUI_VERSION__, clientNonce: createMessageId('nonce') })
      context.value = response.context
      if (!isProtocolCompatible(response.protocolVersion)) {
        status.value = 'incompatible'
        return
      }
      const settings = await host.invoke('settings.get', undefined)
      configs.value = settings.configs.map(toModelConfig)
      selectedConfigId.value = pickActiveConfigId(configs.value, settings.activeConfigId)
      if (response.context.capabilities.includes('history.list')) {
        try {
          const items: HistoryEntry[] = []
          const seenCursors = new Set<string>()
          let cursor: string | undefined
          do {
            const history = await host.invoke('history.list', { cursor, limit: 50 })
            items.push(...history.items)
            cursor = history.nextCursor
            if (cursor && seenCursors.has(cursor)) break
            if (cursor) seenCursors.add(cursor)
          } while (cursor && items.length < 100)
          turns.value = items
            .slice(0, 100)
            .map(historyEntryToTurn)
            .filter((turn): turn is ChatTurn => Boolean(turn))
            .sort((left, right) => Date.parse(left.snapshot.submittedAt) - Date.parse(right.snapshot.submittedAt))
        } catch (reason) {
          error.value = reason instanceof Error ? `记录未载入：${reason.message}` : '生成记录暂时无法载入'
        }
      }
      status.value = 'ready'
    } catch (reason) {
      status.value = 'error'
      error.value = reason instanceof Error ? reason.message : '无法打开工作台，请稍后重试'
    }
  }

  async function openReleasePage() {
    try {
      await host.invoke('host.openReleasePage', undefined)
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : '无法打开更新页面'
    }
  }

  function selectConfig(configId: string) {
    if (!enabledConfigs.value.some((config) => config.id === configId)) return activeConfigSave
    selectedConfigId.value = configId
    const persist = async () => {
      try {
        const settings = await host.invoke('settings.get', undefined)
        await host.invoke('settings.save', { ...settings, activeConfigId: configId })
      } catch (reason) {
        error.value = reason instanceof Error ? `当前模型未保存：${reason.message}` : '当前模型暂时无法保存'
      }
    }
    activeConfigSave = activeConfigSave.then(persist, persist)
    return activeConfigSave
  }

  function addReference(source: 'visible' | 'selection' | 'layer' | 'upload' | 'clipboard') {
    return mutateReferences(async () => {
      if (!canAddReference.value) return
      error.value = ''
      try {
        const asset = await host.captureReference(source)
        if (asset) references.value.push(asset)
      } catch (reason) {
        error.value = reason instanceof Error ? reason.message : '无法添加参考图'
      }
    })
  }

  function removeReference(assetId: string) {
    return mutateReferences(async () => {
      references.value = references.value.filter((reference) => reference.assetId !== assetId)
      await host.invoke('asset.release', { assetId }).catch(() => undefined)
    })
  }

  function clearReferences() {
    return mutateReferences(async () => {
      const assetIds = [...new Set(references.value.map((reference) => reference.assetId))]
      references.value = []
      for (const assetId of assetIds) await host.invoke('asset.release', { assetId }).catch(() => undefined)
    })
  }

  function addResultAsReference(asset: HostAssetRef) {
    return mutateReferences(async () => {
      if (!canAddReference.value || references.value.some((item) => item.assetId === asset.assetId)) return
      try {
        const retained = await host.invoke('asset.retain', { assetId: asset.assetId })
        if (!references.value.some((item) => item.assetId === retained.assetId)) {
          references.value.push({ ...retained, source: 'generated', label: '生成结果' })
        }
      } catch (reason) {
        error.value = reason instanceof Error ? reason.message : '无法添加生成结果'
      }
    })
  }

  function applySnapshot(snapshot: GenerationSnapshot, sourceReferences: HostAssetRef[] = []) {
    return mutateReferences(async () => {
      if (configs.value.some((config) => config.id === snapshot.configId)) selectedConfigId.value = snapshot.configId
      const sourceById = new Map(sourceReferences.map((reference) => [reference.assetId, reference]))
      const candidates = snapshot.references
        .map((reference) => sourceById.get(reference.assetId) ?? references.value.find((item) => item.assetId === reference.assetId))
        .filter((reference): reference is HostAssetRef => Boolean(reference && reference.status !== 'missing'))
        .slice(0, currentCapability.value.referenceLimit)
      const previousIds = new Set(references.value.map((reference) => reference.assetId))
      const retained = new Map<string, HostAssetRef>()
      try {
        for (const candidate of candidates) {
          if (previousIds.has(candidate.assetId)) continue
          retained.set(candidate.assetId, await host.invoke('asset.retain', { assetId: candidate.assetId }))
        }
      } catch (reason) {
        for (const assetId of retained.keys()) await host.invoke('asset.release', { assetId }).catch(() => undefined)
        error.value = reason instanceof Error ? reason.message : '参考图已失效，请重新选择'
        return false
      }
      const next = candidates.map((candidate) => retained.get(candidate.assetId) ?? candidate)
      const nextIds = new Set(next.map((reference) => reference.assetId))
      const removedIds = references.value.map((reference) => reference.assetId).filter((assetId) => !nextIds.has(assetId))
      references.value = next
      for (const assetId of removedIds) await host.invoke('asset.release', { assetId }).catch(() => undefined)
      return true
    })
  }

  async function submitSnapshot(snapshot: GenerationSnapshot, submittedReferences: HostAssetRef[] = []) {
    const turn: ChatTurn = {
      id: createMessageId('turn'),
      prompt: snapshot.prompt,
      references: submittedReferences,
      snapshot,
      status: 'running',
      phase: 'waiting',
      elapsed: 0,
      results: [],
      logs: []
    }
    turns.value.push(turn)
    try {
      const { taskId } = await host.startGeneration(snapshot)
      turn.id = taskId
    } catch (reason) {
      turn.status = 'failed'
      turn.phase = 'failed'
      turn.error = reason instanceof Error ? reason.message : '无法连接 API'
      await persistTurn(turn)
    }
    return turn
  }

  async function persistTurn(turn: ChatTurn) {
    try {
      await host.invoke('history.upsert', { entry: turnToHistoryEntry(turn) })
    } catch (reason) {
      error.value = reason instanceof Error ? `记录未保存：${reason.message}` : '生成记录暂时无法保存'
    }
  }

  function generate(prompt: string, params: { size: string; quality: string; count: number; ratio: string }) {
    return mutateReferences(async () => {
      const config = currentConfig.value
      if (!config || (!prompt.trim() && !references.value.length)) return
      const snapshot: GenerationSnapshot = {
        configId: config.id,
        prompt: prompt.trim() || '根据参考图生成',
        references: references.value.map(toHostAssetPointer),
        ...params,
        submittedAt: new Date().toISOString()
      }
      return submitSnapshot(snapshot, references.value.map((reference) => ({ ...reference })))
    })
  }

  async function cancel(turn: ChatTurn) {
    try {
      await host.cancelGeneration(turn.id)
      turn.status = 'cancelled'
      turn.phase = 'cancelled'
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : '无法取消任务'
    }
  }

  async function place(assetId: string, target: 'default' | 'original-size' | 'full-canvas' | 'current-selection' = 'default') {
    return host.placeAsset(assetId, { type: target })
  }
  async function placeToReference(assetId: string, reference: HostAssetRef) {
    if (!reference.sourceBounds) throw new Error('这张参考图没有可用选区')
    return host.placeAsset(assetId, { type: 'reference-selection', referenceAssetId: reference.assetId, bounds: reference.sourceBounds })
  }
  async function save(assetId: string) { return host.saveAsset(assetId) }
  function retry(turn: ChatTurn) {
    return mutateReferences(async () => {
      if (!turns.value.includes(turn)) throw new Error('这条记录已清除')
      if (!canRetryTurn(turn)) {
        const message = '参考图已失效，请重新选择后生成'
        error.value = message
        throw new Error(message)
      }
      return submitSnapshot({ ...turn.snapshot, submittedAt: new Date().toISOString() }, turn.references.map((reference) => ({ ...reference })))
    })
  }
  function clearHistory() {
    return mutateReferences(async () => {
      const assetIds = new Set(turns.value.flatMap((turn) => [
        ...turn.references.map((asset) => asset.assetId),
        ...turn.results.map((asset) => asset.assetId),
        ...turn.snapshot.references.map((asset) => asset.assetId)
      ]))
      await host.clearHistory()
      turns.value = []
      const currentIds = new Set(references.value.map((reference) => reference.assetId))
      for (const assetId of assetIds) {
        if (!currentIds.has(assetId)) await host.invoke('asset.release', { assetId }).catch(() => undefined)
      }
    })
  }
  function clearLocalData() {
    return mutateReferences(async () => {
      const result = await host.clearLocalData()
      localStorage.clear()
      sessionStorage.clear()
      configs.value = []
      references.value = []
      turns.value = []
      selectedConfigId.value = ''
      theme.value = 'system'
      error.value = ''
      return result
    })
  }
  async function saveConfig(config: ModelConfig, apiKey?: string) {
    const saved = await host.saveConfig(config, apiKey)
    const index = configs.value.findIndex((item) => item.id === saved.id)
    if (index >= 0) configs.value.splice(index, 1, saved)
    else configs.value.push(saved)
    selectedConfigId.value = isConfigUsable(saved) ? saved.id : (enabledConfigs.value[0]?.id || '')
    return saved
  }
  async function deleteConfig(configId: string) {
    if (configs.value.length <= 1) throw new Error('至少保留一个模型配置')
    await host.deleteConfig(configId)
    configs.value = configs.value.filter((config) => config.id !== configId)
    selectedConfigId.value = enabledConfigs.value[0]?.id || ''
  }
  function setTheme(value: 'dark' | 'light' | 'system') {
    theme.value = value
    localStorage.setItem('lb-theme', value)
  }

  host.onEvent((event) => {
    if (event.type === 'contextChanged') context.value = event.context
    if (event.type === 'taskProgress') {
      const turn = turns.value.find((item) => item.id === event.event.taskId)
      if (turn) {
        turn.phase = event.event.phase
        turn.elapsed = event.event.elapsedSeconds
        if (event.event.phase === 'cancelled') turn.status = 'cancelled'
      }
    }
    if (event.type === 'generationCompleted') {
      const turn = turns.value.find((item) => item.id === event.result.taskId)
      if (turn) {
        turn.status = 'completed'
        turn.phase = 'completed'
        turn.results = event.result.assets
        turn.logs = event.result.logs
      }
    }
    if (event.type === 'generationFailed') {
      const turn = turns.value.find((item) => item.id === event.taskId)
      if (turn) {
        turn.status = 'failed'
        turn.phase = 'failed'
        turn.error = event.error.message
      }
    }
    if (event.type === 'assetInvalidated') {
      references.value = references.value.map((asset) => asset.assetId === event.assetId ? { ...asset, status: 'missing' } : asset)
      for (const turn of turns.value) {
        turn.references = turn.references.map((asset) => asset.assetId === event.assetId ? { ...asset, status: 'missing' } : asset)
        turn.results = turn.results.map((asset) => asset.assetId === event.assetId ? { ...asset, status: 'missing' } : asset)
        turn.snapshot = { ...turn.snapshot, references: turn.snapshot.references.map((asset) => asset.assetId === event.assetId ? { ...asset, status: 'missing' } : asset) }
      }
    }
    if (event.type === 'diagnosticsNotice') error.value = event.message
  })

  return {
    host, status, context, error, configs, enabledConfigs, references, turns, selectedConfigId, theme, isPreview,
    currentConfig, currentCapability, canAddReference, resolvedTheme, initialize, openReleasePage,
    addReference, removeReference, clearReferences, addResultAsReference, applySnapshot, generate, cancel, place, placeToReference,
    save, retry, canRetryTurn, clearHistory, clearLocalData, saveConfig, deleteConfig, selectConfig, setTheme
  }
})

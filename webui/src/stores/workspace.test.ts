import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import type { HistoryEntry, HostClient, ModelConfig, SettingsSnapshot } from '@mugen/inner-protocol'
import { toHostAssetPointer } from '@mugen/inner-protocol'
import * as hostModule from '@/host'
import { canRetryTurn, historyEntryToTurn, isConfigUsable, pickActiveConfigId, turnToHistoryEntry, useWorkspaceStore } from './workspace'

const config: ModelConfig = {
  id: 'openai-default',
  name: 'OpenAI',
  provider: 'openai',
  model: 'gpt-image-2',
  baseUrl: 'https://api.openai.com',
  enabled: true,
  hasCredential: true
}

const entry: HistoryEntry = {
  id: 'task-1',
  updatedAt: '2026-08-10T00:00:01.000Z',
  prompt: '一张海报',
  assets: [],
  snapshot: {
    configId: config.id,
    prompt: '一张海报',
    references: [],
    size: '1024x1024',
    quality: 'high',
    count: 1,
    ratio: '1:1',
    submittedAt: '2026-08-10T00:00:00.000Z'
  },
  logs: [],
  status: 'completed',
  elapsedSeconds: 3
}

describe('workspace persistence', () => {
  it('restores and serializes a stable generation snapshot', () => {
    const turn = historyEntryToTurn(entry)
    expect(turn).toMatchObject({ id: 'task-1', status: 'completed', elapsed: 3, snapshot: entry.snapshot })
    const serialized = turnToHistoryEntry(turn!)
    expect(serialized).toMatchObject({ id: 'task-1', status: 'completed', snapshot: entry.snapshot })
    expect(serialized.assets).toEqual([])
  })

  it('allows stable-snapshot retry only while every session reference is available', () => {
    const reference = {
      assetId: 'asset-reference-1',
      label: '选区参考',
      source: 'selection' as const,
      width: 512,
      height: 512,
      previewUrl: 'data:image/png;base64,AQID',
      status: 'available' as const
    }
    const turn = historyEntryToTurn({
      ...entry,
      references: [reference],
      snapshot: { ...entry.snapshot!, references: [toHostAssetPointer(reference)] }
    })!

    expect(canRetryTurn(turn)).toBe(true)
    expect(canRetryTurn({ ...turn, references: [{ ...reference, status: 'missing' }] })).toBe(false)
    expect(canRetryTurn({ ...turn, references: [] })).toBe(false)
  })

  it('ignores legacy records without a valid request snapshot', () => {
    expect(historyEntryToTurn({ ...entry, snapshot: undefined })).toBeNull()
  })

  it('shows only enabled and fully configured models in the composer', () => {
    expect(isConfigUsable(config)).toBe(true)
    expect(isConfigUsable({ ...config, hasCredential: false, credentialState: 'missing' })).toBe(false)
    expect(isConfigUsable({ ...config, provider: 'comfyui', baseUrl: 'http://127.0.0.1:8000', hasCredential: false })).toBe(true)
    expect(isConfigUsable({ ...config, enabled: false })).toBe(false)
  })

  it('restores the saved active configuration when it is still usable', () => {
    const second = { ...config, id: 'openai-second', name: 'OpenAI 2' }
    expect(pickActiveConfigId([config, second], second.id)).toBe(second.id)
    expect(pickActiveConfigId([config, { ...second, enabled: false }], second.id)).toBe(config.id)
  })
})

describe('workspace settings transactions', () => {
  const secondConfig = { ...config, id: 'openai-second', name: 'OpenAI 2' }
  const piniaInstances: ReturnType<typeof createPinia>[] = []

  afterEach(() => {
    for (const pinia of piniaInstances.splice(0)) disposePinia(pinia)
    vi.restoreAllMocks()
  })

  function createSettingsHarness() {
    let settings: SettingsSnapshot = {
      activeConfigId: config.id,
      configs: [config, secondConfig].map((item) => ({ ...item, credentialState: 'stored' as const })),
      themePreferences: { visualTheme: 'nothing', colorMode: 'dark' },
      promptPresets: []
    }
    const invoke = vi.fn(async (command: string, payload?: SettingsSnapshot) => {
      if (command === 'settings.get') return structuredClone(settings)
      if (command === 'settings.save') {
        settings = structuredClone({ ...settings, ...payload })
        return structuredClone(settings)
      }
      if (command === 'credential.remove') return { credentialState: 'missing' }
      throw new Error(`Unexpected command: ${command}`)
    })
    const host = {
      mode: 'embedded',
      invoke,
      onEvent: () => () => undefined
    } as unknown as HostClient
    host.saveConfig = hostModule.WebViewHostClient.prototype.saveConfig.bind(host)
    host.deleteConfig = hostModule.WebViewHostClient.prototype.deleteConfig.bind(host)
    vi.spyOn(hostModule, 'createHostClient').mockReturnValue(host)
    const pinia = createPinia()
    piniaInstances.push(pinia)
    setActivePinia(pinia)
    const store = useWorkspaceStore()
    store.configs = [config, secondConfig].map((item) => ({ ...item }))
    store.selectedConfigId = config.id
    return { store, invoke, read: () => structuredClone(settings) }
  }

  it('keeps model selection, theme, and prompt presets when saved together', async () => {
    const { store, invoke, read } = createSettingsHarness()
    const presets = [{ id: 'preset-1', name: '海报', content: '生成一张海报' }]

    store.setColorMode('light')
    const selection = store.selectConfig(secondConfig.id)
    const presetSave = store.savePromptPresets(presets)
    await Promise.all([selection, presetSave])
    await vi.waitFor(() => expect(invoke.mock.calls.filter(([command]) => command === 'settings.save')).toHaveLength(3))

    expect(read()).toMatchObject({
      activeConfigId: secondConfig.id,
      themePreferences: { visualTheme: 'nothing', colorMode: 'light' },
      promptPresets: presets
    })
  })

  it('keeps a newly saved configuration when a theme write overlaps it', async () => {
    const { store, invoke, read } = createSettingsHarness()
    const added = { ...config, id: 'openai-new', name: '新配置' }

    store.setVisualTheme('classic')
    await store.saveConfig(added)
    await vi.waitFor(() => expect(invoke.mock.calls.filter(([command]) => command === 'settings.save')).toHaveLength(2))

    expect(read().configs.map((item) => item.id)).toEqual([config.id, secondConfig.id, added.id])
    expect(read().activeConfigId).toBe(added.id)
    expect(read().themePreferences?.visualTheme).toBe('classic')
  })

  it('does not restore a deleted configuration from an overlapping theme snapshot', async () => {
    const { store, invoke, read } = createSettingsHarness()

    store.setColorMode('light')
    await store.deleteConfig(secondConfig.id)
    await vi.waitFor(() => expect(invoke.mock.calls.filter(([command]) => command === 'settings.save')).toHaveLength(2))

    expect(invoke).toHaveBeenCalledWith('credential.remove', { configId: secondConfig.id })
    expect(read().configs.map((item) => item.id)).toEqual([config.id])
    expect(read().themePreferences?.colorMode).toBe('light')
  })

  it('propagates a failed configuration save and still saves the next settings change', async () => {
    const { store, read } = createSettingsHarness()
    vi.spyOn(store.host, 'saveConfig').mockRejectedValueOnce(new Error('磁盘写入失败'))
    const failed = store.saveConfig({ ...config, name: '未保存的名称' })
    const assertion = expect(failed).rejects.toThrow('磁盘写入失败')
    const presets = [{ id: 'preset-2', name: '风景', content: '生成山水画' }]
    await Promise.all([assertion, store.savePromptPresets(presets)])

    expect(store.configs[0]?.name).toBe(config.name)
    expect(read().promptPresets).toEqual(presets)
  })

  it('checks the remaining configuration count after a preceding deletion completes', async () => {
    const { store, read } = createSettingsHarness()
    const first = store.deleteConfig(secondConfig.id)
    const second = store.deleteConfig(config.id)

    await Promise.all([first, expect(second).rejects.toThrow('至少保留一个模型配置')])

    expect(read().configs.map((item) => item.id)).toEqual([config.id])
  })

  it('waits for a pending settings write before clearing local data', async () => {
    const { store, read } = createSettingsHarness()
    const order: string[] = []
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    const save = store.host.saveConfig.bind(store.host)
    vi.spyOn(store.host, 'saveConfig').mockImplementation(async (value, key) => {
      await pending
      const saved = await save(value, key)
      order.push('save')
      return saved
    })
    store.host.clearLocalData = vi.fn(async () => {
      order.push('clear')
      return { cleared: true, deleted: ['settings' as const] }
    })

    const saving = store.saveConfig({ ...config, name: '修改后的名称' })
    const clearing = store.clearLocalData()
    await Promise.resolve()
    await Promise.resolve()
    expect(store.host.clearLocalData).not.toHaveBeenCalled()
    release()
    await Promise.all([saving, clearing])

    expect(order).toEqual(['save', 'clear'])
    expect(read().configs[0]?.name).toBe('修改后的名称')
    expect(store.configs).toEqual([])
  })
})

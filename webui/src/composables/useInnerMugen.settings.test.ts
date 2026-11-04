import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, reactive, type EffectScope } from 'vue'
import type { ModelConfig } from '@mugen/inner-protocol'
import { useInnerMugen } from './useInnerMugen'

const mocks = vi.hoisted(() => ({ useWorkspaceStore: vi.fn() }))
vi.mock('@/stores/workspace', () => mocks)

let scope: EffectScope
const config: ModelConfig = {
  id: 'config-a', name: '已保存名称', provider: 'openai', model: 'gpt-image-2',
  baseUrl: 'https://api.openai.com', enabled: true, hasCredential: true
}

function createController() {
  const store = reactive({
    configs: [{ ...config }], selectedConfigId: config.id, status: 'ready',
    turns: [], promptPresets: [],
    saveConfig: vi.fn(async (next: ModelConfig) => {
      store.configs = [next]
      return next
    }),
    host: { testConfig: vi.fn() }
  })
  mocks.useWorkspaceStore.mockReturnValue(store)
  scope = effectScope()
  return { store, controller: scope.run(() => useInnerMugen())! }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { scope.stop(); vi.useRealTimers(); vi.clearAllMocks() })

describe('CCX settings actions', () => {
  it('changes enabled state without saving or discarding other draft fields', async () => {
    const { store, controller } = createController()
    controller.editConfig(config.id)
    controller.updateSettingsDraft({ name: '尚未保存的名称' })
    await controller.toggleConfigEnabled(false)
    expect(store.saveConfig.mock.calls[0][0]).toMatchObject({ name: '已保存名称', enabled: false })
    expect(controller.settingsDraft).toMatchObject({ name: '尚未保存的名称', enabled: false })
    expect(controller.settingsView.value).toBe('detail')
  })

  it('preserves the saved toggle and reports a failed write', async () => {
    const { store, controller } = createController()
    controller.editConfig(config.id)
    store.saveConfig.mockRejectedValue(new Error('磁盘写入失败'))
    await controller.toggleConfigEnabled(false)
    expect(controller.toastMessage.value).toBe('磁盘写入失败')
    expect(controller.settingsDraft.enabled).toBe(true)
  })

  it('ignores a connection test result after the tested draft changes', async () => {
    const { store, controller } = createController()
    let finish!: (value: { ok: boolean; message: string }) => void
    store.host.testConfig.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const pending = controller.testConfig()
    controller.updateSettingsDraft({ apiKey: 'changed-test-key' })
    finish({ ok: true, message: '旧 Key 可用' })
    await pending
    expect(controller.settingsTestState.value.status).toBe('idle')
  })
})

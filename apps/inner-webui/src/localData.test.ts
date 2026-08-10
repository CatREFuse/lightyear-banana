import { describe, expect, it, vi } from 'vitest'
import { LOCAL_DATA_TYPES, confirmAndClearLocalData } from './localData'

const cleared = {
  cleared: true as const,
  deleted: ['credentials', 'settings', 'history', 'assets', 'diagnostics'] as const
}

describe('clear-all confirmation', () => {
  it('lists every local-data type and requires two confirmations before calling Host', async () => {
    const confirm = vi.fn((_message: string) => true)
    const clear = vi.fn(async () => ({ ...cleared, deleted: [...cleared.deleted] }))

    await expect(confirmAndClearLocalData(confirm, clear)).resolves.toEqual(cleared)

    expect(confirm).toHaveBeenCalledTimes(2)
    for (const type of LOCAL_DATA_TYPES) expect(confirm.mock.calls[0]?.[0]).toContain(type)
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('does not call Host when either confirmation is cancelled', async () => {
    const clear = vi.fn(async () => ({ ...cleared, deleted: [...cleared.deleted] }))
    await expect(confirmAndClearLocalData(() => false, clear)).resolves.toBeNull()
    await expect(confirmAndClearLocalData(vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false), clear)).resolves.toBeNull()
    expect(clear).not.toHaveBeenCalled()
  })
})

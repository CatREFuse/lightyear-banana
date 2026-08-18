import { describe, expect, it } from 'vitest'
import { pollAsyncTask, readAsyncTaskPollIntervalMs } from './asyncTaskPolling'

describe('shared async task polling', () => {
  it('polls every 5 seconds through 180 seconds, then every 10 seconds', () => {
    expect(readAsyncTaskPollIntervalMs(0)).toBe(5_000)
    expect(readAsyncTaskPollIntervalMs(179_999)).toBe(5_000)
    expect(readAsyncTaskPollIntervalMs(180_000)).toBe(10_000)
  })

  it('uses the shared schedule until the task succeeds', async () => {
    let now = 0
    const pollTimes: number[] = []
    const waits: number[] = []

    const result = await pollAsyncTask({
      timeoutMs: 200_000,
      now: () => now,
      wait: async (milliseconds) => {
        waits.push(milliseconds)
        now += milliseconds
      },
      poll: async () => {
        pollTimes.push(now)
        return now >= 190_000
          ? { done: true, value: 'finished' }
          : { done: false }
      },
      createAbortError: () => new Error('aborted'),
      createTimeoutError: () => new Error('timed out')
    })

    expect(result).toBe('finished')
    expect(pollTimes.slice(0, 3)).toEqual([0, 5_000, 10_000])
    expect(pollTimes.slice(-3)).toEqual([175_000, 180_000, 190_000])
    expect(waits.slice(-2)).toEqual([5_000, 10_000])
  })

  it('caps the final wait at the remaining timeout', async () => {
    let now = 0
    const waits: number[] = []

    await expect(pollAsyncTask({
      timeoutMs: 183_000,
      now: () => now,
      wait: async (milliseconds) => {
        waits.push(milliseconds)
        now += milliseconds
      },
      poll: async () => ({ done: false }),
      createAbortError: () => new Error('aborted'),
      createTimeoutError: () => new Error('timed out')
    })).rejects.toThrow('timed out')

    expect(waits.at(-1)).toBe(3_000)
    expect(now).toBe(183_000)
  })
})

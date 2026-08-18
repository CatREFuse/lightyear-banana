export type AsyncTaskPollResult<TResult> =
  | { done: false }
  | { done: true; value: TResult }

type AsyncTaskPollingOptions<TResult> = {
  timeoutMs: number
  signal?: AbortSignal
  poll: (attempt: number) => Promise<AsyncTaskPollResult<TResult>>
  createAbortError: () => Error
  createTimeoutError: () => Error
  now?: () => number
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>
}

const fastPollIntervalMs = 5_000
const slowPollIntervalMs = 10_000
const slowPollThresholdMs = 180_000

export function readAsyncTaskPollIntervalMs(elapsedMs: number) {
  return elapsedMs < slowPollThresholdMs ? fastPollIntervalMs : slowPollIntervalMs
}

function waitForNextPoll(milliseconds: number, signal: AbortSignal | undefined, createAbortError: () => Error) {
  if (signal?.aborted) {
    return Promise.reject(createAbortError())
  }

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort)
      resolve()
    }, milliseconds)

    function handleAbort() {
      clearTimeout(timer)
      reject(createAbortError())
    }

    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}

export async function pollAsyncTask<TResult>(options: AsyncTaskPollingOptions<TResult>) {
  const now = options.now ?? Date.now
  const startedAt = now()
  let attempt = 0

  while (now() - startedAt < options.timeoutMs) {
    if (options.signal?.aborted) {
      throw options.createAbortError()
    }

    const result = await options.poll(++attempt)
    if (result.done) {
      return result.value
    }

    const elapsedMs = now() - startedAt
    const remainingMs = options.timeoutMs - elapsedMs
    if (remainingMs <= 0) {
      break
    }

    const wait = options.wait ?? ((milliseconds, signal) => (
      waitForNextPoll(milliseconds, signal, options.createAbortError)
    ))
    await wait(Math.min(readAsyncTaskPollIntervalMs(elapsedMs), remainingMs), options.signal)
  }

  throw options.createTimeoutError()
}

export type CcxDiagnosticPhase = 'start' | 'progress' | 'success' | 'cancel' | 'error' | 'timeout'

export type CcxDiagnosticEvent = {
  timestamp: string
  eventId: string
  sequence: number
  offsetMs: number
  operation: string
  phase: CcxDiagnosticPhase
  durationMs?: number
  details?: Record<string, unknown>
  error?: Record<string, unknown>
}

export type CcxDiagnosticReporter = (requestId: string, event: CcxDiagnosticEvent) => Promise<void>

export type CcxDiagnosticTrace = {
  emit: (
    operation: string,
    phase: CcxDiagnosticPhase,
    details?: Record<string, unknown>,
    error?: unknown
  ) => Promise<CcxDiagnosticEvent>
  snapshot: () => { events: CcxDiagnosticEvent[] }
}

function sanitizeErrorString(value: unknown) {
  return String(value ?? '')
    .replace(/([?&](?:api[-_]?key|key|token|secret|password)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/=:-]+/gi, '$1 [REDACTED]')
    .replace(/\b(api[-_ ]?key|authorization|password|secret|token)(\s*[=:]\s*)[^\s,;}"]+/gi, '$1$2[REDACTED]')
}

function readErrorField(error: Record<string, unknown>, key: string) {
  try {
    return error[key]
  } catch {
    return undefined
  }
}

export function normalizeCcxDiagnosticError(error: unknown): Record<string, unknown> {
  if (!error || (typeof error !== 'object' && typeof error !== 'function')) {
    return { message: sanitizeErrorString(error || 'Photoshop 操作失败') }
  }

  const source = error as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const key of ['name', 'message', 'number', 'code', 'stack', 'descriptor', 'details']) {
    const value = readErrorField(source, key)
    if (value !== undefined) {
      result[key] = typeof value === 'string' ? sanitizeErrorString(value) : value
    }
  }

  const cause = readErrorField(source, 'cause')
  if (cause !== undefined) {
    result.cause = normalizeCcxDiagnosticError(cause)
  }

  if (!result.message) {
    result.message = sanitizeErrorString(error)
  }

  return result
}

export function createCcxDiagnosticTrace(options: {
  requestId: string
  reporter?: CcxDiagnosticReporter
}): CcxDiagnosticTrace {
  const startedAt = Date.now()
  const events: CcxDiagnosticEvent[] = []
  let sequence = 0

  async function emit(
    operation: string,
    phase: CcxDiagnosticPhase,
    details?: Record<string, unknown>,
    error?: unknown
  ) {
    sequence += 1
    const event: CcxDiagnosticEvent = {
      timestamp: new Date().toISOString(),
      eventId: `${options.requestId}:${sequence}`,
      sequence,
      offsetMs: Date.now() - startedAt,
      operation,
      phase,
      ...(details ? { details } : {}),
      ...(error ? { error: normalizeCcxDiagnosticError(error) } : {})
    }
    events.push(event)

    if (options.reporter) {
      try {
        await options.reporter(options.requestId, event)
      } catch {
      }
    }

    return event
  }

  return {
    emit,
    snapshot: () => ({ events: events.map((event) => ({ ...event })) })
  }
}

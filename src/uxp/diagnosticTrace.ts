export type UxpDiagnosticPhase = 'start' | 'progress' | 'success' | 'cancel' | 'error' | 'timeout'

export type UxpDiagnosticEvent = {
  timestamp: string
  eventId: string
  sequence: number
  offsetMs: number
  operation: string
  phase: UxpDiagnosticPhase
  durationMs?: number
  details?: Record<string, unknown>
  error?: Record<string, unknown>
}

export type UxpDiagnosticReporter = (requestId: string, event: UxpDiagnosticEvent) => Promise<void>

export type UxpDiagnosticTrace = {
  emit: (
    operation: string,
    phase: UxpDiagnosticPhase,
    details?: Record<string, unknown>,
    error?: unknown
  ) => Promise<UxpDiagnosticEvent>
  snapshot: () => { events: UxpDiagnosticEvent[] }
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

export function normalizeUxpDiagnosticError(error: unknown): Record<string, unknown> {
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
    result.cause = normalizeUxpDiagnosticError(cause)
  }

  if (!result.message) {
    result.message = sanitizeErrorString(error)
  }

  return result
}

export function createUxpDiagnosticTrace(options: {
  requestId: string
  reporter?: UxpDiagnosticReporter
}): UxpDiagnosticTrace {
  const startedAt = Date.now()
  const events: UxpDiagnosticEvent[] = []
  let sequence = 0

  async function emit(
    operation: string,
    phase: UxpDiagnosticPhase,
    details?: Record<string, unknown>,
    error?: unknown
  ) {
    sequence += 1
    const event: UxpDiagnosticEvent = {
      timestamp: new Date().toISOString(),
      eventId: `${options.requestId}:${sequence}`,
      sequence,
      offsetMs: Date.now() - startedAt,
      operation,
      phase,
      ...(details ? { details } : {}),
      ...(error ? { error: normalizeUxpDiagnosticError(error) } : {})
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

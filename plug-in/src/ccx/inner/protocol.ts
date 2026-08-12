import {
  INNER_HOST_PROTOCOL,
  MAX_BRIDGE_MESSAGE_BYTES,
  assertMessageSize,
  parseBridgeEnvelope,
  validateCommandPayload,
  validateCommandResult,
  validateHostEventPayload,
  type BridgeEnvelope,
  type BridgeError,
  type HostCommand,
  type HostEventName
} from '@mugen/inner-protocol'

export { INNER_HOST_PROTOCOL, MAX_BRIDGE_MESSAGE_BYTES }
export type { BridgeEnvelope, BridgeError, HostCommand }

export class BridgeValidationError extends Error {
  readonly code: string
  readonly recoverable: boolean

  constructor(code: string, message: string, recoverable = false) {
    super(message)
    this.name = 'BridgeValidationError'
    this.code = code
    this.recoverable = recoverable
  }
}

export function parseRequest(value: unknown) {
  try {
    const envelope = parseBridgeEnvelope(value, 'request')
    validateCommandPayload(envelope.command as HostCommand, envelope.payload)
    return envelope as BridgeEnvelope<Record<string, unknown> | undefined>
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'INVALID_MESSAGE'
    const message = error instanceof Error ? error.message : '消息格式无效'
    throw new BridgeValidationError(code, message)
  }
}

export function createResponse(request: BridgeEnvelope, sessionId: string, payload?: unknown): BridgeEnvelope {
  validateCommandResult(request.command as HostCommand, payload)
  const response: BridgeEnvelope = {
    protocol: INNER_HOST_PROTOCOL,
    kind: 'response',
    messageId: request.messageId,
    sessionId,
    command: request.command,
    timestamp: new Date().toISOString(),
    ...(payload === undefined ? {} : { payload })
  }
  assertMessageSize(response)
  return response
}

function safeText(value: unknown, fallback: string) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : fallback
}

export function createErrorResponse(request: Partial<BridgeEnvelope> | undefined, sessionId: string, error: BridgeError): BridgeEnvelope {
  const response: BridgeEnvelope = {
    protocol: INNER_HOST_PROTOCOL,
    kind: 'response',
    messageId: safeText(request?.messageId, `invalid-${Date.now()}`),
    sessionId,
    command: safeText(request?.command, 'host.handshake'),
    timestamp: new Date().toISOString(),
    error: {
      code: safeText(error.code, 'HOST_COMMAND_FAILED'),
      message: error.message.slice(0, 2048),
      recoverable: error.recoverable,
      ...(error.details ? { details: error.details } : {})
    }
  }
  assertMessageSize(response)
  return response
}

export function createEvent(
  sessionId: string,
  command: HostEventName,
  payload: unknown,
  messageId = `event-${Date.now()}`
): BridgeEnvelope {
  validateHostEventPayload(command, payload)
  const event: BridgeEnvelope = {
    protocol: INNER_HOST_PROTOCOL,
    kind: 'event',
    messageId,
    sessionId,
    command,
    timestamp: new Date().toISOString(),
    payload
  }
  assertMessageSize(event)
  return event
}

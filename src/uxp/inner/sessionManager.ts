import { BridgeValidationError, type BridgeEnvelope } from './protocol'
import { PROTOCOL_VERSION } from '../../../packages/inner-protocol/src/index'

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000
const MAX_SEEN_MESSAGES = 1000

function randomPart() {
  const bytes = new Uint8Array(16)
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export class SessionManager {
  readonly sessionId = `inner-${randomPart()}`
  readonly hostNonce = randomPart()
  private clientNonce = ''
  private handshaken = false
  private readonly seenMessages = new Set<string>()

  validate(request: BridgeEnvelope<Record<string, unknown> | undefined>) {
    if (request.sessionId !== this.sessionId) {
      throw new BridgeValidationError('INVALID_SESSION', '会话已失效', true)
    }
    const timestamp = Date.parse(request.timestamp)
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > MAX_CLOCK_SKEW_MS) {
      throw new BridgeValidationError('STALE_MESSAGE', '请求已过期，请重试', true)
    }
    if (this.seenMessages.has(request.messageId)) {
      throw new BridgeValidationError('DUPLICATE_MESSAGE', '请求已处理', false)
    }
    this.seenMessages.add(request.messageId)
    if (this.seenMessages.size > MAX_SEEN_MESSAGES) {
      const oldest = this.seenMessages.values().next().value
      if (typeof oldest === 'string') this.seenMessages.delete(oldest)
    }

    if (request.command === 'host.handshake') {
      const hostNonce = request.payload?.hostNonce
      const clientNonce = request.payload?.clientNonce
      const protocolVersion = request.payload?.protocolVersion
      const webVersion = request.payload?.webVersion
      if (protocolVersion !== PROTOCOL_VERSION) {
        throw new BridgeValidationError('UNSUPPORTED_PROTOCOL', 'WebUI 与宿主协议不兼容')
      }
      if (typeof webVersion !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(webVersion)) {
        throw new BridgeValidationError('INVALID_WEB_VERSION', 'WebUI 版本无效')
      }
      if (hostNonce !== this.hostNonce || typeof clientNonce !== 'string' || clientNonce.length < 8 || clientNonce.length > 256) {
        throw new BridgeValidationError('INVALID_NONCE', '会话验证失败')
      }
      this.clientNonce = clientNonce
      this.handshaken = true
      return
    }
    if (!this.handshaken) {
      throw new BridgeValidationError('HANDSHAKE_REQUIRED', '请重新连接宿主', true)
    }
  }

  get handshakeContext() {
    return {
      sessionId: this.sessionId,
      hostNonce: this.hostNonce,
      clientNonce: this.clientNonce
    }
  }
}

import { HOST_COMMANDS, PROTOCOL_VERSION, type BridgeError, type HistoryUpsertEntry, type HostCommand, type HostEventName, type PlacementTarget } from '@mugen/inner-protocol'
import { canvasPrimitiveService } from '../canvasPrimitiveService'
import { readCanvasDiagnosticContext } from '../canvasPrimitives'
import { readActiveDocumentLabel } from '../photoshopHost'
import { AssetStore } from './assetStore'
import { FileAssetService } from './fileAssets'
import { DiagnosticStore, HistoryStore } from './hostData'
import { createHostConfirmationController, type HostConfirmationController } from './hostConfirmation'
import { createProviderRuntime, type ProviderRuntime } from './providerRuntime'
import { resolveReferenceSelectionPlacement } from './referenceSelectionPlacement'
import { clearAllSettingsAndCredentials, getSettings, removeCredential, saveSettings, setCredential } from './storage'
import type { BridgeEnvelope } from './protocol'
import type { SessionManager } from './sessionManager'

const OFFICIAL_RELEASE_PAGE = __INNER_RELEASE_URL__

type CommandPayload = Record<string, unknown> | undefined
type CommandHandler = (payload: CommandPayload) => Promise<unknown>
type EventEmitter = (command: HostEventName, payload: unknown) => void
type NotificationEvent = { event: string }
type NotificationListener = (eventName: string, descriptor: Record<string, unknown>) => void
type PhotoshopActionNotifications = {
  addNotificationListener?: (events: NotificationEvent[], listener: NotificationListener) => Promise<void>
  removeNotificationListener?: (events: NotificationEvent[], listener: NotificationListener) => Promise<void> | void
}

function diagnosticCategory(command: HostCommand) {
  if (command === 'host.handshake') return 'bridge'
  if (command.startsWith('generation.')) return 'provider'
  if (command.startsWith('canvas.')) return 'photoshop'
  if (command.startsWith('reference.') || command === 'asset.save') return 'file'
  return 'host-command'
}

const CONTEXT_NOTIFICATION_EVENTS: NotificationEvent[] = [
  { event: 'open' },
  { event: 'close' },
  { event: 'select' },
  { event: 'set' },
  { event: 'make' },
  { event: 'delete' },
  { event: 'canvasSize' },
  { event: 'imageSize' },
  { event: 'crop' }
]

function getAdobeUxpRuntime() {
  const require = (globalThis as { require?: (name: string) => any }).require
  if (typeof require !== 'function') throw new Error('Photoshop UXP runtime is unavailable.')
  return require('uxp')
}

function getPhotoshopActionNotifications(): PhotoshopActionNotifications | undefined {
  const require = (globalThis as { require?: (name: string) => any }).require
  if (typeof require !== 'function') return undefined
  return require('photoshop')?.action as PhotoshopActionNotifications | undefined
}

function getPlatform(): 'win32' | 'darwin' {
  const require = (globalThis as { require?: (name: string) => any }).require
  const hostPlatform = typeof require === 'function' ? require('os')?.platform?.() : undefined
  const platform = String(hostPlatform ?? (globalThis.navigator as Navigator & { platform?: string }).platform ?? '').toLowerCase()
  return platform.includes('mac') ? 'darwin' : 'win32'
}

function getTheme(): 'light' | 'dark' {
  try {
    if (
      globalThis.matchMedia?.('(prefers-color-scheme: light)').matches
      || globalThis.matchMedia?.('(prefers-color-scheme: lightest)').matches
    ) return 'light'
  } catch {
    // Older UXP versions may not expose matchMedia to plugin JavaScript.
  }
  return 'dark'
}

function getDocumentContext(hostVersion: string) {
  const adobeUxpRuntime = getAdobeUxpRuntime()
  try {
    const context = readCanvasDiagnosticContext()
    return {
      ready: true,
      hostVersion,
      photoshopVersion: context.photoshopVersion ?? '',
      uxpVersion: adobeUxpRuntime?.versions?.uxp ?? adobeUxpRuntime?.version ?? '',
      platform: getPlatform(),
      theme: getTheme(),
      document: {
        id: String(context.document.id),
        name: context.document.name || readActiveDocumentLabel(),
        width: Number(context.document.width) || 1,
        height: Number(context.document.height) || 1
      },
      capabilities: [...HOST_COMMANDS]
    }
  } catch {
    return {
      ready: true,
      hostVersion,
      photoshopVersion: '',
      uxpVersion: adobeUxpRuntime?.versions?.uxp ?? adobeUxpRuntime?.version ?? '',
      platform: getPlatform(),
      theme: getTheme(),
      capabilities: [...HOST_COMMANDS]
    }
  }
}

export class CommandRegistry {
  readonly assets: AssetStore
  private readonly files: FileAssetService
  private readonly history: HistoryStore
  private readonly diagnostics = new DiagnosticStore()
  private readonly provider: ProviderRuntime
  private readonly confirmations: HostConfirmationController
  private readonly handlers: Record<HostCommand, CommandHandler>
  private readonly hostVersion: string
  private readonly session: SessionManager
  private readonly emit: EventEmitter
  private notificationAction?: PhotoshopActionNotifications
  private notificationTimer?: ReturnType<typeof setTimeout>
  private notificationAttached = false
  private destroyed = false
  private workspaceClientNonce?: string
  private readonly notificationListener: NotificationListener = () => {
    if (this.destroyed) return
    if (this.notificationTimer) clearTimeout(this.notificationTimer)
    this.notificationTimer = setTimeout(() => {
      this.notificationTimer = undefined
      if (!this.destroyed) this.emit('host.contextChanged', getDocumentContext(this.hostVersion))
    }, 120)
  }

  constructor(
    hostVersion: string,
    session: SessionManager,
    emit: EventEmitter,
    confirmations: HostConfirmationController = createHostConfirmationController()
  ) {
    this.hostVersion = hostVersion
    this.session = session
    this.emit = emit
    this.confirmations = confirmations
    this.assets = new AssetStore((assetId, reason) => {
      this.emit('asset.invalidated', {
        assetId,
        reason: reason === 'expired' ? '资产已过期' : '资产缓存空间不足'
      })
    })
    this.history = new HistoryStore(this.assets)
    this.files = new FileAssetService(this.assets)
    this.provider = createProviderRuntime(this.assets, (command, payload) => {
      this.recordRuntimeEvent(command, payload)
      this.emit(command, payload)
    }, async (entry) => {
      await this.history.upsert(entry)
    })
    this.handlers = {
      'host.handshake': async (payload) => {
        const clientNonce = typeof payload?.clientNonce === 'string' ? payload.clientNonce : ''
        if (this.workspaceClientNonce && this.workspaceClientNonce !== clientNonce) this.assets.resetWorkspace()
        this.workspaceClientNonce = clientNonce
        return {
          sessionId: this.session.sessionId,
          protocolVersion: PROTOCOL_VERSION,
          hostNonce: this.session.hostNonce,
          clientNonce,
          context: getDocumentContext(this.hostVersion)
        }
      },
      'host.getContext': async () => getDocumentContext(this.hostVersion),
      'host.openReleasePage': async () => {
        const shell = getAdobeUxpRuntime().shell
        if (!shell?.openExternal) throw new Error('无法打开发布页面')
        await shell.openExternal(OFFICIAL_RELEASE_PAGE)
        return { opened: true }
      },
      'settings.get': async () => getSettings(),
      'settings.save': async (payload) => saveSettings(payload ?? {}),
      'history.list': async (payload) => this.history.list(
        typeof payload?.cursor === 'string' ? payload.cursor : undefined,
        typeof payload?.limit === 'number' ? payload.limit : 30
      ),
      'history.upsert': async (payload) => this.history.upsert(payload?.entry as HistoryUpsertEntry),
      'history.clear': async () => {
        await this.provider.pauseAndDrain()
        try {
          return await this.history.clear()
        } finally {
          this.provider.resume()
        }
      },
      'credential.set': async (payload) => setCredential(payload ?? {}),
      'credential.remove': async (payload) => removeCredential(payload ?? {}),
      'canvas.captureVisible': async () => this.addCaptured('visible', await canvasPrimitiveService.captureVisibleImage()),
      'canvas.captureSelection': async () => this.addCaptured('selection', await canvasPrimitiveService.captureSelectionImage()),
      'canvas.captureLayer': async () => this.addCaptured('layer', await canvasPrimitiveService.captureSelectedLayerImage()),
      'canvas.readSize': async () => canvasPrimitiveService.readCanvasSize(),
      'reference.pickFile': async () => this.files.pickReference(),
      'reference.readClipboard': async () => this.files.readClipboardReference(),
      'reference.importImageChunk': async (payload) => this.files.importImageChunk(payload as never),
      'generation.start': async (payload) => this.provider.start(payload as never),
      'generation.cancel': async (payload) => this.provider.cancel(String(payload?.taskId ?? '')),
      'generation.testConfig': async (payload) => this.provider.testConfig(String(payload?.configId ?? '')),
      'canvas.placeAsset': async (payload) => this.placeAsset(String(payload?.assetId ?? ''), payload?.target as PlacementTarget),
      'asset.save': async (payload) => this.confirmations.run(
        'asset.save',
        () => this.files.save(String(payload?.assetId ?? ''))
      ),
      'asset.readOriginal': async (payload) => this.assets.readOriginal(String(payload?.assetId ?? ''), Number(payload?.offset ?? 0)),
      'asset.retain': async (payload) => this.assets.retainWorkspace(payload?.assetId),
      'asset.release': async (payload) => this.assets.release(payload?.assetId),
      'diagnostics.export': async () => this.confirmations.run('diagnostics.export', () => this.diagnostics.export()),
      'storage.clearAll': async () => this.confirmations.run('storage.clearAll', () => this.clearAllLocalData())
    }
    void this.attachContextNotifications()
  }

  async invoke(request: BridgeEnvelope<Record<string, unknown> | undefined>) {
    const handler = this.handlers[request.command as HostCommand]
    if (!handler) throw new Error('此操作不可用')
    const startedAt = Date.now()
    const clearingAll = request.command === 'storage.clearAll'
    if (!clearingAll) await this.diagnostics.record({ category: diagnosticCategory(request.command as HostCommand), operation: request.command, phase: 'start', details: { messageId: request.messageId } }).catch(() => undefined)
    try {
      const result = await handler(request.payload)
      if (!clearingAll) await this.diagnostics.record({ category: diagnosticCategory(request.command as HostCommand), operation: request.command, phase: 'success', durationMs: Date.now() - startedAt, details: { messageId: request.messageId } }).catch(() => undefined)
      return result
    } catch (error) {
      await this.diagnostics.record({
        category: diagnosticCategory(request.command as HostCommand),
        operation: request.command,
        phase: 'error',
        durationMs: Date.now() - startedAt,
        details: {
          messageId: request.messageId,
          errorName: error instanceof Error ? error.name : 'Error',
          errorCode: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'HOST_COMMAND_FAILED'
        }
      }).catch(() => undefined)
      throw error
    }
  }

  recordBridgeValidationFailure(error: unknown, command?: string) {
    this.diagnostics.record({
      category: 'bridge',
      operation: command && command.length <= 256 ? command : 'message-validation',
      phase: 'error',
      details: {
        errorCode: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'INVALID_MESSAGE'
      }
    })
  }

  destroy() {
    this.destroyed = true
    if (this.notificationTimer) clearTimeout(this.notificationTimer)
    this.notificationTimer = undefined
    if (this.notificationAttached && this.notificationAction?.removeNotificationListener) {
      try {
        void Promise.resolve(
          this.notificationAction.removeNotificationListener(CONTEXT_NOTIFICATION_EVENTS, this.notificationListener)
        ).catch(() => undefined)
      } catch {
        // Photoshop notification cleanup is best-effort during panel teardown.
      }
    }
    this.notificationAttached = false
    this.confirmations.destroy()
    this.provider.destroy()
    this.assets.destroy()
  }

  private async attachContextNotifications() {
    const action = getPhotoshopActionNotifications()
    if (!action?.addNotificationListener) return
    this.notificationAction = action
    try {
      await action.addNotificationListener(CONTEXT_NOTIFICATION_EVENTS, this.notificationListener)
      if (this.destroyed) {
        await action.removeNotificationListener?.(CONTEXT_NOTIFICATION_EVENTS, this.notificationListener)
        return
      }
      this.notificationAttached = true
    } catch (error) {
      this.diagnostics.record({
        category: 'host-context',
        operation: 'attach-notifications',
        phase: 'error',
        details: { errorName: error instanceof Error ? error.name : 'Error' }
      })
    }
  }

  private recordRuntimeEvent(command: HostEventName, payload: unknown) {
    if (!payload || typeof payload !== 'object') return
    const value = payload as Record<string, unknown>
    if (command === 'generation.progress') {
      this.diagnostics.record({
        category: 'provider',
        operation: 'generation.progress',
        phase: value.phase === 'failed' ? 'error' : value.phase === 'completed' ? 'success' : 'notice',
        details: {
          taskId: typeof value.taskId === 'string' ? value.taskId.slice(0, 256) : '',
          taskPhase: typeof value.phase === 'string' ? value.phase.slice(0, 32) : '',
          elapsedSeconds: Number.isFinite(value.elapsedSeconds) ? Number(value.elapsedSeconds) : 0,
          ...(Number.isFinite(value.attempt) ? { attempt: Number(value.attempt) } : {})
        }
      })
      return
    }
    if (command === 'generation.completed' || command === 'generation.failed') {
      this.diagnostics.record({
        category: 'provider',
        operation: command,
        phase: command === 'generation.completed' ? 'success' : 'error',
        details: {
          taskId: typeof value.taskId === 'string' ? value.taskId.slice(0, 256) : '',
          ...(Array.isArray(value.assets) ? { assetCount: value.assets.length } : {}),
          ...(value.error && typeof value.error === 'object' && 'code' in value.error
            ? { errorCode: String((value.error as Record<string, unknown>).code) }
            : {})
        }
      })
    }
  }

  private async clearAllLocalData() {
    await this.provider.pauseAndDrain()
    try {
      await clearAllSettingsAndCredentials()
      await this.history.clearAllLocalData()
      await this.diagnostics.clear()
      return {
        cleared: true,
        deleted: ['credentials', 'settings', 'history', 'assets', 'diagnostics'] as const
      }
    } finally {
      this.provider.resume()
    }
  }

  private async addCaptured(source: 'visible' | 'selection' | 'layer', image: Awaited<ReturnType<typeof canvasPrimitiveService.captureVisibleImage>>) {
    const context = getDocumentContext(this.hostVersion)
    return this.assets.add(source, image, { documentId: context.document?.id })
  }

  private async placeAsset(assetId: string, target: PlacementTarget) {
    const asset = await this.assets.getOrRestore(assetId)
    const image = asset.image
    let resolvedTarget = target
    if (!target || typeof target !== 'object') throw new Error('置入目标无效')
    if (target.type === 'current-selection') {
      await canvasPrimitiveService.insertImageFromPreviewToSelection(image)
    } else if (target.type === 'full-canvas') {
      await canvasPrimitiveService.insertImageFromPreviewToFullCanvas(image)
    } else if (target.type === 'reference-selection') {
      const reference = await this.assets.getOrRestore(target.referenceAssetId)
      const currentDocumentId = getDocumentContext(this.hostVersion).document?.id
      const placement = resolveReferenceSelectionPlacement(target, reference.ref, currentDocumentId)
      resolvedTarget = placement.target
      await canvasPrimitiveService.insertImageFromPreview(image, placement.bounds, reference.ref.documentId)
    } else {
      const canvas = canvasPrimitiveService.readCanvasSize()
      const size = target.type === 'original-size'
        ? { width: image.width, height: image.height }
        : { width: Math.min(image.width, canvas.width), height: Math.min(image.height, canvas.height) }
      await canvasPrimitiveService.insertImageFromPreview(image, { left: 0, top: 0, ...size })
    }
    return { layerName: `Mugen 插入 ${image.label}`, target: resolvedTarget }
  }

}

export function publicHostError(error: unknown): BridgeError {
  const message = error instanceof Error ? error.message : '宿主操作失败'
  const known = /^(无法|当前|请先|找不到|所选|配置|凭据|资产|图片|文件|剪贴板|置入|请求|会话|工作台|安全存储|本地存储)/.test(message)
  return {
    code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'HOST_COMMAND_FAILED',
    message: known ? message.slice(0, 2048) : '宿主操作失败，请重试',
    recoverable: true
  }
}

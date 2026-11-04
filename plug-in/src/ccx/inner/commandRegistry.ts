import { imageProcessor } from './imageProcessing'
import { HOST_COMMANDS, PROTOCOL_VERSION, type BridgeError, type HistoryUpsertEntry, type HostCommand, type HostEventName, type HostContext, type ImageProcessingWrite, type PlacementTarget } from '@mugen/inner-protocol'
import { canvasPrimitiveService } from '../canvasPrimitiveService'
import { normalizeCcxDiagnosticError } from '../diagnosticTrace'
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
function diagnosticCategory(command: HostCommand) {
  if (command === 'host.handshake') return 'bridge'
  if (command.startsWith('generation.')) return 'provider'
  if (command.startsWith('canvas.')) return 'photoshop'
  if (command.startsWith('reference.') || command === 'asset.save') return 'file'
  return 'host-command'
}

function getAdobeUxpRuntime() {
  const require = (globalThis as { require?: (name: string) => any }).require
  if (typeof require !== 'function') throw new Error('Photoshop UXP runtime is unavailable.')
  return require('uxp')
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

function getHostContext(hostVersion: string): HostContext {
  const uxp = getAdobeUxpRuntime()
  return { ready: true, hostVersion, photoshopVersion: '', uxpVersion: uxp?.versions?.uxp ?? uxp?.version ?? '', platform: getPlatform(), theme: getTheme(), capabilities: [...HOST_COMMANDS] }
}

function getDocumentContext(hostVersion: string): HostContext {
  const context = readCanvasDiagnosticContext()
  return {
    ...getHostContext(hostVersion),
    photoshopVersion: context.photoshopVersion ?? '',
    document: { id: String(context.document.id), name: context.document.name || readActiveDocumentLabel(), width: Number(context.document.width), height: Number(context.document.height) }
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
  private context?: HostContext
  private workspaceClientNonce?: string

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
        if (this.workspaceClientNonce !== clientNonce) {
          if (this.workspaceClientNonce) this.assets.resetWorkspace()
          imageProcessor.connect((request) => this.emit('image.process', request))
        }
        this.workspaceClientNonce = clientNonce
        return {
          sessionId: this.session.sessionId,
          protocolVersion: PROTOCOL_VERSION,
          hostNonce: this.session.hostNonce,
          clientNonce,
          context: this.context ?? getHostContext(this.hostVersion)
        }
      },
      'host.getContext': async () => this.context ?? getHostContext(this.hostVersion),
      'host.openReleasePage': async () => {
        const shell = getAdobeUxpRuntime().shell
        if (!shell?.openExternal) throw new Error('无法打开发布页面')
        await shell.openExternal(OFFICIAL_RELEASE_PAGE)
        return { opened: true }
      },
      'settings.get': async () => {
        const settings = await getSettings()
        this.history.configureLimit(settings.historyLimit)
        return settings
      },
      'settings.save': async (payload) => {
        const settings = await saveSettings(payload ?? {})
        await this.history.setLimit(settings.historyLimit)
        return settings
      },
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
      'canvas.captureVisible': async () => this.capture('visible'),
      'canvas.captureSelection': async () => this.capture('selection'),
      'canvas.captureLayer': async () => this.capture('layer'),
      'canvas.readSize': async () => {
        if (!this.context?.document) throw new Error('请读取图片后获取画布尺寸')
        return { width: this.context.document.width, height: this.context.document.height }
      },
      'image.readChunk': async (payload) => imageProcessor.read(String(payload?.jobId), Number(payload?.offset)),
      'image.writeChunk': async (payload) => imageProcessor.write(payload as ImageProcessingWrite),
      'image.fail': async (payload) => imageProcessor.fail(String(payload?.jobId), String(payload?.message)),
      'reference.pickFile': async () => this.files.pickReference(),
      'reference.readClipboard': async () => this.files.readClipboardReference(),
      'reference.importImageChunk': async (payload) => this.files.importImageChunk(payload as never),
      'generation.start': async (payload) => this.provider.start({ ...payload, canvasSize: payload?.canvasSize ?? (this.context?.document ? { width: this.context.document.width, height: this.context.document.height } : undefined) } as never),
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
  }

  async invoke(request: BridgeEnvelope<Record<string, unknown> | undefined>) {
    const handler = this.handlers[request.command as HostCommand]
    if (!handler) throw new Error('此操作不可用')
    if (request.command.startsWith('image.')) return handler(request.payload)
    const startedAt = Date.now()
    const clearingAll = request.command === 'storage.clearAll'
    if (!clearingAll) await this.diagnostics.record({ category: diagnosticCategory(request.command as HostCommand), operation: request.command, phase: 'start', details: { messageId: request.messageId } }).catch(() => undefined)
    try {
      const result = await handler(request.payload)
      if (!clearingAll) await this.diagnostics.record({ category: diagnosticCategory(request.command as HostCommand), operation: request.command, phase: 'success', durationMs: Date.now() - startedAt, details: { messageId: request.messageId } }).catch(() => undefined)
      return result
    } catch (error) {
      const diagnosticError = normalizeCcxDiagnosticError(error)
      await this.diagnostics.record({
        category: diagnosticCategory(request.command as HostCommand),
        operation: request.command,
        phase: 'error',
        durationMs: Date.now() - startedAt,
        details: {
          messageId: request.messageId,
          errorName: error instanceof Error ? error.name : 'Error',
          errorMessage: diagnosticError.message,
          errorNumber: diagnosticError.number,
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
    imageProcessor.disconnect()
    this.confirmations.destroy()
    this.provider.destroy()
    this.assets.destroy()
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

  private async capture(source: 'visible' | 'selection' | 'layer') {
    const context = getDocumentContext(this.hostVersion)
    const image = await (source === 'visible' ? canvasPrimitiveService.captureVisibleImage() : source === 'selection' ? canvasPrimitiveService.captureSelectionImage() : canvasPrimitiveService.captureSelectedLayerImage())
    this.context = context
    this.emit('host.contextChanged', context)
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

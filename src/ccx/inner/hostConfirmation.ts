export type SensitiveHostCommand = 'canvas.placeAsset' | 'asset.save' | 'diagnostics.export' | 'storage.clearAll'

export type HostConfirmationDescriptor = {
  command: SensitiveHostCommand
  title: string
  message: string
  confirmLabel: string
}

export type HostConfirmationOutcome = 'confirmed' | 'cancelled'

export type HostConfirmationDialogAdapter = {
  show: (descriptor: HostConfirmationDescriptor) => Promise<HostConfirmationOutcome>
  destroy: () => void
}

export type HostConfirmationController = {
  run: <T>(command: SensitiveHostCommand, operation: () => Promise<T> | T) => Promise<T>
  destroy: () => void
}

type ConfirmationErrorCode =
  | 'HOST_CONFIRMATION_CANCELLED'
  | 'HOST_CONFIRMATION_UNAVAILABLE'
  | 'HOST_CONFIRMATION_DESTROYED'

type PendingOperation = {
  descriptor: HostConfirmationDescriptor
  operation: () => Promise<unknown> | unknown
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  stage: 'waiting' | 'executing'
}

type AdobeUxpDialogElement = HTMLDialogElement & {
  uxpShowModal?: (options?: { title?: string }) => Promise<unknown>
}

const confirmationDescriptors: Record<SensitiveHostCommand, HostConfirmationDescriptor> = {
  'canvas.placeAsset': {
    command: 'canvas.placeAsset',
    title: '置入 Photoshop？',
    message: '将生成结果写入当前文档。',
    confirmLabel: '置入'
  },
  'asset.save': {
    command: 'asset.save',
    title: '保存图片？',
    message: '将选择保存位置并写入图片文件。',
    confirmLabel: '继续'
  },
  'diagnostics.export': {
    command: 'diagnostics.export',
    title: '导出诊断日志？',
    message: '日志包含连接、请求阶段和 Photoshop 操作记录，内容已脱敏。',
    confirmLabel: '导出'
  },
  'storage.clearAll': {
    command: 'storage.clearAll',
    title: '清除全部本地数据？',
    message: '将删除 API Key、模型配置、历史记录、生成图片和诊断日志。此操作无法撤销。',
    confirmLabel: '全部清除'
  }
}

export class HostConfirmationError extends Error {
  readonly code: ConfirmationErrorCode

  constructor(code: ConfirmationErrorCode, message: string) {
    super(message)
    this.name = 'HostConfirmationError'
    this.code = code
  }
}

function removeNode(node: Node) {
  const element = node as HTMLElement
  if (typeof element.remove === 'function') {
    element.remove()
    return
  }
  node.parentNode?.removeChild(node)
}

export class DomHostConfirmationDialog implements HostConfirmationDialogAdapter {
  private destroyed = false
  private cancelActive?: () => void

  show(descriptor: HostConfirmationDescriptor): Promise<HostConfirmationOutcome> {
    if (this.destroyed) return Promise.resolve('cancelled')

    const parent = document.body ?? document.documentElement
    if (!parent) return Promise.resolve('cancelled')

    const dialog = document.createElement('dialog') as AdobeUxpDialogElement
    const heading = document.createElement('sp-heading')
    const message = document.createElement('sp-body')
    const actions = document.createElement('div')
    const cancelButton = document.createElement('sp-button')
    const confirmButton = document.createElement('sp-button')

    dialog.style.cssText = 'width:320px;max-width:100%;padding:20px;box-sizing:border-box;background:var(--uxp-host-background-color,#20232a);color:var(--uxp-host-text-color,#f5f7fb);border:1px solid rgba(255,255,255,.16);border-radius:8px;'
    heading.textContent = descriptor.title
    heading.setAttribute('size', 'S')
    message.textContent = descriptor.message
    message.style.cssText = 'display:block;margin-top:10px;line-height:1.5;'
    actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:18px;'
    cancelButton.textContent = '取消'
    cancelButton.setAttribute('variant', 'secondary')
    confirmButton.textContent = descriptor.confirmLabel
    confirmButton.setAttribute('variant', 'cta')
    actions.append(cancelButton, confirmButton)
    dialog.append(heading, message, actions)
    parent.appendChild(dialog)

    return new Promise<HostConfirmationOutcome>((resolve) => {
      let settled = false
      let chosen: HostConfirmationOutcome | undefined

      const finish = (outcome: HostConfirmationOutcome) => {
        if (settled) return
        settled = true
        if (this.cancelActive === cancelActive) this.cancelActive = undefined
        removeNode(dialog)
        resolve(outcome)
      }
      const close = (outcome: HostConfirmationOutcome) => {
        if (settled) return
        chosen = outcome
        try {
          dialog.close(outcome)
        } catch {
          finish(outcome)
          return
        }
        finish(outcome)
      }
      const cancelActive = () => close('cancelled')
      const handleCancel = (event: Event) => {
        event.preventDefault()
        close('cancelled')
      }
      const handleClose = () => finish(chosen ?? 'cancelled')

      this.cancelActive = cancelActive
      cancelButton.addEventListener('click', () => close('cancelled'))
      confirmButton.addEventListener('click', () => close('confirmed'))
      dialog.addEventListener('cancel', handleCancel)
      dialog.addEventListener('close', handleClose)

      try {
        if (typeof dialog.uxpShowModal === 'function') {
          void Promise.resolve(dialog.uxpShowModal({ title: descriptor.title })).then(
            () => finish(chosen ?? 'cancelled'),
            () => finish('cancelled')
          )
        } else if (typeof dialog.showModal === 'function') {
          dialog.showModal()
        } else {
          finish('cancelled')
        }
      } catch {
        finish('cancelled')
      }
    })
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.cancelActive?.()
    this.cancelActive = undefined
  }
}

export class HostConfirmationGate implements HostConfirmationController {
  private readonly adapter: HostConfirmationDialogAdapter
  private readonly queue: PendingOperation[] = []
  private active?: PendingOperation
  private destroyed = false

  constructor(adapter: HostConfirmationDialogAdapter) {
    this.adapter = adapter
  }

  run<T>(command: SensitiveHostCommand, operation: () => Promise<T> | T): Promise<T> {
    if (this.destroyed) {
      return Promise.reject(new HostConfirmationError('HOST_CONFIRMATION_DESTROYED', '工作台已关闭'))
    }

    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        descriptor: confirmationDescriptors[command],
        operation,
        resolve: (value) => resolve(value as T),
        reject,
        stage: 'waiting'
      })
      this.pump()
    })
  }

  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    const error = new HostConfirmationError('HOST_CONFIRMATION_DESTROYED', '工作台已关闭')
    const waiting = this.active?.stage === 'waiting' ? [this.active] : []
    if (waiting.length) this.active = undefined
    const pending = [...waiting, ...this.queue.splice(0)]
    for (const operation of pending) operation.reject(error)
    this.adapter.destroy()
  }

  private pump() {
    if (this.destroyed || this.active) return
    const next = this.queue.shift()
    if (!next) return
    this.active = next
    void this.process(next)
  }

  private async process(pending: PendingOperation) {
    try {
      let outcome: HostConfirmationOutcome
      try {
        outcome = await this.adapter.show(pending.descriptor)
      } catch {
        throw new HostConfirmationError('HOST_CONFIRMATION_UNAVAILABLE', '当前无法显示确认窗口')
      }
      if (this.destroyed || this.active !== pending) {
        throw new HostConfirmationError('HOST_CONFIRMATION_DESTROYED', '工作台已关闭')
      }
      if (outcome !== 'confirmed') {
        throw new HostConfirmationError('HOST_CONFIRMATION_CANCELLED', '当前操作已取消')
      }
      pending.stage = 'executing'
      pending.resolve(await pending.operation())
    } catch (error) {
      pending.reject(error)
    } finally {
      if (this.active === pending) this.active = undefined
      this.pump()
    }
  }
}

export function createHostConfirmationController(): HostConfirmationController {
  return new HostConfirmationGate(new DomHostConfirmationDialog())
}

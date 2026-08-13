import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StartupLog } from './startupLog'
import type { WebViewMessageEvent } from './webviewShell'

type Listener = (event: Record<string, unknown>) => void

class FakeElement {
  readonly children: FakeElement[] = []
  readonly listeners = new Map<string, Listener[]>()
  readonly attributes = new Map<string, string>()
  readonly style: Record<string, string> = { cssText: '' }
  parent?: FakeElement
  textContent = ''
  clientWidth = 320
  clientHeight = 480
  postMessage = vi.fn()
  readonly tagName: string

  constructor(tagName: string) { this.tagName = tagName }

  get firstChild() { return this.children[0] }

  append(...nodes: FakeElement[]) {
    for (const node of nodes) this.appendChild(node)
  }

  appendChild(node: FakeElement) {
    node.parent = this
    this.children.push(node)
    return node
  }

  removeChild(node: FakeElement) {
    const index = this.children.indexOf(node)
    if (index >= 0) this.children.splice(index, 1)
    node.parent = undefined
    return node
  }

  contains(node: FakeElement): boolean {
    return this === node || this.children.some((child) => child.contains(node))
  }

  setAttribute(name: string, value: string) { this.attributes.set(name, value) }
  removeAttribute(name: string) { this.attributes.delete(name) }
  addEventListener(name: string, listener: Listener) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener])
  }
  removeEventListener(name: string, listener: Listener) {
    this.listeners.set(name, (this.listeners.get(name) ?? []).filter((candidate) => candidate !== listener))
  }
  dispatch(name: string, event: Record<string, unknown> = {}) {
    for (const listener of this.listeners.get(name) ?? []) listener({ type: name, ...event })
  }
}

class FakeWindow {
  readonly listeners = new Map<string, Listener[]>()
  innerWidth = 320
  innerHeight = 480
  addEventListener(name: string, listener: Listener) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener])
  }
  removeEventListener(name: string, listener: Listener) {
    this.listeners.set(name, (this.listeners.get(name) ?? []).filter((candidate) => candidate !== listener))
  }
}

function flatten(root: FakeElement): FakeElement[] {
  return [root, ...root.children.flatMap(flatten)]
}

describe('createWebViewShell startup failure UI', () => {
  let root: FakeElement
  let created: FakeElement[]
  let log: { record: ReturnType<typeof vi.fn>; finish: ReturnType<typeof vi.fn>; export: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.useFakeTimers()
    root = new FakeElement('main')
    created = []
    log = {
      record: vi.fn(),
      finish: vi.fn(),
      export: vi.fn(async () => ({ saved: true }))
    }
    vi.stubGlobal('document', {
      createElement: (tagName: string) => {
        const element = new FakeElement(tagName)
        created.push(element)
        return element
      }
    })
    vi.stubGlobal('window', new FakeWindow())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows the load error and downloads this startup log', async () => {
    const { createWebViewShell } = await import('./webviewShell')
    const shell = createWebViewShell({
      mountNode: root as unknown as HTMLElement,
      sessionId: 'session-1',
      hostNonce: 'host-1',
      hostVersion: '1.1.4',
      startupLog: log as unknown as StartupLog,
      onMessage: vi.fn()
    })
    const webview = created.find((element) => element.tagName === 'webview')!

    expect(webview.attributes.get('src')).toBe('https://mugen.catrefuse.com/webui/')
    webview.dispatch('loaderror', { message: 'ERR_CONNECTION_REFUSED', url: 'https://mugen.catrefuse.com/webui/' })

    const failureUi = flatten(root)
    expect(failureUi.map((element) => element.textContent)).toContain('工作台启动失败')
    expect(failureUi.map((element) => element.textContent)).toContain('工作台资源加载失败（ERR_CONNECTION_REFUSED）')
    const downloadButton = failureUi.find((element) => element.textContent === '下载启动日志')!
    downloadButton.dispatch('click')
    await vi.waitFor(() => expect(log.export).toHaveBeenCalledOnce())
    expect(flatten(root).map((element) => element.textContent)).toContain('启动日志已保存')
    expect(log.record).toHaveBeenCalledWith('ccx', 'ccx', 'webview.load.error', expect.anything())
    shell.destroy()
    expect(root.children).toHaveLength(0)
  })

  it('reports a missing Host handshake and cancels the failure timer after readiness', async () => {
    const { createWebViewShell } = await import('./webviewShell')
    const makeShell = () => createWebViewShell({
      mountNode: root as unknown as HTMLElement,
      sessionId: 'session-1',
      hostNonce: 'host-1',
      hostVersion: '1.1.4',
      startupLog: log as unknown as StartupLog,
      onMessage: vi.fn()
    })
    const shell = makeShell()
    const webview = created.find((element) => element.tagName === 'webview')!
    webview.dispatch('loadstop', { url: 'https://mugen.catrefuse.com/webui/#/' })
    expect(webview.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'host.ready' }),
      'https://mugen.catrefuse.com'
    )
    await vi.advanceTimersByTimeAsync(15_000)
    expect(flatten(root).map((element) => element.textContent)).toContain('工作台与 Photoshop 连接超时（15 秒）')
    shell.destroy()

    root = new FakeElement('main')
    created = []
    const readyShell = makeShell()
    const readyWebview = created.find((element) => element.tagName === 'webview')!
    readyWebview.dispatch('loadstop', { url: 'https://mugen.catrefuse.com/webui/#/' })
    expect(readyShell.isTrustedMessage({
      origin: 'https://mugen.catrefuse.com',
      source: readyWebview
    } as unknown as WebViewMessageEvent)).toBe(true)
    expect(readyShell.isTrustedMessage({
      origin: 'https://example.com',
      source: readyWebview
    } as unknown as WebViewMessageEvent)).toBe(false)
    readyShell.markReady()
    expect(log.finish).toHaveBeenCalledWith({ attempt: 1 })
    await vi.advanceTimersByTimeAsync(15_000)
    expect(root.children[0]?.tagName).toBe('webview')
    readyShell.destroy()
  })

  it('rejects local files and other remote origins', async () => {
    const { createWebViewShell } = await import('./webviewShell')
    const shell = createWebViewShell({
      mountNode: root as unknown as HTMLElement,
      sessionId: 'session-1',
      hostNonce: 'host-1',
      hostVersion: '1.1.4',
      startupLog: log as unknown as StartupLog,
      onMessage: vi.fn()
    })
    const webview = created.find((element) => element.tagName === 'webview')!

    webview.dispatch('loadstop', { url: 'file:///C:/Program Files/Adobe/Mugen/webui/index.html' })

    expect(flatten(root).map((element) => element.textContent)).toContain('工作台加载地址未获授权')
    expect(log.record).toHaveBeenCalledWith(
      'ccx',
      'ccx',
      'webview.load.untrusted',
      expect.objectContaining({ attempt: 1 })
    )
    expect(shell.isTrustedMessage({
      origin: 'https://example.com',
      source: webview
    } as unknown as WebViewMessageEvent)).toBe(false)
    shell.destroy()
  })
})

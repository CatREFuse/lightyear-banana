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
  dispatch(name: string, event: Record<string, unknown> = {}) {
    for (const listener of this.listeners.get(name) ?? []) listener({ type: name, ...event })
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
      hostVersion: '1.1.5',
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
    const onMessage = vi.fn()
    const makeShell = () => createWebViewShell({
      mountNode: root as unknown as HTMLElement,
      sessionId: 'session-1',
      hostNonce: 'host-1',
      hostVersion: '1.1.5',
      startupLog: log as unknown as StartupLog,
      onMessage
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
      origin: 'https://mugen.catrefuse.com/webui/',
      source: readyWebview
    } as unknown as WebViewMessageEvent)).toBe(true)
    expect(readyShell.isTrustedMessage({
      origin: 'https://mugen.catrefuse.com/webui/?runtime=uxp#/workspace',
      source: readyWebview
    } as unknown as WebViewMessageEvent)).toBe(true)
    const fakeWindow = window as unknown as FakeWindow
    fakeWindow.dispatch('message', {
      origin: 'https://mugen.catrefuse.com/webui/',
      source: readyWebview,
      data: { command: 'host.handshake' }
    })
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
      origin: 'https://mugen.catrefuse.com/webui/',
      source: readyWebview
    }))
    for (const origin of [
      'https://mugen.catrefuse.com.evil.example/webui/',
      'http://mugen.catrefuse.com/webui/',
      'https://mugen.catrefuse.com:444/webui/',
      'not a url'
    ]) {
      expect(readyShell.isTrustedMessage({
        origin,
        source: readyWebview
      } as unknown as WebViewMessageEvent)).toBe(false)
    }
    expect(readyShell.isTrustedMessage({
      origin: 'https://mugen.catrefuse.com/webui/',
      source: new FakeElement('webview')
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
      hostVersion: '1.1.5',
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
  it('isolates timed-out WebViews from a retry and rejects late messages', async () => {
    const { createWebViewShell } = await import('./webviewShell')
    const onMessage = vi.fn()
    const shell = createWebViewShell({
      mountNode: root as unknown as HTMLElement,
      sessionId: 'session-1', hostNonce: 'host-1', hostVersion: '1.1.5',
      startupLog: log as unknown as StartupLog, onMessage
    })
    const oldWebview = created.find(element => element.tagName === 'webview')!
    await vi.advanceTimersByTimeAsync(20_000)
    flatten(root).find(element => element.textContent === '重试')!.dispatch('click')
    const nextWebview = created.filter(element => element.tagName === 'webview').at(-1)!
    expect(nextWebview).not.toBe(oldWebview)
    const fakeWindow = window as unknown as FakeWindow
    fakeWindow.dispatch('message', { origin: 'https://mugen.catrefuse.com', source: oldWebview, data: { command: 'host.handshake' } })
    oldWebview.dispatch('loadstop', { url: 'https://mugen.catrefuse.com/webui/' })
    expect(onMessage).not.toHaveBeenCalled()
    expect(nextWebview.postMessage).not.toHaveBeenCalled()
    nextWebview.dispatch('loadstop', { url: 'https://mugen.catrefuse.com/webui/' })
    expect(nextWebview.postMessage).toHaveBeenCalledOnce()
    shell.markReady()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(root.children[0]).toBe(nextWebview)
    shell.destroy()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('logs navigation, native error codes and safe message metadata', async () => {
    const { createWebViewShell } = await import('./webviewShell')
    const onMessage = vi.fn()
    const shell = createWebViewShell({
      mountNode: root as unknown as HTMLElement,
      sessionId: 'session-1', hostNonce: 'host-1', hostVersion: '1.1.5',
      startupLog: log as unknown as StartupLog, onMessage
    })
    const webview = created.find(element => element.tagName === 'webview')!
    webview.dispatch('loadstart', { url: 'https://mugen.catrefuse.com/webui/' })
    expect(log.record).toHaveBeenCalledWith('webui', 'ccx', 'webview.load.navigation', expect.objectContaining({ attempt: 1, phase: 'navigation' }))
    ;(window as unknown as FakeWindow).dispatch('message', {
      origin: 'https://unrelated.example', source: webview,
      data: { command: 'host.handshake', payload: { privateValue: 'do-not-log' } }
    })
    expect(log.record).toHaveBeenCalledWith('webui', 'ccx', 'bridge.receive', expect.objectContaining({ rejectedReason: 'origin-mismatch' }))
    expect(JSON.stringify(log.record.mock.calls)).not.toContain('do-not-log')
    expect(onMessage).not.toHaveBeenCalled()
    webview.dispatch('loaderror', { url: 'https://mugen.catrefuse.com/webui/', code: -105, message: 'ERR_NAME_NOT_RESOLVED' })
    expect(log.record).toHaveBeenCalledWith('ccx', 'ccx', 'webview.load.error', expect.objectContaining({ phase: 'navigation', details: expect.objectContaining({ code: -105 }) }))
    expect(vi.getTimerCount()).toBe(0)
    shell.destroy()
  })

  it('accepts same-origin redirects and ignores repeated completion events', async () => {
    const { createWebViewShell } = await import('./webviewShell')
    const shell = createWebViewShell({
      mountNode: root as unknown as HTMLElement,
      sessionId: 'session-1', hostNonce: 'host-1', hostVersion: '1.1.5',
      startupLog: log as unknown as StartupLog, onMessage: vi.fn()
    })
    const webview = created.find(element => element.tagName === 'webview')!
    webview.dispatch('loadstart', { url: 'https://mugen.catrefuse.com/webui/redirected/' })
    webview.dispatch('loadstop', { url: 'https://mugen.catrefuse.com/webui/redirected/' })
    webview.dispatch('loadstop', { url: 'https://mugen.catrefuse.com/webui/redirected/' })
    expect(webview.postMessage).toHaveBeenCalledOnce()
    shell.markReady()
    shell.markReady()
    expect(log.finish).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(35_000)
    expect(root.children[0]).toBe(webview)
    shell.destroy()
  })

  it('rejects cross-origin redirects before sending host.ready', async () => {
    const { createWebViewShell } = await import('./webviewShell')
    const shell = createWebViewShell({
      mountNode: root as unknown as HTMLElement,
      sessionId: 'session-1', hostNonce: 'host-1', hostVersion: '1.1.5',
      startupLog: log as unknown as StartupLog, onMessage: vi.fn()
    })
    const webview = created.find(element => element.tagName === 'webview')!
    webview.dispatch('loadstop', { url: 'https://imini-test.catrefuse.com/' })
    expect(webview.postMessage).not.toHaveBeenCalled()
    expect(log.record).toHaveBeenCalledWith('ccx', 'ccx', 'webview.load.untrusted', expect.anything())
    shell.destroy()
  })

  it('arms timers before navigation and ready callbacks can complete immediately', async () => {
    const { createWebViewShell } = await import('./webviewShell')
    const originalSetAttribute = FakeElement.prototype.setAttribute
    const setAttribute = vi.spyOn(FakeElement.prototype, 'setAttribute').mockImplementation(function(this: FakeElement, name, value) {
      originalSetAttribute.call(this, name, value)
      if (name === 'src') this.dispatch('loadstop', { url: value })
    })
    const shell = createWebViewShell({
      mountNode: root as unknown as HTMLElement,
      sessionId: 'session-1', hostNonce: 'host-1', hostVersion: '1.1.5',
      startupLog: log as unknown as StartupLog, onMessage: vi.fn()
    })
    setAttribute.mockRestore()
    const webview = created.find(element => element.tagName === 'webview')!
    expect(webview.postMessage).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(1)
    shell.markReady()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(35_000)
    expect(root.children[0]).toBe(webview)
    shell.destroy()
  })

})

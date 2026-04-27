import { createApp, type App as VueApp } from 'vue'
import '../style.css'
import App from '../App.vue'
import { createNamedLayer } from './photoshopHost'

type UxpRequire = (name: string) => any
const LOG_PREFIX = '[Lightyear Banana]'

const uxpGlobal = globalThis as typeof globalThis & {
  Element?: typeof Element
  SVGElement?: typeof SVGElement
  __LIGHTYEAR_BROWSER_PREVIEW__?: boolean
  require?: UxpRequire
}

if (typeof uxpGlobal.SVGElement === 'undefined' && typeof uxpGlobal.Element !== 'undefined') {
  uxpGlobal.SVGElement = uxpGlobal.Element as typeof SVGElement
}

let app: VueApp<Element> | null = null

function writeBootState(message: string, tone: 'info' | 'error' = 'info') {
  const mountNode = document.getElementById('app')
  if (!mountNode) {
    return
  }

  mountNode.replaceChildren()

  const shell = document.createElement('main')
  shell.className = 'panel-shell boot-panel'
  shell.setAttribute('data-tone', tone)

  const hero = document.createElement('section')
  hero.className = 'hero'

  const eyebrow = document.createElement('p')
  eyebrow.className = 'eyebrow'
  eyebrow.textContent = 'Photoshop UXP'

  const title = document.createElement('h1')
  title.textContent = 'Lightyear Banana'

  const body = document.createElement('p')
  body.className = 'lede'
  body.textContent = message

  hero.append(eyebrow, title, body)
  shell.append(hero)
  mountNode.append(shell)
}

function getUxpRequire(): UxpRequire {
  if (typeof uxpGlobal.require !== 'function') {
    throw new Error('UXP runtime is unavailable.')
  }
  return uxpGlobal.require
}

function mountPanel() {
  if (app) {
    return
  }

  const mountNode = document.getElementById('app')
  if (!mountNode) {
    throw new Error('Vue mount node #app was not found.')
  }

  try {
    console.log(`${LOG_PREFIX} mounting Vue panel`)
    writeBootState('正在启动面板')
    app = createApp(App, { runtime: uxpGlobal.__LIGHTYEAR_BROWSER_PREVIEW__ ? 'browser' : 'photoshop-uxp' })
    app.mount(mountNode)
    console.log(`${LOG_PREFIX} Vue panel mounted`)
    console.log(`${LOG_PREFIX} panel text`, document.body.textContent?.replace(/\s+/g, ' ').trim())
  } catch (error) {
    const message = error instanceof Error ? error.message : '面板启动失败'
    console.error(`${LOG_PREFIX} ${message}`, error)
    writeBootState(message, 'error')
  }
}

console.log(`${LOG_PREFIX} script loaded`, Boolean(document.getElementById('app')))
const { entrypoints } = getUxpRequire()('uxp')

entrypoints.setup({
  commands: {
    async createLayer() {
      console.log(`${LOG_PREFIX} command createLayer`)
      await createNamedLayer()
      console.log(`${LOG_PREFIX} command createLayer done`)
    }
  },
  panels: {
    panel: {
      create() {
        console.log(`${LOG_PREFIX} panel create`)
        mountPanel()
      },
      show() {
        console.log(`${LOG_PREFIX} panel show`)
        mountPanel()
      }
    }
  }
})

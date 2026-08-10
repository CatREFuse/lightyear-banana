import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import path from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { isDisallowedProductionHostname, resolveReleaseUrl } from './scripts/production-origin-policy.mjs'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))
const uxpOutDir = path.resolve(projectRoot, 'dist/ps-uxp')

type LightyearEnvironment = 'development' | 'test' | 'production'
type SourceManifest = {
  version?: unknown
  requiredPermissions?: {
    network?: { domains?: string[] | 'all' }
    webview?: { domains?: string[] }
  }
}

const environmentValues = new Set<LightyearEnvironment>(['development', 'test', 'production'])

const fallbackDevelopmentWebUiUrl = 'http://localhost:4173/'

function readSourceManifest(): SourceManifest {
  return JSON.parse(readFileSync(path.join(projectRoot, 'plugin', 'manifest.json'), 'utf8')) as SourceManifest
}

function resolveCcxVersion() {
  const version = readSourceManifest().version
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('plugin/manifest.json must contain a semantic version such as 1.0.0.')
  }
  return version
}

function readKeyEnv() {
  const filePath = path.join(projectRoot, 'key.env')
  if (!existsSync(filePath)) return {} as Record<string, string>

  return Object.fromEntries(
    readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const separator = line.indexOf('=')
        const key = line.slice(0, separator).trim()
        const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
        return [key, value]
      })
  )
}

function resolveInnerWebUiUrl(mode: string) {
  const viteEnv = loadEnv(mode, projectRoot, '')
  const keyEnv = readKeyEnv()
  const configured = process.env.INNER_WEBUI_URL
    ?? keyEnv.INNER_WEBUI_URL
    ?? (mode === 'production' ? undefined : viteEnv.INNER_WEBUI_URL)
  if (mode === 'production' && !configured?.trim()) {
    throw new Error('Production INNER_WEBUI_URL must be supplied by key.env or the process environment.')
  }
  const url = new URL(configured?.trim() || fallbackDevelopmentWebUiUrl)
  const localDevelopment = mode !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)

  if (url.protocol !== 'https:' && !localDevelopment) {
    throw new Error('INNER_WEBUI_URL must use HTTPS outside local development.')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('INNER_WEBUI_URL must not contain credentials, query parameters, or fragments.')
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  if (mode === 'production' && url.pathname !== '/inner/v1/') {
    throw new Error('Production INNER_WEBUI_URL must use the versioned /inner/v1/ path.')
  }
  if (mode === 'production' && isDisallowedProductionHostname(url.hostname)) {
    throw new Error('Production INNER_WEBUI_URL must use the approved deployment domain.')
  }
  return url
}

function resolveLightyearEnvironment(mode: string): LightyearEnvironment {
  const env = loadEnv(mode, projectRoot, '')
  const rawEnvironment = env.VITE_LIGHTYEAR_ENV ?? env.LIGHTYEAR_ENV

  if (environmentValues.has(rawEnvironment as LightyearEnvironment)) {
    return rawEnvironment as LightyearEnvironment
  }

  return mode === 'production' ? 'production' : 'development'
}

function uxpPostBuildPlugin(innerWebUiUrl: URL): Plugin {
  return {
    name: 'uxp-post-build',
    closeBundle() {
      const panelPath = path.join(uxpOutDir, 'uxp-panel.html')
      const manifestSource = path.join(projectRoot, 'plugin', 'manifest.json')
      const manifestTarget = path.join(uxpOutDir, 'manifest.json')
      const iconsSource = path.join(projectRoot, 'plugin', 'icons')
      const iconsTarget = path.join(uxpOutDir, 'icons')

      let html = readFileSync(panelPath, 'utf8')
      html = html
        .replace(/\s+type=(["'])module\1/g, '')
        .replace(/\s+crossorigin(?:=(["']).*?\1)?/g, '')

      const scripts: string[] = []
      html = html.replace(/\s*<script\s+src=(["'])([^"']+)\1\s*><\/script>/g, (tag) => {
        scripts.push(tag.trim())
        return ''
      })
      if (scripts.length) {
        html = html.replace(/\s*<\/body>/, `\n    ${scripts.join('\n    ')}\n  </body>`)
      }
      writeFileSync(panelPath, html)
      mkdirSync(uxpOutDir, { recursive: true })
      const manifest = readSourceManifest()
      const origin = innerWebUiUrl.origin
      if (manifest.requiredPermissions?.webview) {
        manifest.requiredPermissions.webview.domains = [origin]
      }
      const networkDomains = manifest.requiredPermissions?.network?.domains
      if (Array.isArray(networkDomains) && !networkDomains.includes(origin)) {
        networkDomains.unshift(origin)
      }
      writeFileSync(manifestTarget, `${JSON.stringify(manifest, null, 2)}\n`)
      rmSync(iconsTarget, { recursive: true, force: true })
      mkdirSync(iconsTarget, { recursive: true })
      for (const iconFile of readdirSync(iconsSource)) {
        copyFileSync(path.join(iconsSource, iconFile), path.join(iconsTarget, iconFile))
      }
    }
  }
}

export default defineConfig(({ mode }) => {
  const lightyearEnvironment = resolveLightyearEnvironment(mode)
  const innerWebUiUrl = resolveInnerWebUiUrl(mode)
  const releaseUrl = resolveReleaseUrl({
    processEnvironment: process.env,
    keyEnvironment: readKeyEnv(),
    viteEnvironment: loadEnv(mode, projectRoot, ''),
    webviewOrigin: innerWebUiUrl.origin,
    production: mode === 'production'
  })
  const ccxVersion = resolveCcxVersion()

  return {
    base: './',
    define: {
      __LIGHTYEAR_APP_ENV__: JSON.stringify(lightyearEnvironment),
      __INNER_WEBUI_URL__: JSON.stringify(innerWebUiUrl.href),
      __INNER_RELEASE_URL__: JSON.stringify(releaseUrl.href),
      __CCX_VERSION__: JSON.stringify(ccxVersion)
    },
    publicDir: false,
    plugins: [vue(), uxpPostBuildPlugin(innerWebUiUrl)],
    build: {
      modulePreload: {
        polyfill: false
      },
      outDir: uxpOutDir,
      emptyOutDir: true,
      sourcemap: lightyearEnvironment !== 'production',
      rollupOptions: {
        input: fileURLToPath(new URL('./uxp-panel.html', import.meta.url)),
        output: {
          format: 'iife'
        }
      }
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url))
      }
    }
  }
})

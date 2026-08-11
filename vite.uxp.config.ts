import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import path from 'node:path'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { isDisallowedProductionHostname, resolveReleaseUrl } from './scripts/production-origin-policy.mjs'
import { resolveUxpMugenEnvironment } from './scripts/uxp-environment-policy.mjs'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))
const uxpOutDir = path.resolve(projectRoot, 'dist/ps-uxp')

type SourceManifest = {
  version?: unknown
  requiredPermissions?: {
    network?: { domains?: string[] | 'all' }
    webview?: { domains?: string[]; allowLocalRendering?: string; enableMessageBridge?: string }
  }
}

const fallbackDevelopmentWebUiUrl = 'http://localhost:4173/'
const productionInnerWebUiUrl = 'https://mugen.catrefuse.com/webui/'

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
    ?? (mode === 'production' ? productionInnerWebUiUrl : viteEnv.INNER_WEBUI_URL)
  const url = new URL(configured?.trim() || fallbackDevelopmentWebUiUrl)
  const localDevelopment = mode !== 'production' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)

  if (url.protocol !== 'https:' && !localDevelopment) {
    throw new Error('INNER_WEBUI_URL must use HTTPS outside local development.')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('INNER_WEBUI_URL must not contain credentials, query parameters, or fragments.')
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  if (mode === 'production' && url.href !== productionInnerWebUiUrl) {
    throw new Error(`Production INNER_WEBUI_URL must be ${productionInnerWebUiUrl}`)
  }
  if (mode === 'production' && isDisallowedProductionHostname(url.hostname)) {
    throw new Error('Production INNER_WEBUI_URL must use the approved deployment domain.')
  }
  return url
}

function copyDirectorySync(source: string, target: string) {
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name)
    const targetPath = path.join(target, entry.name)
    if (entry.isDirectory()) {
      copyDirectorySync(sourcePath, targetPath)
      continue
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported Inner WebUI build entry: ${entry.name}`)
    }
    copyFileSync(sourcePath, targetPath)
  }
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
      const webUiSource = path.join(projectRoot, 'apps', 'inner-webui', 'dist')
      const webUiTarget = path.join(uxpOutDir, 'webui')

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
        manifest.requiredPermissions.webview.domains = []
        manifest.requiredPermissions.webview.allowLocalRendering = 'yes'
        manifest.requiredPermissions.webview.enableMessageBridge = 'localOnly'
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
      if (!existsSync(path.join(webUiSource, 'index.html'))) {
        throw new Error('Inner WebUI build not found. Run npm run build:inner-webui first.')
      }
      rmSync(webUiTarget, { recursive: true, force: true })
      copyDirectorySync(webUiSource, webUiTarget)
    }
  }
}

export default defineConfig(({ mode }) => {
  const viteEnvironment = loadEnv(mode, projectRoot, '')
  const mugenEnvironment = resolveUxpMugenEnvironment(mode, {
    VITE_MUGEN_ENV: process.env.VITE_MUGEN_ENV ?? viteEnvironment.VITE_MUGEN_ENV,
    MUGEN_ENV: process.env.MUGEN_ENV ?? viteEnvironment.MUGEN_ENV
  })
  const innerWebUiUrl = resolveInnerWebUiUrl(mode)
  const releaseUrl = resolveReleaseUrl({
    processEnvironment: process.env,
    keyEnvironment: readKeyEnv(),
    viteEnvironment,
    webviewOrigin: innerWebUiUrl.origin,
    production: mode === 'production'
  })
  const ccxVersion = resolveCcxVersion()

  return {
    base: './',
    define: {
      __MUGEN_APP_ENV__: JSON.stringify(mugenEnvironment),
      __INNER_WEBUI_URL__: JSON.stringify('plugin:/webui/index.html'),
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
      sourcemap: mugenEnvironment !== 'production',
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

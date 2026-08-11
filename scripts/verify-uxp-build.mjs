import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const pluginDir = path.join(projectRoot, 'dist', 'ps-uxp')
const manifestPath = path.join(pluginDir, 'manifest.json')
const panelPath = path.join(pluginDir, 'uxp-panel.html')
const browserPreviewPath = path.join(pluginDir, 'browser-preview.html')
const assetsDir = path.join(pluginDir, 'assets')
const iconsDir = path.join(pluginDir, 'icons')
const webUiDir = path.join(pluginDir, 'webui')
const sourceManifestPath = path.join(projectRoot, 'plugin', 'manifest.json')
const standaloneManifestPath = path.join(projectRoot, 'standalone-uxp-plugin', 'manifest.json')
const forbiddenProductionText = ['cake.catrefuse.com', 'webui.catrefuse.com', 'inner-webui.invalid']

async function assertFile(filePath, label) {
  const info = await stat(filePath)
  if (!info.isFile()) {
    throw new Error(`${label} is not a file: ${filePath}`)
  }
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const sourceManifest = JSON.parse(await readFile(sourceManifestPath, 'utf8'))
const standaloneManifest = JSON.parse(await readFile(standaloneManifestPath, 'utf8'))
await assertFile(panelPath, 'uxp-panel.html')
await assertFile(path.join(iconsDir, 'dark@1x.png'), 'panel dark 1x icon')
await assertFile(path.join(iconsDir, 'dark@2x.png'), 'panel dark 2x icon')
await assertFile(path.join(iconsDir, 'light@1x.png'), 'panel light 1x icon')
await assertFile(path.join(iconsDir, 'light@2x.png'), 'panel light 2x icon')
await assertFile(path.join(iconsDir, 'icon_D@1x.png'), 'dark 1x icon')
await assertFile(path.join(iconsDir, 'icon_D@2x.png'), 'dark 2x icon')
await assertFile(path.join(iconsDir, 'icon_N@1x.png'), 'light 1x icon')
await assertFile(path.join(iconsDir, 'icon_N@2x.png'), 'light 2x icon')
await assertFile(path.join(webUiDir, 'index.html'), 'bundled WebUI index')

try {
  await stat(browserPreviewPath)
  throw new Error('Production UXP builds must not contain browser-preview.html.')
} catch (error) {
  if (error?.code !== 'ENOENT') throw error
}

if (manifest.manifestVersion !== 5) {
  throw new Error('manifestVersion must be 5.')
}

if (manifest.version !== '1.0.0') {
  throw new Error(`CCX manifest version must be 1.0.0, received ${JSON.stringify(manifest.version)}.`)
}

if (sourceManifest.version !== manifest.version || standaloneManifest.version !== manifest.version) {
  throw new Error('Source, standalone, and built UXP manifests must use the same CCX version.')
}

if (
  manifest.requiredPermissions?.network?.domains !== 'all' ||
  manifest.requiredPermissions?.clipboard !== 'read' ||
  manifest.requiredPermissions?.localFileSystem !== 'request' ||
  JSON.stringify(manifest.requiredPermissions?.launchProcess?.schemes) !== JSON.stringify(['https'])
) {
  throw new Error('UXP permissions must match the reviewed Provider, clipboard, file, and HTTPS launch policy.')
}

const webview = manifest.requiredPermissions?.webview
if (
  webview?.allow !== 'yes' ||
  webview.allowLocalRendering !== 'yes' ||
  webview.enableMessageBridge !== 'localOnly' ||
  !Array.isArray(webview.domains) ||
  webview.domains.length !== 0
) {
  throw new Error('manifest.requiredPermissions.webview must allow only the bundled local WebUI bridge.')
}

if (manifest.host?.app !== 'PS') {
  throw new Error('manifest.host.app must be PS.')
}

if (manifest.host?.minVersion !== '27.3.0') {
  throw new Error('manifest.host.minVersion should match the verified Photoshop 2026 test host.')
}

if (manifest.main !== 'uxp-panel.html') {
  throw new Error('manifest.main must point to uxp-panel.html.')
}

const entrypointIds = new Set((manifest.entrypoints ?? []).map((entrypoint) => entrypoint.id))
if (!entrypointIds.has('panel')) {
  throw new Error('manifest.entrypoints must include the Vue panel.')
}
if (!entrypointIds.has('createLayer')) {
  throw new Error('manifest.entrypoints must include the Photoshop command.')
}

const panelHtml = await readFile(panelPath, 'utf8')
if (panelHtml.includes('type="module"') || panelHtml.includes("type='module'")) {
  throw new Error('uxp-panel.html must use a classic script tag for UXP.')
}

if (!panelHtml.includes('id="app"')) {
  throw new Error('uxp-panel.html must keep the Vue mount node.')
}

if (!panelHtml.includes('height: 100vh;') || !panelHtml.includes('display: flex;')) {
  throw new Error('uxp-panel.html must provide a definite full-panel height chain for the WebView.')
}

const appMountIndex = panelHtml.indexOf('id="app"')
const firstScriptIndex = panelHtml.indexOf('<script')
if (firstScriptIndex === -1 || firstScriptIndex < appMountIndex) {
  throw new Error('uxp-panel.html must load the bundle after the Vue mount node.')
}

const assets = await readdir(assetsDir)
const scriptFiles = assets.filter((file) => file.endsWith('.js'))
if (!scriptFiles.length) {
  throw new Error('Expected at least one bundled JavaScript file.')
}
if (assets.some((file) => file.endsWith('.map'))) {
  throw new Error('Production UXP assets must not contain source maps.')
}

let hasEmbeddedWebviewUrl = false
let hasInnerHostProtocol = false
let hasPanelResizeSync = false

for (const scriptFile of scriptFiles) {
  const source = await readFile(path.join(assetsDir, scriptFile), 'utf8')
  hasEmbeddedWebviewUrl ||= source.includes('plugin:/webui/index.html')
  hasInnerHostProtocol ||= source.includes('inner-host/v1')
  hasPanelResizeSync ||= source.includes('data-mugen-fill-panel') && source.includes('innerHeight') && source.includes('innerWidth')
  if (source.includes('new MutationObserver')) {
    throw new Error(`${scriptFile} contains Vite modulepreload polyfill.`)
  }
  if (source.includes('eval(') || source.includes('new Function')) {
    throw new Error(`${scriptFile} contains runtime code generation.`)
  }
  if (/\bimport\s*\(/.test(source) || /\bimport\.meta\b/.test(source)) {
    throw new Error(`${scriptFile} still contains dynamic ESM markers.`)
  }
  for (const forbidden of forbiddenProductionText) {
    if (source.includes(forbidden)) {
      throw new Error(`${scriptFile} contains forbidden production text: ${forbidden}`)
    }
  }
}

if (!hasEmbeddedWebviewUrl) {
  throw new Error('The bundled Host must load plugin:/webui/index.html.')
}
if (!hasInnerHostProtocol) {
  throw new Error('The bundled Host does not contain the inner-host/v1 protocol marker.')
}
if (!hasPanelResizeSync) {
  throw new Error('The bundled Host must synchronize the WebView pixel size with the Photoshop panel.')
}

for (const filePath of [manifestPath, panelPath]) {
  const source = await readFile(filePath, 'utf8')
  for (const forbidden of forbiddenProductionText) {
    if (source.includes(forbidden)) {
      throw new Error(`${path.basename(filePath)} contains forbidden production text: ${forbidden}`)
    }
  }
}

const webUiAssets = await readdir(path.join(webUiDir, 'assets'))
if (!webUiAssets.some((file) => file.endsWith('.js')) || !webUiAssets.some((file) => file.endsWith('.css'))) {
  throw new Error('The bundled WebUI must contain its JavaScript and CSS assets.')
}
if (webUiAssets.some((file) => file.endsWith('.map'))) {
  throw new Error('The bundled WebUI must not contain source maps.')
}

console.log(`UXP ${manifest.version} build verified with bundled local WebUI: ${path.relative(projectRoot, pluginDir)}`)

import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const pluginDir = path.join(projectRoot, 'dist', 'ps-uxp')
const manifestPath = path.join(pluginDir, 'manifest.json')
const panelPath = path.join(pluginDir, 'uxp-panel.html')
const assetsDir = path.join(pluginDir, 'assets')
const iconsDir = path.join(pluginDir, 'icons')

async function assertFile(filePath, label) {
  const info = await stat(filePath)
  if (!info.isFile()) {
    throw new Error(`${label} is not a file: ${filePath}`)
  }
}

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
await assertFile(panelPath, 'uxp-panel.html')
await assertFile(path.join(iconsDir, 'dark@1x.png'), 'panel dark 1x icon')
await assertFile(path.join(iconsDir, 'dark@2x.png'), 'panel dark 2x icon')
await assertFile(path.join(iconsDir, 'light@1x.png'), 'panel light 1x icon')
await assertFile(path.join(iconsDir, 'light@2x.png'), 'panel light 2x icon')
await assertFile(path.join(iconsDir, 'icon_D@1x.png'), 'dark 1x icon')
await assertFile(path.join(iconsDir, 'icon_D@2x.png'), 'dark 2x icon')
await assertFile(path.join(iconsDir, 'icon_N@1x.png'), 'light 1x icon')
await assertFile(path.join(iconsDir, 'icon_N@2x.png'), 'light 2x icon')

if (manifest.manifestVersion !== 5) {
  throw new Error('manifestVersion must be 5.')
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

const forbiddenProductionStrings = [
  'Mock Server',
  'Mock Keys',
  'mock-good',
  'mock-bad-key',
  'mock-expired',
  'mock-permission-denied',
  'mock-rate-limited',
  'mock-quota-exceeded',
  'mock-server-error',
  'mock-timeout',
  'mock:image-api'
]

for (const scriptFile of scriptFiles) {
  const source = await readFile(path.join(assetsDir, scriptFile), 'utf8')
  if (source.includes('new MutationObserver')) {
    throw new Error(`${scriptFile} contains Vite modulepreload polyfill.`)
  }
  if (source.includes('eval(') || source.includes('new Function')) {
    throw new Error(`${scriptFile} contains runtime code generation.`)
  }
  if (/\bimport\s*\(/.test(source) || /\bimport\.meta\b/.test(source)) {
    throw new Error(`${scriptFile} still contains dynamic ESM markers.`)
  }

  for (const forbiddenString of forbiddenProductionStrings) {
    if (source.includes(forbiddenString)) {
      throw new Error(`${scriptFile} contains production-forbidden mock API text: ${forbiddenString}`)
    }
  }
}

console.log(`UXP build verified: ${path.relative(projectRoot, pluginDir)}`)

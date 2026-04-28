import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginDir = path.dirname(fileURLToPath(import.meta.url))
const manifestPath = path.join(pluginDir, 'manifest.json')
const htmlPath = path.join(pluginDir, 'index.html')
const scriptPath = path.join(pluginDir, 'main.js')
const stylePath = path.join(pluginDir, 'styles.css')

function fail(message) {
  console.error(message)
  process.exit(1)
}

for (const filePath of [manifestPath, htmlPath, scriptPath, stylePath]) {
  if (!existsSync(filePath)) {
    fail(`Missing file: ${path.relative(pluginDir, filePath)}`)
  }
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const html = readFileSync(htmlPath, 'utf8')
const script = readFileSync(scriptPath, 'utf8')

if (manifest.manifestVersion !== 5) {
  fail('manifestVersion must be 5')
}

if (manifest.host?.app !== 'PS') {
  fail('host.app must be PS')
}

if (manifest.main !== 'index.html') {
  fail('manifest.main must be index.html')
}

const entrypoints = manifest.entrypoints || []
if (!entrypoints.some((entry) => entry.type === 'panel' && entry.id === 'panel')) {
  fail('Missing panel entrypoint: panel')
}

if (!entrypoints.some((entry) => entry.type === 'command' && entry.id === 'createLayer')) {
  fail('Missing command entrypoint: createLayer')
}

if (/<script[^>]+type=["']module["']/i.test(html)) {
  fail('index.html must not use module scripts')
}

if (/<sp-dropdown\b/i.test(html)) {
  fail('index.html must use sp-picker instead of deprecated sp-dropdown')
}

for (const pattern of [/\beval\s*\(/, /new\s+Function\b/, /import\s*\(/, /import\.meta/]) {
  if (pattern.test(script)) {
    fail(`main.js contains unsupported pattern: ${pattern}`)
  }
}

for (const unsupportedAttribute of [' hidden=', ' contenteditable=', ' contextmenu=', ' dropzone=', ' spellcheck=']) {
  if (html.includes(unsupportedAttribute)) {
    fail(`index.html contains unsupported attribute:${unsupportedAttribute}`)
  }
}

console.log('Standalone UXP plugin verified')

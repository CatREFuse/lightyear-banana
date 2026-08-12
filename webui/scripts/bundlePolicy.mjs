import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

export const forbiddenBundleMarkers = Object.freeze([
  { id: 'desktop-runtime-name', expression: /electron/i },
  { id: 'desktop-global-bridge', expression: /mugenBridge/i },
  { id: 'desktop-window-deploy-command', expression: /deployWindows/i },
  { id: 'desktop-update-command', expression: /checkForUpdates/i },
  { id: 'desktop-permission-command', expression: /openMacPermissionSettings/i },
  { id: 'retired-connection-log-command', expression: /crx\.logs\.export/i },
  { id: 'retired-mock-host', expression: /MockHost/i },
  { id: 'retired-desktop-version', expression: /0\.3\.19/ },
  { id: 'adobe-host-global-require', expression: /globalThis\.require/ },
  { id: 'adobe-host-modal-api', expression: /executeAsModal/ },
  { id: 'adobe-host-read-pixels-api', expression: /getPixels/ },
  { id: 'adobe-host-write-pixels-api', expression: /putPixels/ },
  { id: 'adobe-host-uxp-require', expression: /require\s*\(\s*['"]uxp['"]\s*\)/ },
  { id: 'adobe-host-photoshop-require', expression: /require\s*\(\s*['"]photoshop['"]\s*\)/ }
])

export const forbiddenSourceModuleSuffixes = Object.freeze([
  '/src/host/mockHost.fixture.ts',
  '/plug-in/src/ccx/',
  '/src/uxp/'
])

export function findForbiddenSourceModule(moduleId) {
  const normalized = String(moduleId).split('?', 1)[0].replaceAll('\\', '/')
  return forbiddenSourceModuleSuffixes.find((suffix) => suffix.endsWith('/')
    ? normalized.includes(suffix)
    : normalized.endsWith(suffix))
}

const textExtensions = new Set(['.css', '.html', '.js', '.json', '.map', '.mjs', '.svg', '.txt'])

export function scanBundleText(text, file = '<memory>') {
  return forbiddenBundleMarkers.flatMap(({ id, expression }) => {
    const match = expression.exec(text)
    if (!match) return []
    const start = Math.max(0, match.index - 32)
    const end = Math.min(text.length, match.index + match[0].length + 32)
    return [{ file, id, marker: match[0], excerpt: text.slice(start, end).replace(/\s+/g, ' ') }]
  })
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name)
    return entry.isDirectory() ? listFiles(absolutePath) : [absolutePath]
  })
}

export function scanBundleDirectory(directory) {
  const files = listFiles(directory)
  const textFiles = files.filter((file) => textExtensions.has(path.extname(file).toLowerCase()))
  const findings = textFiles.flatMap((file) => scanBundleText(readFileSync(file, 'utf8'), path.relative(directory, file)))
  return {
    fileCount: files.length,
    scannedFileCount: textFiles.length,
    totalBytes: files.reduce((sum, file) => sum + statSync(file).size, 0),
    findings
  }
}

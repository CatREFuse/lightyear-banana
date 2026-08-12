import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { scanBundleDirectory } from './bundlePolicy.mjs'

const distDirectory = fileURLToPath(new URL('../dist/', import.meta.url))

if (!existsSync(distDirectory)) {
  throw new Error('Inner WebUI bundle is missing. Run the production build first.')
}

const result = scanBundleDirectory(distDirectory)
if (result.findings.length) {
  const details = result.findings
    .map((finding) => `${finding.file}: ${finding.id} (${finding.marker}) near "${finding.excerpt}"`)
    .join('\n')
  throw new Error(`Inner WebUI bundle contains forbidden runtime markers:\n${details}`)
}

console.log(`Inner WebUI bundle isolation passed: ${result.scannedFileCount}/${result.fileCount} files scanned, ${result.totalBytes} bytes, 0 forbidden markers.`)

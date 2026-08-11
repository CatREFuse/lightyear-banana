import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

export const forbiddenProductionUxpMarkers = Object.freeze([
  '__MUGEN_SMOKE__',
  '__MUGEN_E2E_TRACE__',
  'mock-apimart-good',
  '/__smoke/',
  'apimart-smoke-fixture',
  'MockHost',
  'cake.catrefuse.com',
  'webui.catrefuse.com',
  'inner-webui.invalid'
])

async function listArtifactFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listArtifactFiles(entryPath))
      continue
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported production UXP artifact entry: ${entryPath}`)
    }
    files.push(entryPath)
  }

  return files
}

export async function scanProductionUxpArtifacts(directory) {
  const artifactFiles = await listArtifactFiles(directory)
  const findings = []

  for (const filePath of artifactFiles) {
    const source = await readFile(filePath)
    for (const marker of forbiddenProductionUxpMarkers) {
      if (source.includes(marker)) {
        findings.push({
          file: path.relative(directory, filePath),
          marker
        })
      }
    }
  }

  return {
    scannedFileCount: artifactFiles.length,
    findings
  }
}

export async function assertProductionUxpArtifactsClean(directory) {
  const result = await scanProductionUxpArtifacts(directory)
  if (result.findings.length > 0) {
    const details = result.findings
      .map(({ file, marker }) => `${file}: ${JSON.stringify(marker)}`)
      .join(', ')
    throw new Error(`Production UXP artifacts contain forbidden test or development markers: ${details}`)
  }
  return result
}

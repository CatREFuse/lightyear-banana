import { mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const pluginDir = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.dirname(pluginDir)
const packageDir = path.join(projectRoot, 'dist', 'standalone-uxp-plugin')
const archivePath = path.join(projectRoot, 'dist', 'lightyear-banana-standalone-0.1.0.zip')
const files = ['manifest.json', 'index.html', 'main.js', 'styles.css', 'README.md']

rmSync(packageDir, { recursive: true, force: true })
mkdirSync(packageDir, { recursive: true })

for (const file of files) {
  execFileSync('cp', [path.join(pluginDir, file), path.join(packageDir, file)])
}

rmSync(archivePath, { force: true })
execFileSync('zip', ['-r', '-q', archivePath, '.'], {
  cwd: packageDir
})

console.log(`Standalone UXP plugin packaged: ${archivePath}`)

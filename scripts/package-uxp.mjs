import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
const sourceDir = path.join(projectRoot, 'dist', 'ps-uxp')
const archivePath = path.join(projectRoot, 'dist', `${packageJson.name}-${packageJson.version}.ccx`)

if (!existsSync(path.join(sourceDir, 'manifest.json'))) {
  throw new Error('UXP build not found. Run npm run verify:uxp first.')
}

rmSync(archivePath, { force: true })

if (process.platform === 'win32') {
  const temporaryArchivePath = `${archivePath}.zip`
  rmSync(temporaryArchivePath, { force: true })
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      '$ErrorActionPreference = "Stop"; ' +
        'Get-ChildItem -LiteralPath $env:LIGHTYEAR_UXP_SOURCE_DIR -Force | ' +
        'Compress-Archive -DestinationPath $env:LIGHTYEAR_UXP_ARCHIVE_PATH -Force'
    ],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        LIGHTYEAR_UXP_ARCHIVE_PATH: temporaryArchivePath,
        LIGHTYEAR_UXP_SOURCE_DIR: sourceDir
      },
      stdio: 'inherit'
    }
  )
  renameSync(temporaryArchivePath, archivePath)
} else {
  execFileSync('zip', ['-r', '-q', archivePath, '.'], { cwd: sourceDir, stdio: 'inherit' })
}

if (!existsSync(archivePath)) {
  throw new Error(`UXP archive was not created: ${archivePath}`)
}

console.log(`UXP archive packaged: ${archivePath}`)

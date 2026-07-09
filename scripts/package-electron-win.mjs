import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
const electronPackageJsonPath = require.resolve('electron/package.json')
const electronPackageDir = path.dirname(electronPackageJsonPath)
const electronPackageJson = JSON.parse(await readFile(electronPackageJsonPath, 'utf8'))
const electronRuntimeOverride = process.env.LIGHTYEAR_ELECTRON_WIN_RUNTIME_DIR?.trim()
const electronRuntimeDir = electronRuntimeOverride
  ? path.resolve(projectRoot, electronRuntimeOverride)
  : path.join(electronPackageDir, 'dist')
const outDir = path.join(projectRoot, 'dist', 'win')
const appName = 'Lightyear Banana'
const packagedDir = path.join(outDir, `${appName}-win32-x64`)
const archivePath = path.join(projectRoot, 'dist', `${packageJson.name}-${packageJson.version}-win.zip`)
const resourcesDir = path.join(packagedDir, 'resources')
const appResourcesDir = path.join(resourcesDir, 'app')

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: options.cwd ?? projectRoot, stdio: 'inherit' })
}

function quotePowerShellString(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function copyDirectoryContents(source, destination) {
  if (process.platform !== 'win32') {
    mkdirSync(destination, { recursive: true })
    for (const entry of readdirSync(source)) {
      cpSync(path.join(source, entry), path.join(destination, entry), { force: true, recursive: true })
    }
    return
  }

  run('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    [
      '$ErrorActionPreference = "Stop"',
      `$source = ${quotePowerShellString(source)}`,
      `$destination = ${quotePowerShellString(destination)}`,
      'New-Item -ItemType Directory -Path $destination -Force | Out-Null',
      'Copy-Item -Path (Join-Path $source "*") -Destination $destination -Recurse -Force'
    ].join('; ')
  ])
}

function copyPath(source, destination) {
  if (statSync(source).isDirectory()) {
    copyDirectoryContents(source, destination)
    return
  }

  copyFileSync(source, destination)
}

function copyDist() {
  const sourceDist = path.join(projectRoot, 'dist')
  const packagedDist = path.join(appResourcesDir, 'dist')
  const skippedEntries = new Set(['mac', 'win', 'ps-uxp', 'electron-icon', 'electron-dl'])

  mkdirSync(packagedDist, { recursive: true })
  for (const entry of readdirSync(sourceDist)) {
    if (skippedEntries.has(entry) || entry.endsWith('.zip') || entry.startsWith('release-')) {
      continue
    }

    copyPath(path.join(sourceDist, entry), path.join(packagedDist, entry))
  }
}

if (!existsSync(path.join(projectRoot, 'dist', 'index.html'))) {
  console.error('Web build not found. Run npm run build:web first.')
  process.exit(1)
}

if (!existsSync(path.join(electronRuntimeDir, 'electron.exe'))) {
  throw new Error('Electron runtime not found. Run npm install first.')
}

rmSync(outDir, { force: true, recursive: true })
rmSync(archivePath, { force: true })
mkdirSync(outDir, { recursive: true })

console.log(`Packaging Windows Electron v${electronPackageJson.version}...`)

copyDirectoryContents(electronRuntimeDir, packagedDir)
renameSync(path.join(packagedDir, 'electron.exe'), path.join(packagedDir, `${appName}.exe`))
rmSync(path.join(resourcesDir, 'default_app.asar'), { force: true })
rmSync(path.join(resourcesDir, 'default_app'), { force: true, recursive: true })

mkdirSync(appResourcesDir, { recursive: true })
copyDirectoryContents(path.join(projectRoot, 'electron'), path.join(appResourcesDir, 'electron'))
copyDist()
if (existsSync(path.join(projectRoot, 'favicon.svg'))) {
  copyFileSync(path.join(projectRoot, 'favicon.svg'), path.join(appResourcesDir, 'favicon.svg'))
}
writeFileSync(
  path.join(appResourcesDir, 'package.json'),
  JSON.stringify(
    {
      name: packageJson.name,
      version: packageJson.version,
      type: 'module',
      main: 'electron/main.js'
    },
    null,
    2
  )
)

console.log(`Windows app packaged: ${packagedDir}`)

if (process.platform === 'win32') {
  run('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    [
      '$ErrorActionPreference = "Stop"',
      `$source = ${quotePowerShellString(packagedDir)}`,
      `$destination = ${quotePowerShellString(archivePath)}`,
      'Compress-Archive -LiteralPath $source -DestinationPath $destination -Force'
    ].join('; ')
  ])
} else {
  run('zip', ['-r', '-q', archivePath, path.basename(packagedDir)], { cwd: outDir })
}
console.log(`Windows archive: ${archivePath}`)

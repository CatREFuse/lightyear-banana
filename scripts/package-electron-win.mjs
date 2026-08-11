import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
const electronPackageJsonPath = require.resolve('electron/package.json')
const electronPackageDir = path.dirname(electronPackageJsonPath)
const electronPackageJson = JSON.parse(await readFile(electronPackageJsonPath, 'utf8'))
const electronRuntimeOverride = process.env.MUGEN_ELECTRON_WIN_RUNTIME_DIR?.trim()
const electronRuntimeDir = electronRuntimeOverride
  ? path.resolve(projectRoot, electronRuntimeOverride)
  : path.join(electronPackageDir, 'dist')
const outDir = path.join(projectRoot, 'dist', 'win')
const appName = 'Mugen'
const packagedDir = path.join(outDir, `${appName}-win32-x64`)
const archivePath = path.join(projectRoot, 'dist', `${packageJson.name}-${packageJson.version}-win.zip`)
const resourcesDir = path.join(packagedDir, 'resources')
const appResourcesDir = path.join(resourcesDir, 'app')

function readUxpRelease() {
  const metadataPath = path.join(projectRoot, 'dist', 'uxp-release.json')
  if (!existsSync(metadataPath)) throw new Error('dist/uxp-release.json is required before Electron packaging.')
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'))
  if (
    metadata?.schemaVersion !== 1 ||
    typeof metadata.ccxVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(metadata.ccxVersion) ||
    typeof metadata.filename !== 'string' || path.basename(metadata.filename) !== metadata.filename ||
    metadata.filename !== `${packageJson.name}-${metadata.ccxVersion}.ccx` ||
    typeof metadata.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(metadata.sha256)
  ) throw new Error('dist/uxp-release.json is invalid.')
  const archivePath = path.join(projectRoot, 'dist', metadata.filename)
  const checksumPath = `${archivePath}.sha256`
  if (!existsSync(archivePath) || !existsSync(checksumPath)) throw new Error('The verified CCX release file set is incomplete.')
  const actualSha256 = createHash('sha256').update(readFileSync(archivePath)).digest('hex')
  if (actualSha256 !== metadata.sha256.toLowerCase()) throw new Error('CCX archive does not match dist/uxp-release.json.')
  return { archivePath, checksumPath, metadata, metadataPath }
}

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

function copyDist(uxpRelease) {
  const sourceDist = path.join(projectRoot, 'dist')
  const packagedDist = path.join(appResourcesDir, 'dist')
  const skippedEntries = new Set(['mac', 'win', 'ps-uxp', 'electron-icon', 'electron-dl'])

  mkdirSync(packagedDist, { recursive: true })
  for (const entry of readdirSync(sourceDist)) {
    if (
      skippedEntries.has(entry) ||
      entry.endsWith('.zip') ||
      entry.endsWith('.ccx') ||
      entry.endsWith('.ccx.sha256') ||
      entry === 'uxp-release.json' ||
      entry.startsWith('release-')
    ) {
      continue
    }

    copyPath(path.join(sourceDist, entry), path.join(packagedDist, entry))
  }
  copyPath(uxpRelease.archivePath, path.join(packagedDist, uxpRelease.metadata.filename))
  copyPath(uxpRelease.checksumPath, path.join(packagedDist, `${uxpRelease.metadata.filename}.sha256`))
  copyPath(uxpRelease.metadataPath, path.join(packagedDist, 'uxp-release.json'))
}

if (!existsSync(path.join(projectRoot, 'dist', 'index.html'))) {
  console.error('Legacy desktop web build not found. Run npm run legacy:build:web first.')
  process.exit(1)
}

if (!existsSync(path.join(electronRuntimeDir, 'electron.exe'))) {
  throw new Error('Electron runtime not found. Run npm install first.')
}

const uxpRelease = readUxpRelease()

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
copyDist(uxpRelease)
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

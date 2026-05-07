import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { packager } from '@electron/packager'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'))
const outDir = path.join(projectRoot, 'dist', 'win')
const appName = 'Lightyear Banana'
const archivePath = path.join(projectRoot, 'dist', `${packageJson.name}-${packageJson.version}-win.zip`)
const electronVersion = packageJson.devDependencies.electron.replace('^', '')

function archiveDirectory(directoryPath, destinationPath) {
  if (process.platform === 'win32') {
    const quotePowerShellPath = (value) => `'${value.replace(/'/g, "''")}'`
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Compress-Archive -Path ${quotePowerShellPath(directoryPath)} -DestinationPath ${quotePowerShellPath(destinationPath)} -Force`
      ],
      { cwd: projectRoot, stdio: 'inherit' }
    )
    return
  }

  const parentDir = path.dirname(directoryPath)
  const directoryName = path.basename(directoryPath)

  try {
    execFileSync('zip', ['-r', '-q', '-X', destinationPath, directoryName], {
      cwd: parentDir,
      stdio: 'inherit'
    })
    return
  } catch (error) {
    if (process.platform !== 'darwin') {
      throw error
    }
  }

  execFileSync('ditto', ['--norsrc', '-c', '-k', '--keepParent', directoryPath, destinationPath], {
    cwd: projectRoot,
    stdio: 'inherit'
  })
}

if (!existsSync(path.join(projectRoot, 'dist', 'index.html'))) {
  console.error('Web build not found. Run npm run build:web first.')
  process.exit(1)
}

rmSync(outDir, { force: true, recursive: true })
rmSync(archivePath, { force: true })
mkdirSync(outDir, { recursive: true })
rmSync(path.join(projectRoot, 'dist', 'mock-images'), { force: true, recursive: true })
cpSync(path.join(projectRoot, 'public', 'mock-images'), path.join(projectRoot, 'dist', 'mock-images'), { recursive: true })

console.log(`Packaging Windows Electron v${electronVersion}...`)

const appPaths = await packager({
  dir: projectRoot,
  name: appName,
  platform: 'win32',
  arch: 'x64',
  out: outDir,
  electronVersion,
  download: {
    mirrorOptions: {
      mirror: 'https://npmmirror.com/mirrors/electron/',
      customDir: 'v' + electronVersion
    }
  },
  overwrite: true,
  asar: false,
  ignore: [
    /(^|\/)node_modules($|\/)/,
    /(^|\/)src($|\/)/,
    /(^|\/)docs($|\/)/,
    /(^|\/)ref($|\/)/,
    /(^|\/)plugin($|\/)/,
    /(^|\/)scripts($|\/)/,
    /(^|\/)standalone-uxp-plugin($|\/)/,
    /(^|\/)public($|\/)/,
    /(^|\/)\.git($|\/)/,
    /(^|\/)\.vscode($|\/)/,
    /(^|\/)\.claude($|\/)/,
    /tsconfig\./,
    /vite\./,
    /AGENTS\.md$/,
    /uxp-panel\.html$/,
    /\.DS_Store$/,
    /(^|\/)dist\/mac($|\/)/,
    /(^|\/)dist\/win($|\/)/,
    /(^|\/)dist\/ps-uxp($|\/)/,
    /(^|\/)dist\/electron-icon($|\/)/,
    /(^|\/)dist\/electron-dl($|\/)/,
    /package-lock\.json$/
  ]
})

const packagedDir = appPaths[0]
console.log(`Windows app packaged: ${packagedDir}`)

archiveDirectory(packagedDir, archivePath)
console.log(`Windows archive: ${archivePath}`)

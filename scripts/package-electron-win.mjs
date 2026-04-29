import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
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

function run(command, args) {
  execFileSync(command, args, { cwd: projectRoot, stdio: 'inherit' })
}

if (!existsSync(path.join(projectRoot, 'dist', 'index.html'))) {
  console.error('Web build not found. Run npm run build:web first.')
  process.exit(1)
}

rmSync(outDir, { force: true, recursive: true })
rmSync(archivePath, { force: true })
mkdirSync(outDir, { recursive: true })

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

run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', packagedDir, archivePath])
console.log(`Windows archive: ${archivePath}`)

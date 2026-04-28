import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readText(path.join(projectRoot, 'package.json')))
const electronApp = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'Electron.app')
const outDir = path.join(projectRoot, 'dist', 'mac')
const appName = 'Lightyear Banana'
const appPath = path.join(outDir, `${appName}.app`)
const archivePath = path.join(projectRoot, 'dist', `${packageJson.name}-${packageJson.version}-mac.zip`)
const resourcesDir = path.join(appPath, 'Contents', 'Resources')
const appResourcesDir = path.join(resourcesDir, 'app')
const appIconName = 'lightyear-banana.icns'
const appIconPath = path.join(resourcesDir, appIconName)

async function readText(filePath) {
  const { readFile } = await import('node:fs/promises')
  return readFile(filePath, 'utf8')
}

function run(command, args) {
  execFileSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit'
  })
}

function generateBananaIcon() {
  const iconWorkDir = path.join(projectRoot, 'dist', 'electron-icon')
  const sourcePng = path.join(iconWorkDir, 'banana-1024.png')
  const iconsetDir = path.join(iconWorkDir, 'lightyear-banana.iconset')
  const pythonCode = `
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
out = Path(r'''${sourcePng}''')
out.parent.mkdir(parents=True, exist_ok=True)
base = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
draw = ImageDraw.Draw(base)
draw.rounded_rectangle((8, 8, 248, 248), radius=54, fill=(18, 22, 28, 255))
font = ImageFont.truetype('/System/Library/Fonts/Apple Color Emoji.ttc', 160)
text = '🍌'
bounds = draw.textbbox((0, 0), text, font=font, embedded_color=True)
x = (256 - (bounds[2] - bounds[0])) / 2 - bounds[0]
y = (256 - (bounds[3] - bounds[1])) / 2 - bounds[1] - 4
draw.text((x, y), text, font=font, embedded_color=True)
base.resize((1024, 1024), Image.Resampling.LANCZOS).save(out)
`

  rmSync(iconWorkDir, { force: true, recursive: true })
  mkdirSync(iconsetDir, { recursive: true })
  execFileSync('/usr/bin/python3', ['-c', pythonCode], { cwd: projectRoot, stdio: 'inherit' })

  const sizes = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024]
  ]

  for (const [fileName, size] of sizes) {
    run('sips', ['-z', String(size), String(size), sourcePng, '--out', path.join(iconsetDir, fileName)])
  }

  run('iconutil', ['-c', 'icns', iconsetDir, '-o', appIconPath])
}

if (!existsSync(electronApp)) {
  throw new Error('Electron.app not found. Run npm install first.')
}

rmSync(outDir, { force: true, recursive: true })
rmSync(archivePath, { force: true })
mkdirSync(outDir, { recursive: true })
cpSync(electronApp, appPath, { recursive: true })

rmSync(path.join(resourcesDir, 'default_app.asar'), { force: true })
generateBananaIcon()
mkdirSync(appResourcesDir, { recursive: true })
cpSync(path.join(projectRoot, 'electron'), path.join(appResourcesDir, 'electron'), { recursive: true })

const sourceDist = path.join(projectRoot, 'dist')
const packagedDist = path.join(appResourcesDir, 'dist')
mkdirSync(packagedDist, { recursive: true })
for (const entry of readdirSync(sourceDist)) {
  if (entry === 'mac') {
    continue
  }

  cpSync(path.join(sourceDist, entry), path.join(packagedDist, entry), { recursive: true })
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

const plistPath = path.join(appPath, 'Contents', 'Info.plist')
run('plutil', ['-replace', 'CFBundleDisplayName', '-string', appName, plistPath])
run('plutil', ['-replace', 'CFBundleIconFile', '-string', appIconName, plistPath])
run('plutil', ['-replace', 'CFBundleName', '-string', appName, plistPath])
run('plutil', ['-replace', 'CFBundleIdentifier', '-string', 'com.lightyear.banana', plistPath])
run('plutil', ['-replace', 'CFBundleShortVersionString', '-string', packageJson.version, plistPath])
run('plutil', ['-replace', 'CFBundleVersion', '-string', packageJson.version, plistPath])
run('plutil', [
  '-replace',
  'NSAppleEventsUsageDescription',
  '-string',
  `${appName} 需要打开系统设置并协助调整 Photoshop 窗口。`,
  plistPath
])
run('plutil', [
  '-replace',
  'NSScreenCaptureUsageDescription',
  '-string',
  `${appName} 需要读取窗口位置来完成布局。`,
  plistPath
])
run('plutil', ['-remove', 'ElectronAsarIntegrity', plistPath])

try {
  run('codesign', ['--force', '--deep', '--sign', '-', appPath])
} catch {
  console.warn('codesign skipped. The app was packaged but may need local approval before launch.')
}

run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, archivePath])
console.log(`Electron macOS app packaged: ${appPath}`)
console.log(`Electron macOS archive packaged: ${archivePath}`)

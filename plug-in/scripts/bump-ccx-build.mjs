import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const packagePath = path.join(projectRoot, 'plug-in', 'package.json')

function shanghaiDatePrefix(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      year: '2-digit',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date).map(({ type, value }) => [type, value])
  )
  return `${parts.year}${parts.month}${parts.day}`
}

export function nextCcxBuildNumber(currentBuildNumber, date = new Date()) {
  const prefix = shanghaiDatePrefix(date)
  const currentCounter = typeof currentBuildNumber === 'string' && currentBuildNumber.startsWith(prefix)
    ? Number(currentBuildNumber.slice(6))
    : 0
  const nextCounter = currentCounter + 1
  if (!Number.isSafeInteger(nextCounter) || nextCounter > 9999) {
    throw new Error(`CCX build counter is exhausted for ${prefix}.`)
  }
  return `${prefix}${String(nextCounter).padStart(4, '0')}`
}

function bumpCcxBuildNumber() {
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'))
  packageJson.buildNumber = nextCcxBuildNumber(packageJson.buildNumber)
  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)
  console.log(`CCX build number: ${packageJson.buildNumber}`)
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  bumpCcxBuildNumber()
}

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJsonPath = path.join(projectRoot, 'package.json')
const buildInfoPath = path.join(projectRoot, 'src', 'buildInfo.ts')
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))

function readDateStamp() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric'
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))

  return `${values.year}${values.month}${values.day}`
}

function readPreviousBuildNumber() {
  if (!existsSync(buildInfoPath)) {
    return ''
  }

  const source = readFileSync(buildInfoPath, 'utf8')
  const match = /buildNumber:\s*'(\d{12})'/.exec(source)

  return match?.[1] ?? ''
}

function createNextBuildNumber() {
  const dateStamp = readDateStamp()
  const previous = readPreviousBuildNumber()
  if (!previous.startsWith(dateStamp)) {
    return `${dateStamp}0000`
  }

  const nextIndex = Number(previous.slice(8)) + 1

  return `${dateStamp}${String(nextIndex).padStart(4, '0')}`
}

const buildNumber = createNextBuildNumber()
const source = `export const buildInfo = {
  version: '${packageJson.version}',
  buildNumber: '${buildNumber}',
  displayVersion: 'v${packageJson.version}+${buildNumber}'
} as const
`

writeFileSync(buildInfoPath, source)
console.log(`Build number updated: ${buildNumber}`)

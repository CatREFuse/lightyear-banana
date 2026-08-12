import { execFileSync } from 'node:child_process'

const RETIRED_UXP_PREFIXES = [
  'standalone-uxp-plugin/',
  'src/uxp/'
]

const RETIRED_UXP_ENTRYPOINTS = new Set([
  'uxp-panel.html',
  'vite.uxp.config.ts'
])

const RETIRED_UXP_PRODUCT_SCRIPT = /^scripts\/(?=[^/]*uxp)(?=[^/]*(?:package|verify|policy|metadata))[^/]+$/i
const UXP_PACKAGE_SCRIPT = /(?:^|:)uxp(?:$|:)/i
const UXP_PACKAGE_SCRIPT_REFERENCE = /(?:^|\s)(?:npm|pnpm|yarn)(?:\.cmd)?\s+(?:run\s+)?[^\s]*?(?:^|:)uxp(?:$|:|\s)/i
const RETIRED_UXP_FILE_REFERENCE = /(?:^|[\s"'])(?:\.\/)?(?:scripts\/(?:[^\s"']*uxp[^\s"']*(?:package|verify|policy|metadata)|[^\s"']*(?:package|verify|policy|metadata)[^\s"']*uxp)[^\s"']*|vite\.uxp\.config\.ts|uxp-panel\.html)(?=$|[\s"'])/i

function normalizeTrackedPath(filePath) {
  return String(filePath ?? '').replaceAll('\\', '/').replace(/^\.\//, '')
}

export function isRetiredUxpProductPath(filePath) {
  const normalized = normalizeTrackedPath(filePath)
  return RETIRED_UXP_ENTRYPOINTS.has(normalized)
    || RETIRED_UXP_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    || RETIRED_UXP_PRODUCT_SCRIPT.test(normalized)
}

export function findRetiredUxpPolicyViolations({ trackedPaths = [], packageJson = {} } = {}) {
  const violations = []

  for (const filePath of trackedPaths) {
    const normalized = normalizeTrackedPath(filePath)
    if (isRetiredUxpProductPath(normalized)) {
      violations.push({ kind: 'tracked-path', value: normalized })
    }
  }

  const scripts = packageJson && typeof packageJson === 'object' && packageJson.scripts && typeof packageJson.scripts === 'object'
    ? packageJson.scripts
    : {}
  for (const [name, command] of Object.entries(scripts)) {
    if (UXP_PACKAGE_SCRIPT.test(name)) {
      violations.push({ kind: 'package-script', value: name })
      continue
    }
    if (
      typeof command === 'string'
      && (UXP_PACKAGE_SCRIPT_REFERENCE.test(command) || RETIRED_UXP_FILE_REFERENCE.test(command))
    ) {
      violations.push({ kind: 'package-script-reference', value: name })
    }
  }

  return violations.sort((left, right) => `${left.kind}:${left.value}`.localeCompare(`${right.kind}:${right.value}`))
}

export function assertNoRetiredUxpProductArtifacts(input) {
  const violations = findRetiredUxpPolicyViolations(input)
  if (!violations.length) return
  const details = violations.map(({ kind, value }) => `- ${kind}: ${value}`).join('\n')
  throw new Error(`Retired standalone UXP product artifacts are not allowed:\n${details}`)
}

export function listTrackedPaths(repositoryRoot) {
  const output = execFileSync('git', ['ls-files', '--cached', '-z'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true
  })
  return output
    .split('\0')
    .filter(Boolean)
    .map(normalizeTrackedPath)
}

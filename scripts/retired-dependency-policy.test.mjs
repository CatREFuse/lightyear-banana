import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  assertNoRetiredUxpProductArtifacts,
  findRetiredUxpPolicyViolations,
  isRetiredUxpProductPath,
  listTrackedPaths
} from './retired-dependency-policy.mjs'

const retiredPackages = ['@tailwindcss/vite', 'tailwindcss', 'vue-router']
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const rootPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const webUiPackage = JSON.parse(readFileSync(new URL('../apps/inner-webui/package.json', import.meta.url), 'utf8'))
const packageLock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))

test('keeps retired Inner WebUI 0.1 dependencies out of the active workspace', () => {
  const declared = {
    ...webUiPackage.dependencies,
    ...webUiPackage.devDependencies
  }
  for (const packageName of retiredPackages) {
    assert.equal(declared[packageName], undefined, `${packageName} must not be declared by WebUI vNext`)
  }

  const lockedPaths = Object.keys(packageLock.packages ?? {})
  assert.equal(
    lockedPaths.some((entry) => /^node_modules\/(?:@tailwindcss\/|tailwindcss$|vue-router(?:\/|$))/.test(entry)),
    false,
    'retired WebUI dependencies must not remain in package-lock.json'
  )
})

test('rejects every retired standalone UXP product path', () => {
  const retiredPaths = [
    'standalone-uxp-plugin/manifest.json',
    'src/uxp/main.ts',
    'vite.uxp.config.ts',
    'uxp-panel.html',
    'scripts/package-uxp.mjs',
    'scripts/verify-uxp-build.mjs',
    'scripts/uxp-environment-policy.d.mts',
    'scripts/uxp-environment-policy.test.mjs',
    'scripts/uxp-production-artifact-policy.mjs',
    'scripts/uxp-release-metadata.test.mjs'
  ]

  for (const filePath of retiredPaths) {
    assert.equal(isRetiredUxpProductPath(filePath), true, `${filePath} must be retired`)
  }

  assert.throws(
    () => assertNoRetiredUxpProductArtifacts({ trackedPaths: retiredPaths, packageJson: { scripts: {} } }),
    /Retired standalone UXP product artifacts are not allowed/
  )
})

test('rejects legacy UXP package commands and references', () => {
  const packageJson = {
    scripts: {
      'build:uxp': 'vite build --config vite.uxp.config.ts',
      'legacy:verify:uxp': 'node scripts/verify-uxp-build.mjs',
      release: 'npm run package:uxp',
      archive: 'node scripts/package-uxp.mjs'
    }
  }

  assert.deepEqual(
    findRetiredUxpPolicyViolations({ packageJson }),
    [
      { kind: 'package-script-reference', value: 'archive' },
      { kind: 'package-script-reference', value: 'release' },
      { kind: 'package-script', value: 'build:uxp' },
      { kind: 'package-script', value: 'legacy:verify:uxp' }
    ]
  )
})

test('allows CCX code to name Adobe UXP vendor APIs and protocol compatibility fields', () => {
  const activePaths = [
    'src/ccx/main.ts',
    'src/ccx/inner/adobeUxpRuntime.ts',
    'src/ccx/inner/protocol.ts',
    'scripts/package-ccx.mjs',
    'scripts/verify-ccx-build.mjs',
    'scripts/ccx-release-metadata.mjs'
  ]
  const packageJson = {
    scripts: {
      'build:ccx': 'vite build --config vite.ccx.config.ts',
      'verify:ccx': 'node scripts/verify-ccx-build.mjs'
    },
    compatibility: {
      vendorModule: "require('uxp')",
      modalMethod: 'uxpShowModal',
      protocolField: 'uxpVersion'
    }
  }

  assert.deepEqual(findRetiredUxpPolicyViolations({ trackedPaths: activePaths, packageJson }), [])
  assert.doesNotThrow(() => assertNoRetiredUxpProductArtifacts({ trackedPaths: activePaths, packageJson }))
})

test('keeps retired standalone UXP products out of the active repository', () => {
  assertNoRetiredUxpProductArtifacts({
    trackedPaths: listTrackedPaths(repositoryRoot),
    packageJson: rootPackage
  })
})

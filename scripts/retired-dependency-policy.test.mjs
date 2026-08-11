import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const retiredPackages = ['@tailwindcss/vite', 'tailwindcss', 'vue-router']
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

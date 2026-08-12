import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveCcxMugenEnvironment } from './ccx-environment-policy.mjs'

test('fixes production CCX builds to the production environment', () => {
  assert.equal(resolveCcxMugenEnvironment('production'), 'production')
  assert.equal(resolveCcxMugenEnvironment('production', { VITE_MUGEN_ENV: 'production' }), 'production')
  assert.equal(resolveCcxMugenEnvironment('production', { MUGEN_ENV: 'production' }), 'production')
  assert.equal(resolveCcxMugenEnvironment('production', { VITE_MUGEN_ENV: 'unexpected' }), 'production')
})

test('rejects every development or test override in production mode', () => {
  for (const key of ['VITE_MUGEN_ENV', 'MUGEN_ENV']) {
    for (const value of ['development', 'test']) {
      assert.throws(
        () => resolveCcxMugenEnvironment('production', { [key]: value }),
        new RegExp(`Production CCX builds cannot use ${key}=${value}`)
      )
    }
  }

  assert.throws(
    () => resolveCcxMugenEnvironment('production', {
      VITE_MUGEN_ENV: 'production',
      MUGEN_ENV: 'test'
    }),
    /MUGEN_ENV=test/
  )
})

test('preserves the existing non-production override semantics', () => {
  assert.equal(resolveCcxMugenEnvironment('development'), 'development')
  assert.equal(resolveCcxMugenEnvironment('staging', { MUGEN_ENV: 'test' }), 'test')
  assert.equal(resolveCcxMugenEnvironment('test', {
    VITE_MUGEN_ENV: 'production',
    MUGEN_ENV: 'test'
  }), 'production')
  assert.equal(resolveCcxMugenEnvironment('development', { VITE_MUGEN_ENV: 'unexpected' }), 'development')
})

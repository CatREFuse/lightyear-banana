import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveUxpMugenEnvironment } from './uxp-environment-policy.mjs'

test('fixes production UXP builds to the production environment', () => {
  assert.equal(resolveUxpMugenEnvironment('production'), 'production')
  assert.equal(resolveUxpMugenEnvironment('production', { VITE_MUGEN_ENV: 'production' }), 'production')
  assert.equal(resolveUxpMugenEnvironment('production', { MUGEN_ENV: 'production' }), 'production')
  assert.equal(resolveUxpMugenEnvironment('production', { VITE_MUGEN_ENV: 'unexpected' }), 'production')
})

test('rejects every development or test override in production mode', () => {
  for (const key of ['VITE_MUGEN_ENV', 'MUGEN_ENV']) {
    for (const value of ['development', 'test']) {
      assert.throws(
        () => resolveUxpMugenEnvironment('production', { [key]: value }),
        new RegExp(`Production UXP builds cannot use ${key}=${value}`)
      )
    }
  }

  assert.throws(
    () => resolveUxpMugenEnvironment('production', {
      VITE_MUGEN_ENV: 'production',
      MUGEN_ENV: 'test'
    }),
    /MUGEN_ENV=test/
  )
})

test('preserves the existing non-production override semantics', () => {
  assert.equal(resolveUxpMugenEnvironment('development'), 'development')
  assert.equal(resolveUxpMugenEnvironment('staging', { MUGEN_ENV: 'test' }), 'test')
  assert.equal(resolveUxpMugenEnvironment('test', {
    VITE_MUGEN_ENV: 'production',
    MUGEN_ENV: 'test'
  }), 'production')
  assert.equal(resolveUxpMugenEnvironment('development', { VITE_MUGEN_ENV: 'unexpected' }), 'development')
})

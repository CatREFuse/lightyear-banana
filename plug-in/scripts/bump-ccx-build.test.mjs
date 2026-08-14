import assert from 'node:assert/strict'
import test from 'node:test'
import { nextCcxBuildNumber } from './bump-ccx-build.mjs'

test('increments the daily CCX build counter in Asia/Shanghai', () => {
  const date = new Date('2026-08-14T12:00:00+08:00')
  assert.equal(nextCcxBuildNumber('2608140001', date), '2608140002')
  assert.equal(nextCcxBuildNumber('2608130042', date), '2608140001')
})

test('rejects a daily counter above four digits', () => {
  assert.throws(
    () => nextCcxBuildNumber('2608149999', new Date('2026-08-14T12:00:00+08:00')),
    /exhausted/
  )
})

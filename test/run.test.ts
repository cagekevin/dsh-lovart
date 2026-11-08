import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_TIMINGS, nextDelay } from '../src/host/job/run.ts'

test('退避：10s 起翻倍，60s 封顶', () => {
  assert.deepEqual(DEFAULT_TIMINGS, { initialMs: 10_000, maxMs: 60_000, recheckMs: 5_000 })
  assert.equal(nextDelay(10_000, 60_000), 20_000)
  assert.equal(nextDelay(20_000, 60_000), 40_000)
  assert.equal(nextDelay(40_000, 60_000), 60_000)
  assert.equal(nextDelay(60_000, 60_000), 60_000)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from '../src/host/job/store.ts'

test('createStore：每次调用得到独立实例', () => {
  const first = createStore<number>()
  const second = createStore<number>()

  first.set('job-1', 1)

  assert.equal(first.get('job-1'), 1)
  assert.equal(second.get('job-1'), undefined)
})

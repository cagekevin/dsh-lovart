import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseChatResult,
  parseGenerateArgs,
  parseIdField,
  parseUpstreamStatus,
} from '../src/host/lovart/types.ts'
import { LovartError } from '../src/host/errors.ts'

test('上游状态映射；缺失与未知都报错，不兜底成 generating', () => {
  assert.deepEqual(parseUpstreamStatus({ status: 'pending' }), { kind: 'queued' })
  assert.deepEqual(parseUpstreamStatus({ status: 'running' }), { kind: 'generating' })
  assert.deepEqual(parseUpstreamStatus({ status: 'pending_confirmation' }), { kind: 'confirming' })
  assert.deepEqual(parseUpstreamStatus({ status: 'done' }), { kind: 'done' })
  assert.deepEqual(parseUpstreamStatus({ status: 'abort' }), { kind: 'failed' })
  assert.throws(() => parseUpstreamStatus({}), LovartError)
  assert.throws(() => parseUpstreamStatus({ status: 'unknown' }), LovartError)
})

test('result 里的 pending_confirmation 用真值判断，对象也算待确认', () => {
  const result = parseChatResult({
    items: [
      { artifacts: [{ content: 'https://cdn/a.png' }, { content: 'https://cdn/a.png' }] },
      { artifacts: [{ content: 'https://cdn/b.png' }] },
      { text: '没有产物的消息' },
    ],
    pending_confirmation: { credits: 20 },
  })
  assert.deepEqual(result.urls, ['https://cdn/a.png', 'https://cdn/b.png'])
  assert.equal(result.pendingConfirmation, true)
})

test('缺 id 字段直接报错', () => {
  assert.equal(parseIdField({ thread_id: 't1' }, 'thread_id'), 't1')
  assert.throws(() => parseIdField({}, 'project_id'), LovartError)
})

test('工具入参补默认值且拒绝越界', () => {
  assert.deepEqual(parseGenerateArgs({ prompt: '  cat  ' }), {
    prompt: 'cat',
    model: 'nano-bn-2',
    ratio: '3:4',
    size: '2K',
    count: 1,
    refs: [],
    priority: 'normal',
  })
  assert.equal(parseGenerateArgs({ prompt: 'cat', size: '4k', count: 4 }).size, '4K')
  assert.throws(() => parseGenerateArgs({ prompt: '' }), LovartError)
  assert.throws(() => parseGenerateArgs({ prompt: 'cat', ratio: 'wide' }), LovartError)
  assert.throws(() => parseGenerateArgs({ prompt: 'cat', count: 0 }), LovartError)
  assert.throws(() => parseGenerateArgs({ prompt: 'cat', count: 5 }), LovartError)
  assert.equal(parseGenerateArgs({ prompt: 'cat', priority: 'high' }).priority, 'high')
  assert.throws(() => parseGenerateArgs({ prompt: 'cat', priority: 'urgent' }), LovartError)
})

test('refs 只收 http(s) URL，最多 8 张', () => {
  assert.deepEqual(parseGenerateArgs({ prompt: 'cat', refs: ['https://cdn/a.png'] }).refs, [
    'https://cdn/a.png',
  ])
  assert.throws(() => parseGenerateArgs({ prompt: 'cat', refs: ['ftp://cdn/a.png'] }), LovartError)
  assert.throws(() => parseGenerateArgs({ prompt: 'cat', refs: [''] }), LovartError)
  assert.throws(() => parseGenerateArgs({ prompt: 'cat', refs: 'https://cdn/a.png' }), LovartError)
  const nine = Array.from({ length: 9 }, (_item, index) => `https://cdn/${index}.png`)
  assert.throws(() => parseGenerateArgs({ prompt: 'cat', refs: nine }), LovartError)
})

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatOutcome } from '../src/host/job/result.ts'

test('formatOutcome：成功文本固定为张数 + 耗时 + 绝对路径', () => {
  assert.equal(
    formatOutcome({ kind: 'done', files: ['/a.png', '/b.png'], elapsedMs: 192_000 }, 'agent'),
    '已生成 2 张图（耗时 192s）\n/a.png\n/b.png',
  )
})

test('formatOutcome：失败与取消各只有一种句式', () => {
  assert.equal(
    formatOutcome({ kind: 'failed', message: '上游 402' }, 'agent'),
    '生成失败：上游 402',
  )
  assert.equal(formatOutcome({ kind: 'cancelled' }, 'agent'), '已取消')
})

test('formatOutcome：侧栏提交的结果多一句「不需要做任何事」', () => {
  const note = '这是用户在侧栏自己提交的任务，你不需要做任何事。'
  assert.equal(
    formatOutcome({ kind: 'done', files: ['/a.png'], elapsedMs: 1_000 }, 'user'),
    `已生成 1 张图（耗时 1s）\n/a.png\n${note}`,
  )
  assert.equal(formatOutcome({ kind: 'cancelled' }, 'user'), `已取消\n${note}`)
})

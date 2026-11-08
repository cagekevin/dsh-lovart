import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PHASE_TABLE, isTerminal, phaseFor } from '../src/host/job/phase.ts'

test('phaseFor：五种上游状态各归一位', () => {
  assert.equal(phaseFor({ kind: 'queued' }), 'queued')
  assert.equal(phaseFor({ kind: 'generating' }), 'generating')
  assert.equal(phaseFor({ kind: 'confirming' }), 'confirming')
  assert.equal(phaseFor({ kind: 'done' }), 'downloading')
  assert.equal(phaseFor({ kind: 'failed' }), 'failed')
})

test('PHASE_TABLE：waiting / confirming / downloading / 终态不占并发', () => {
  assert.equal(PHASE_TABLE.waiting.holdsSlot, false)
  assert.equal(PHASE_TABLE.confirming.holdsSlot, false)
  assert.equal(PHASE_TABLE.downloading.holdsSlot, false)
  assert.equal(PHASE_TABLE.done.holdsSlot, false)
  assert.equal(PHASE_TABLE.failed.holdsSlot, false)
  assert.equal(PHASE_TABLE.cancelled.holdsSlot, false)
  assert.equal(PHASE_TABLE.submitting.holdsSlot, true)
  assert.equal(PHASE_TABLE.queued.holdsSlot, true)
  assert.equal(PHASE_TABLE.generating.holdsSlot, true)
})

test('PHASE_TABLE.tone：外观档位随 phase 派生，前端不再自己判断', () => {
  assert.equal(PHASE_TABLE.waiting.tone, 'idle')
  assert.equal(PHASE_TABLE.confirming.tone, 'waiting')
  assert.equal(PHASE_TABLE.submitting.tone, 'active')
  assert.equal(PHASE_TABLE.queued.tone, 'active')
  assert.equal(PHASE_TABLE.generating.tone, 'active')
  assert.equal(PHASE_TABLE.downloading.tone, 'active')
  assert.equal(PHASE_TABLE.done.tone, 'done')
  assert.equal(PHASE_TABLE.failed.tone, 'done')
  assert.equal(PHASE_TABLE.cancelled.tone, 'done')
})

test('waiting 的进度行与徽章是「等待空位」/「等待中」，不与上游 queued 撞词', () => {
  assert.equal(PHASE_TABLE.waiting.progress, '等待空位')
  assert.equal(PHASE_TABLE.waiting.label, '等待中')
  assert.equal(PHASE_TABLE.queued.label, '排队中')
})

test('isTerminal：只有 done / failed / cancelled 是终态', () => {
  assert.equal(isTerminal('done'), true)
  assert.equal(isTerminal('failed'), true)
  assert.equal(isTerminal('cancelled'), true)
  assert.equal(isTerminal('waiting'), false)
  assert.equal(isTerminal('submitting'), false)
  assert.equal(isTerminal('queued'), false)
  assert.equal(isTerminal('generating'), false)
  assert.equal(isTerminal('confirming'), false)
  assert.equal(isTerminal('downloading'), false)
})

test('progress 文本：在跑的阶段有文案，终态为空串', () => {
  assert.equal(PHASE_TABLE.submitting.progress, '提交中')
  assert.equal(PHASE_TABLE.confirming.progress, '等你确认（会扣积分）')
  for (const phase of ['done', 'failed', 'cancelled'] as const) {
    assert.equal(PHASE_TABLE[phase].progress, '')
  }
})

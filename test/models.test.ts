import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MODEL_TABLE, resolveModel, toolConfigFor } from '../src/host/lovart/models.ts'
import { LovartError } from '../src/host/errors.ts'

test('表顺序优先：2.6 不会被 gpt-image-2 抢先', () => {
  assert.equal(resolveModel('gpt-image-2.6-sunburst-low').id, 'gpt-image-2.6-sunburst-low')
  assert.equal(resolveModel('gpt-image-2.6-flare-medium').id, 'gpt-image-2.6-flare-medium')
  assert.equal(resolveModel('gpt-image-2-high').id, 'gpt-image-2-high')
})

test('nano-bn-2-lite 不能被 nano-bn-2 抢先', () => {
  assert.equal(resolveModel('nano-bn-2-lite').id, 'nano-bn-2-lite')
  assert.equal(resolveModel('nano-bn-2').id, 'nano-bn-2')
})

test('空格与下划线写法等价，缺省是 nano-bn-2', () => {
  assert.equal(resolveModel('Nano Banana Pro').id, 'nano-bn-pro')
  assert.equal(resolveModel('gpt_image_2_medium').id, 'gpt-image-2-medium')
  assert.equal(resolveModel(undefined).id, 'nano-bn-2')
})

test('未知模型直接报错，不静默换模型', () => {
  assert.throws(
    () => resolveModel('mystery-model'),
    (error) => error instanceof LovartError && error.code === 'INVALID_INPUT',
  )
})

test('空工具名不下发 tool_config', () => {
  assert.equal(toolConfigFor(resolveModel('nano-bn-2-lite')), undefined)
  assert.deepEqual(toolConfigFor(resolveModel('nano-bn-pro')), {
    prefer_tool_categories: { IMAGE: ['generate_image_nano_banana_pro'] },
  })
})

test('模型表里没有重复 id', () => {
  const ids = MODEL_TABLE.map((model) => model.id)
  assert.equal(new Set(ids).size, ids.length)
})

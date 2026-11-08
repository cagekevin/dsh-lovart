import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPrompt } from '../src/host/lovart/prompt.ts'
import { resolveModel } from '../src/host/lovart/models.ts'

test('默认模型：分辨率与比例进文本，模型句逐字对齐上游', () => {
  assert.equal(
    buildPrompt({
      prompt: '一只戴帽子的猫',
      model: resolveModel('nano-bn-2'),
      ratio: '3:4',
      size: '2K',
    }),
    [
      'resolution: 2K, aspect_ratio: 3:4',
      'Generate exactly ONE image using the Nano Banana 2 model.',
      '<user_prompt>',
      '一只戴帽子的猫',
      '</user_prompt>',
      '以上为用户提示词原文，直接使用，请勿修改',
    ].join('\n'),
  )
})

test('质量档位拼在模型名之后', () => {
  const text = buildPrompt({
    prompt: 'cat',
    model: resolveModel('gpt-image-2-high'),
    ratio: '1:1',
    size: '4K',
  })
  assert.match(text, /^resolution: 4K, aspect_ratio: 1:1$/m)
  assert.match(text, /using the GPT Image 2 model, quality high\./)
})

test('有垫图时句首声明参考图，其余文本不变', () => {
  const text = buildPrompt({
    prompt: 'cat',
    model: resolveModel('nano-bn-2'),
    ratio: '3:4',
    size: '2K',
    hasRefs: true,
  })
  assert.match(
    text,
    /^Reference image attached\. Generate exactly ONE image using the Nano Banana 2 model\.$/m,
  )
})

test('prompt 原文不被改写，ratio 不进入 API body 的判据只在文本里', () => {
  const raw = '  换行\n与  空格都保留  '
  const text = buildPrompt({
    prompt: raw,
    model: resolveModel('nano-bn-pro'),
    ratio: '16:9',
    size: '1K',
  })
  assert.ok(text.includes(`<user_prompt>\n${raw}\n</user_prompt>`))
})

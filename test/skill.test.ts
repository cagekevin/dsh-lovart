import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  LOVART_SKILL,
  LOVART_SKILL_BODY,
  LOVART_SKILL_DESCRIPTION,
  LOVART_SKILL_NAME,
  LOVART_SKILL_WHEN_TO_USE,
} from '../src/host/skill.ts'

test('skill 名字是 kebab-case，与 DSH 的技能名语法一致', () => {
  assert.match(LOVART_SKILL_NAME, /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)
  assert.equal(LOVART_SKILL.name, LOVART_SKILL_NAME)
})

test('常驻文案不为空：description 决定要不要用，whenToUse 决定什么时候想起来', () => {
  assert.ok(LOVART_SKILL_DESCRIPTION.length > 0)
  assert.ok(LOVART_SKILL_WHEN_TO_USE.length > 0)
  assert.equal(LOVART_SKILL.description, LOVART_SKILL_DESCRIPTION)
  assert.equal(LOVART_SKILL.whenToUse, LOVART_SKILL_WHEN_TO_USE)
})

test('正文写清五件事：触发语、排队不重试、完成只汇报、编号指认、红线', () => {
  assert.match(LOVART_SKILL_BODY, /lovart 作图/)
  assert.match(LOVART_SKILL_BODY, /自动排队/)
  assert.match(LOVART_SKILL_BODY, /不要轮询/)
  assert.match(LOVART_SKILL_BODY, /job_output/)
  assert.match(LOVART_SKILL_BODY, /什么都不要做/)
  assert.match(LOVART_SKILL_BODY, /扣积分/)
  assert.match(LOVART_SKILL_BODY, /lovart\//)
  assert.equal(LOVART_SKILL.content, LOVART_SKILL_BODY)
})

test('正文与两条工具对齐：snapshot 看台面、priority 插队、seq 指认', () => {
  assert.match(LOVART_SKILL_BODY, /lovart_board/)
  assert.match(LOVART_SKILL_BODY, /priority: 'high'/)
  assert.match(LOVART_SKILL_BODY, /seq/)
  assert.match(LOVART_SKILL_BODY, /不要用「排第几」/)
})

test('source 用 runtime：随插件注册，不落文件', () => {
  assert.equal(LOVART_SKILL.source, 'runtime')
})

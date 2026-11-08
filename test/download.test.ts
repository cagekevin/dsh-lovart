import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  extensionFor,
  fileName,
  slugify,
  stamp,
} from '../src/host/job/download.ts'

test('slug：换行与制表变空格，非法字符删除，空白折叠为下划线', () => {
  assert.equal(slugify('一只戴帽子的猫'), '一只戴帽子的猫')
  assert.equal(slugify('a/b:c*d?e"f<g>h|i'), 'abcdefghi')
  assert.equal(slugify('  换行\n与\t制表  '), '换行_与_制表')
})

test('slug：截断 40 字，空提示词回落 prompt', () => {
  assert.equal(Array.from(slugify('猫'.repeat(50))).length, 40)
  assert.equal(slugify('///'), 'prompt')
  assert.equal(slugify('   '), 'prompt')
})

test('扩展名按 Content-Type，未知与缺失兜底 .png', () => {
  assert.equal(extensionFor('image/png'), '.png')
  assert.equal(extensionFor('image/jpeg; charset=binary'), '.jpg')
  assert.equal(extensionFor('image/webp'), '.webp')
  assert.equal(extensionFor('application/octet-stream'), '.png')
  assert.equal(extensionFor(undefined), '.png')
})

test('时间戳用本地时间，固定 15 位', () => {
  assert.equal(stamp(new Date(2026, 10, 8, 12, 15, 30)), '20261108-121530')
})

test('同名不覆盖：第 2 个起加 -2，后缀在扩展名前', () => {
  assert.equal(fileName('20261108-121530_猫', 1, '.png'), '20261108-121530_猫.png')
  assert.equal(fileName('20261108-121530_猫', 2, '.png'), '20261108-121530_猫-2.png')
})

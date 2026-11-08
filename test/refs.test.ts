/**
 * 垫图协议层：data URL 解析、大小上限、上传响应窄化。
 *
 * 这些判断必须在 host 侧成立；浏览器只是把文件读成 data URL，不决定尺寸与类型。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LovartError } from '../src/host/errors.ts'
import {
  MAX_REF_BYTES,
  parseRefUpload,
  parseUploadUrl,
} from '../src/host/lovart/refs.ts'

test('data URL：解出 MIME / 文件名 / 原始字节', () => {
  const file = parseRefUpload({
    name: '一只猫.PNG',
    dataUrl: 'data:image/png;base64,AAEC',
  })
  assert.equal(file.contentType, 'image/png')
  assert.equal(file.filename, '一只猫.PNG')
  assert.deepEqual([...file.bytes], [0, 1, 2])
})

test('data URL：缺扩展名时按 MIME 补，非法字符替换为下划线', () => {
  const file = parseRefUpload({ name: 'cat pic', dataUrl: 'data:image/jpeg;base64,AAEC' })
  assert.equal(file.filename, 'cat_pic.jpg')
})

test('data URL：只收 png / jpeg / webp / gif', () => {
  assert.throws(
    () => parseRefUpload({ name: 'a.txt', dataUrl: 'data:text/plain;base64,AAEC' }),
    LovartError,
  )
  assert.throws(() => parseRefUpload({ name: 'a.png', dataUrl: 'https://cdn/a.png' }), LovartError)
  assert.throws(() => parseRefUpload({}), LovartError)
})

test('data URL：空内容与超上限都拒绝', () => {
  assert.throws(() => parseRefUpload({ name: 'a.png', dataUrl: 'data:image/png;base64,' }), LovartError)
  const oversized = Buffer.alloc(MAX_REF_BYTES + 1).toString('base64')
  assert.throws(
    () => parseRefUpload({ name: 'a.png', dataUrl: `data:image/png;base64,${oversized}` }),
    LovartError,
  )
})

test('上传响应：只认 data.url，缺字段或协议不对都报错', () => {
  assert.equal(parseUploadUrl({ url: 'https://cdn.example.com/a.png' }), 'https://cdn.example.com/a.png')
  assert.throws(() => parseUploadUrl({}), LovartError)
  assert.throws(() => parseUploadUrl({ url: '' }), LovartError)
  assert.throws(() => parseUploadUrl({ url: 'file:///tmp/a.png' }), LovartError)
})

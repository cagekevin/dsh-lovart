import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hmacSha256Hex, signRequest } from '../src/host/lovart/sign.ts'

// RFC 4231 §4.2：密钥 "Jefe"，数据 "what do ya want for nothing?"。
test('RFC 4231 case 2：HMAC-SHA256 向量', () => {
  assert.equal(
    hmacSha256Hex('Jefe', 'what do ya want for nothing?'),
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
  )
})

// 真值由 openssl 独立算出，不用本实现自证：
// printf 'GET\n/v1/openapi/chat/status\n1700000000' | openssl dgst -sha256 -hmac 'test-secret'
test('GET 签名串固定为 METHOD\\npath\\ntimestamp', () => {
  assert.equal(
    signRequest('GET', '/v1/openapi/chat/status', '1700000000', 'test-secret'),
    'b02b526bb8ad6ea6698c4733bd40711a8a6d3c4c9f3c52a4bf234faff14c143c',
  )
})

test('POST 与 GET 同 path 同时间戳仍得到不同签名', () => {
  assert.equal(
    signRequest('POST', '/v1/openapi/chat', '1700000000', 'test-secret'),
    'c4a25be0bcf1009be6c49f8d14b5207f20093ec8ef0530277b97f54ef05b8e63',
  )
})

test('method 或 timestamp 变一位，签名必变', () => {
  const base = signRequest('GET', '/v1/openapi/chat/status', '1700000000', 'test-secret')
  assert.notEqual(base, signRequest('POST', '/v1/openapi/chat/status', '1700000000', 'test-secret'))
  assert.notEqual(base, signRequest('GET', '/v1/openapi/chat/status', '1700000001', 'test-secret'))
})

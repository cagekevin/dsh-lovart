/**
 * P2 签名（规范 §3 P2 / §6 C1）。
 *
 * 唯一实现：签名串的换行拼接与 hex 编码只在这里出现，request.ts 只调 signRequest。
 * path 必须含 `/v1/openapi` 前缀，且**不含 query**；query 只进 URL，不进签名串。
 */

import { createHmac } from 'node:crypto'

/** HMAC-SHA256 十六进制摘要；单独导出只为 RFC 4231 向量测试，业务只调 signRequest。 */
export function hmacSha256Hex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex')
}

/** 上游签名：`${METHOD}\n${path}\n${timestamp}`，timestamp 为秒级 Unix 时间。 */
export function signRequest(
  method: 'GET' | 'POST',
  path: string,
  timestamp: string,
  secret: string,
): string {
  return hmacSha256Hex(secret, `${method}\n${path}\n${timestamp}`)
}

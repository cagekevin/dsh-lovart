/**
 * 垫图上传协议层：只做 data URL 解析、大小/类型校验与上传响应窄化。
 *
 * 唯一入口：`route.ts` 的 `POST /lovart/api/refs` 收浏览器给的 data URL，
 * 解析成字节后交给 `api.uploadFile()` 转发到上游 `/v1/openapi/file/upload`。
 * 浏览器永远拿不到上游凭据，也不直连上游。
 *
 * 为什么不收本地路径：浏览器拿不到沙箱外的绝对路径；data URL 是唯一可移植的输入。
 * 为什么失败要整批拒绝：静默丢一张参考图会把图生图悄悄降级成文生图（规范 §6 C1）。
 */

import { LovartError } from '../errors.ts'
import { asRecord } from './types.ts'

/** 单张参考图上传上限；与参考实现 ui/app.js 的粘贴上限一致。 */
export const MAX_REF_BYTES = 10 * 1024 * 1024

export interface RefUpload {
  readonly filename: string
  readonly contentType: string
  readonly bytes: Uint8Array
}

const DATA_URL = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/

const EXT_BY_TYPE: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** 浏览器上传体窄化：`{name, dataUrl}`，大小与 MIME 都在这里判死。 */
export function parseRefUpload(payload: unknown): RefUpload {
  const record = asRecord(payload)
  if (record === undefined) throw LovartError.invalidInput('上传参数必须是对象')

  const dataUrl = typeof record.dataUrl === 'string' ? record.dataUrl.trim() : ''
  if (dataUrl.length === 0) throw LovartError.invalidInput('缺少 dataUrl')

  const match = DATA_URL.exec(dataUrl)
  if (match === null) {
    throw LovartError.invalidInput('只支持 png / jpeg / webp / gif 的 base64 data URL')
  }
  const contentType = match[1]
  const base64 = match[2]
  if (contentType === undefined || base64 === undefined) {
    throw LovartError.invalidInput('只支持 png / jpeg / webp / gif 的 base64 data URL')
  }

  const bytes = new Uint8Array(Buffer.from(base64, 'base64'))
  if (bytes.byteLength === 0) throw LovartError.invalidInput('参考图内容为空')
  if (bytes.byteLength > MAX_REF_BYTES) {
    throw LovartError.invalidInput(`单张参考图不能超过 ${MAX_REF_BYTES / 1024 / 1024}MB`)
  }

  const ext = EXT_BY_TYPE[contentType]
  if (ext === undefined) throw LovartError.invalidInput(`不支持的参考图类型：${contentType}`)

  return { filename: filenameOf(record.name, ext), contentType, bytes }
}

/** 公共 CDN 地址；上游只回 `data.url`，缺失就是协议变更，直接报错。 */
export function parseUploadUrl(payload: unknown): string {
  const url = asRecord(payload)?.url
  if (typeof url !== 'string' || url.length === 0) {
    throw LovartError.upstream('上传响应缺少 url')
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw LovartError.upstream(`上传响应里的 url 不合法：${url}`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw LovartError.upstream(`上传响应里的 url 协议不支持：${parsed.protocol}`)
  }
  return url
}

/** 文件名只用于 multipart 的 filename，不参与落盘；保留原扩展名，缺失则按 MIME 补。 */
function filenameOf(value: unknown, ext: string): string {
  const raw = typeof value === 'string' ? value : ''
  const base = raw
    .replace(/^.*[\\/]/, '')
    .replace(/[^\w.\-\u4e00-\u9fa5]/g, '_')
    .slice(0, 80)
  if (base.length === 0 || base === '.') return `ref.${ext}`
  return /\.[A-Za-z0-9]+$/.test(base) ? base : `${base}.${ext}`
}

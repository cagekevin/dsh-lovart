/**
 * P2 + P3 唯一出网口（ADR-0009 第一级：写不出来）。
 *
 * 全局 fetch 在 TS 层禁不掉；这里让第二处没必要存在：
 * - baseUrl、凭据解析、超时只存在于 createLovartClient 的闭包里；
 * - 其他模块只拿到 LovartClient，没有 url / credential / 通用 request 可用；
 * - 新增端点只动 api.ts，其它文件不出现 baseUrl / host。
 *
 * 方法签名就是策略：没有 timeout 参数、没有重试参数。POST 失败绝不重发；
 * GET 的再次尝试由 run() 的下一轮轮询完成（规范 §5.2）。
 */

import { LovartError } from '../errors.ts'
import { asRecord } from './types.ts'
import { signRequest } from './sign.ts'

/** 上游凭据；只在 createLovartClient 的 resolveCredential 回调里出现。 */
export interface Credential {
  accessKey: string
  secretKey: string
}

/** 下载回来的原始字节；落盘归 job/download.ts。 */
export interface DownloadedFile {
  readonly bytes: Uint8Array
  readonly contentType: string | undefined
}

/** 上传参考图的字节；filename 只进 multipart，不参与落盘。 */
export interface UploadFile {
  readonly filename: string
  readonly contentType: string
  readonly bytes: Uint8Array
}

/** 其他模块能拿到的全部出网能力；没有通用 request，也没有 url 参数。 */
export interface LovartClient {
  /** 返回信封里的 `data`；形状由调用方在 types.ts 里窄化。 */
  signedGet(path: string, query?: Readonly<Record<string, string>>): Promise<unknown>
  signedPost(path: string, body?: unknown): Promise<unknown>
  /** multipart 上传；Content-Type 交给 fetch 生成边界，不手写。 */
  signedUpload(path: string, file: UploadFile): Promise<unknown>
  /** CDN 下载；不走签名，但仍只在本文件出网。 */
  download(url: string): Promise<DownloadedFile>
}

/** 创建 client 的入参；只有 apply 装配时会遇到，业务模块见不到。 */
export interface ClientOptions {
  baseUrl: string
  resolveCredential: () => Promise<Credential>
}

const API_TIMEOUT_MS = 30_000
const DOWNLOAD_TIMEOUT_MS = 120_000
/** 上传可能到 10MB，给比普通 API 更长的超时；仍然只在本文件出网。 */
const UPLOAD_TIMEOUT_MS = 120_000
const USER_AGENT = 'LovartAgentSkill/1.0'

function parseJson(text: string): unknown {
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function envelopeError(payload: unknown, status: number, text: string): LovartError {
  const record = asRecord(payload)
  const message =
    typeof record?.message === 'string'
      ? record.message
      : typeof record?.error === 'string'
        ? record.error
        : ''
  const code = record?.code
  if (typeof code === 'number' && code !== 0) {
    return LovartError.upstream(message.length > 0 ? message : `上游业务码 ${code}`, code)
  }
  const detail = message.length > 0 ? message : text.slice(0, 200)
  return LovartError.upstream(detail.length > 0 ? `上游 HTTP ${status}：${detail}` : `上游 HTTP ${status}`)
}

/** 先解 `{code, data}` 信封，再看 HTTP 码（规范 §3 P3）。 */
function unwrapEnvelope(payload: unknown, status: number, text: string): unknown {
  const ok = status >= 200 && status < 300
  const record = asRecord(payload)
  if (record === undefined) {
    if (!ok) throw envelopeError(payload, status, text)
    return payload
  }
  if (record.code !== undefined) {
    // 严格 === 0；字符串 "0" 也算错。
    if (record.code !== 0) throw envelopeError(payload, status, text)
    if (!ok) throw envelopeError(payload, status, text)
    return record.data ?? record
  }
  if (!ok) throw envelopeError(payload, status, text)
  return record
}

/** 唯一出网工厂；闭包持有 baseUrl、凭据解析与超时。 */
export function createLovartClient(options: ClientOptions): LovartClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '')

  async function authorizedHeaders(
    method: 'GET' | 'POST',
    path: string,
  ): Promise<Record<string, string>> {
    const credential = await options.resolveCredential()
    const timestamp = String(Math.floor(Date.now() / 1000))
    // 签名只覆盖 path，不含 query（与上游客户端一致）。
    const signature = signRequest(method, path, timestamp, credential.secretKey)
    return {
      'X-Access-Key': credential.accessKey,
      'X-Timestamp': timestamp,
      'X-Signature': signature,
      'X-Signed-Method': method,
      'X-Signed-Path': path,
      'User-Agent': USER_AGENT,
    }
  }

  async function send(
    method: 'GET' | 'POST',
    path: string,
    query: Readonly<Record<string, string>> | undefined,
    body: unknown,
  ): Promise<unknown> {
    const headers = await authorizedHeaders(method, path)

    const url = new URL(`${baseUrl}${path}`)
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value)

    if (body !== undefined) headers['Content-Type'] = 'application/json'

    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      })
    } catch (error) {
      throw LovartError.upstream('无法连接 Lovart 上游', undefined, error)
    }

    const text = await response.text()
    return unwrapEnvelope(parseJson(text), response.status, text)
  }

  return {
    signedGet: (path, query) => send('GET', path, query, undefined),
    signedPost: (path, body) => send('POST', path, undefined, body),
    async signedUpload(path, file) {
      const headers = await authorizedHeaders('POST', path)
      // 不写 Content-Type：multipart boundary 必须由 fetch/FormData 自己生成。
      const form = new FormData()
      // 复制成普通 ArrayBuffer 支撑的视图，Blob 不接受 SharedArrayBuffer 后端。
      form.append('file', new Blob([Uint8Array.from(file.bytes)], { type: file.contentType }), file.filename)

      let response: Response
      try {
        response = await fetch(new URL(`${baseUrl}${path}`), {
          method: 'POST',
          headers,
          body: form,
          signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
        })
      } catch (error) {
        throw LovartError.upstream('上传参考图失败：无法连接 Lovart 上游', undefined, error)
      }

      const text = await response.text()
      return unwrapEnvelope(parseJson(text), response.status, text)
    },
    async download(url) {
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        throw LovartError.upstream(`无效的下载地址：${url}`)
      }
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw LovartError.upstream(`不支持的下载协议：${parsed.protocol}`)
      }
      let response: Response
      try {
        response = await fetch(parsed, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
      } catch (error) {
        throw LovartError.upstream('下载图片失败：无法连接 CDN', undefined, error)
      }
      if (!response.ok) throw LovartError.upstream(`下载图片失败：HTTP ${response.status}`)
      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType: response.headers.get('content-type') ?? undefined,
      }
    },
  }
}

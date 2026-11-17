/**
 * 垫图上传协议层：把任意形态的参考图统一成上游要的字节，再把上传响应窄化成 CDN 地址。
 *
 * 两个入口共用这一份：
 * - `route.ts` 的 `POST /lovart/api/refs`：浏览器给的 data URL（`parseRefUpload`）；
 * - `resolveRefs`：`lovart_generate` / `POST /lovart/api/jobs` 的 `refs` 各项，
 *   可以是 CDN 地址、本地路径或 data URL。
 *
 * 上游 `/v1/openapi/file/upload` 只吃字节，不吃路径 —— 所以「本地图」与「粘贴图」
 * 在字节这一层是同一件事，差别只在字节从哪来。三种形态因此收敛到同一次 `upload`。
 *
 * 为什么失败要整批拒绝：静默丢一张参考图会把图生图悄悄降级成文生图（规范 §6 C1）。
 */

import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { LovartError } from '../errors.ts'
import { asRecord } from './types.ts'

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

/** 浏览器上传体窄化：`{name, dataUrl}`，MIME 在这里判死（只收四种图片类型）。 */
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

  const ext = EXT_BY_TYPE[contentType]
  if (ext === undefined) throw LovartError.invalidInput(`不支持的参考图类型：${contentType}`)

  return { filename: filenameOf(record.name, ext), contentType, bytes }
}

/** 上游要的四种图片类型；`sniffImageType` 与 data URL 解析共用这一张表。 */
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
type ImageType = (typeof IMAGE_TYPES)[number]

/**
 * 按文件头认类型，不看扩展名。
 *
 * 理由不是「更严格」，是更省事：扩展名不可信（`.png` 可能是别的），
 * 而认文件头就不必维护「扩展名 → MIME」的反查表，也不会传错 `contentType`。
 */
function sniffImageType(bytes: Uint8Array): ImageType | undefined {
  const at = (index: number): number => bytes[index] ?? -1
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png'
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg'
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return 'image/gif'
  // WEBP = "RIFF" + 4 字节长度 + "WEBP"
  if (
    at(0) === 0x52 &&
    at(1) === 0x49 &&
    at(2) === 0x46 &&
    at(3) === 0x46 &&
    at(8) === 0x57 &&
    at(9) === 0x45 &&
    at(10) === 0x42 &&
    at(11) === 0x50
  ) {
    return 'image/webp'
  }
  return undefined
}

/** 把一张本地图片读成上传体；相对路径按 `cwd` 解析，绝对路径直接用。 */
async function readLocalRef(path: string, cwd: string): Promise<RefUpload> {
  const absolute = isAbsolute(path) ? path : resolve(cwd, path)
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await readFile(absolute))
  } catch {
    // 不转发 fs 的 errno：调用方要的是「哪张图、哪个路径」，不是 ENOENT/EACCES 的区分。
    throw LovartError.invalidInput(`读不到参考图：${absolute}`)
  }
  if (bytes.byteLength === 0) throw LovartError.invalidInput(`参考图内容为空：${absolute}`)

  const contentType = sniffImageType(bytes)
  if (contentType === undefined) {
    throw LovartError.invalidInput(`参考图不是 png / jpeg / webp / gif：${absolute}`)
  }
  const ext = EXT_BY_TYPE[contentType] ?? 'png'
  return { filename: filenameOf(path, ext), contentType, bytes }
}

/**
 * `refs` 各项统一成 CDN 地址（规范 §5.1 垫图链路的唯一实现）。
 *
 * 三种形态收敛到同一次 `upload`：
 * - `http(s)://` → 已经是 CDN 地址，原样返回，不重复上传；
 * - `data:` → 解出字节后上传；
 * - 其他 → 当本地路径读成字节后上传（相对路径按 `cwd`）。
 *
 * 任一张失败就整批抛出，不跳过、不降级 —— 少一张参考图会把图生图悄悄变成文生图。
 * 必须在 `startLovartJobs` 之前调用一次：`count > 1` 时同批图只上传一次，
 * 由各 job 复用同一批 URL（规范 §5.1「重跑直接复用 URL，不二次上传」）。
 */
export async function resolveRefs(
  refs: readonly string[],
  cwd: string,
  upload: (file: RefUpload) => Promise<string>,
): Promise<string[]> {
  const resolved: string[] = []
  for (const ref of refs) {
    if (ref.startsWith('http://') || ref.startsWith('https://')) {
      resolved.push(ref)
      continue
    }
    const file = ref.startsWith('data:')
      ? parseRefUpload({ dataUrl: ref })
      : await readLocalRef(ref, cwd)
    resolved.push(await upload(file))
  }
  return resolved
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

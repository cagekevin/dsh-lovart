/**
 * 上游形状与工具入参的唯一窄化入口（ADR-0009 第二级范本）。
 *
 * 所有 `unknown` 只在这里被解析成判别联合或具体字段；其他模块不再写 `as`。
 * 新增上游状态必须补 `STATUS_BY_UPSTREAM`，否则解析时直接报错，不兜底成 generating。
 */

import { LovartError } from '../errors.ts'
import {
  DEFAULT_MODEL_ID,
  DEFAULT_RATIO,
  DEFAULT_SIZE,
  isSize,
  type Size,
} from './models.ts'

export type { Size } from './models.ts'

/** 上游状态；与 `job/phase.ts` 的 Phase 是两个粒度。 */
export type UpstreamStatus =
  | { kind: 'queued' }
  | { kind: 'generating' }
  | { kind: 'confirming' }
  | { kind: 'done' }
  | { kind: 'failed' }

const STATUS_BY_UPSTREAM: Readonly<Record<string, UpstreamStatus['kind']>> = {
  pending: 'queued',
  running: 'generating',
  pending_confirmation: 'confirming',
  done: 'done',
  abort: 'failed',
}

/** 对象窄化；数组与 null 都视为非对象。 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** 上游 status 字段窄化；缺失或未识别一律报错（规范 §4.3）。 */
export function parseUpstreamStatus(payload: unknown): UpstreamStatus {
  const status = asRecord(payload)?.status
  if (typeof status !== 'string') throw LovartError.upstream('上游响应缺少 status 字段')
  const kind = STATUS_BY_UPSTREAM[status]
  if (kind === undefined) throw LovartError.upstream(`未识别的上游状态：${status}`)
  return { kind }
}

/** `chat/result` 里本插件需要的两个字段。 */
export interface ChatResult {
  readonly urls: string[]
  /** `pending_confirmation` 是对象，必须用真值判断（规范 §6 C1 第 2 条）。 */
  readonly pendingConfirmation: boolean
}

/** 从 items[].artifacts[].content 收集图片地址，保持顺序并去重。 */
export function parseChatResult(payload: unknown): ChatResult {
  const record = asRecord(payload)
  if (record === undefined) throw LovartError.upstream('chat/result 响应不是对象')
  const urls: string[] = []
  const items = Array.isArray(record.items) ? record.items : []
  for (const item of items) {
    const artifacts = asRecord(item)?.artifacts
    if (!Array.isArray(artifacts)) continue
    for (const artifact of artifacts) {
      const content = asRecord(artifact)?.content
      if (typeof content === 'string' && content.length > 0 && !urls.includes(content)) {
        urls.push(content)
      }
    }
  }
  return { urls, pendingConfirmation: Boolean(record.pending_confirmation) }
}

/** 取上游返回的 id 字段；缺失即报错，不拿空串继续跑。 */
export function parseIdField(payload: unknown, field: 'thread_id' | 'project_id'): string {
  const value = asRecord(payload)?.[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw LovartError.upstream(`上游响应缺少 ${field}`)
  }
  return value
}

/** 单次任务最多参考图张数；与参考实现单次粘贴上限一致（没有上游硬上限）。 */
export const MAX_REFS = 8

/** 单次提交的任务数上限；与并发闸同值，前端下拉也从这里派生。 */
export const MAX_COUNT = 4

/**
 * 本地排队优先级。
 *
 * `high` 只对**还没提交给上游**的任务有意义：它决定谁先占槽，
 * 一旦提交，上游自己的排队就改不了了。
 */
export type Priority = 'high' | 'normal'

/** `lovart_generate` 的已校验入参；工具与路由都只消费这个形状。 */
export interface GenerateArgs {
  readonly prompt: string
  readonly model: string
  readonly ratio: string
  readonly size: Size
  readonly count: number
  /** 参考图 CDN 地址；本地文件已由 `/lovart/api/refs` 上传成 URL。 */
  readonly refs: readonly string[]
  /** 默认 `normal`；`high` 会插到所有 normal 前面。 */
  readonly priority: Priority
}

const RATIO_PATTERN = /^\d{1,3}:\d{1,3}$/

function parseSize(value: unknown): Size {
  const upper = typeof value === 'string' ? value.toUpperCase() : ''
  if (isSize(upper)) return upper
  throw LovartError.invalidInput('size 只能是 1K / 2K / 4K')
}

/** 参考图只接受 http(s) URL，上游只存 URL；空数组等价于不传。 */
export function parseRefUrls(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw LovartError.invalidInput('refs 必须是 URL 数组')
  if (value.length > MAX_REFS) throw LovartError.invalidInput(`参考图最多 ${MAX_REFS} 张`)
  return value.map((item) => {
    if (typeof item !== 'string' || item.trim().length === 0) {
      throw LovartError.invalidInput('refs 里每项都必须是非空 URL')
    }
    const url = item.trim()
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw LovartError.invalidInput(`参考图不是合法 URL：${url}`)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw LovartError.invalidInput('参考图只接受 http/https URL')
    }
    return url
  })
}

/** 工具入参窄化；缺省值只在这里补一次，下游不再写 `??`。 */
export function parseGenerateArgs(value: unknown): GenerateArgs {
  const record = asRecord(value)
  if (record === undefined) throw LovartError.invalidInput('参数必须是对象')

  const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : ''
  if (prompt.length === 0) throw LovartError.invalidInput('prompt 不能为空')

  const model =
    record.model === undefined
      ? DEFAULT_MODEL_ID
      : typeof record.model === 'string' && record.model.trim().length > 0
        ? record.model.trim()
        : undefined
  if (model === undefined) throw LovartError.invalidInput('model 必须是非空字符串')

  const ratio = record.ratio === undefined ? DEFAULT_RATIO : record.ratio
  if (typeof ratio !== 'string' || !RATIO_PATTERN.test(ratio)) {
    throw LovartError.invalidInput('ratio 必须形如 3:4')
  }

  const size = parseSize(record.size === undefined ? DEFAULT_SIZE : record.size)

  const count = record.count === undefined ? 1 : record.count
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
    throw LovartError.invalidInput(`count 必须是 1..${MAX_COUNT} 的整数`)
  }

  const refs = parseRefUrls(record.refs)

  const priority = record.priority === undefined ? 'normal' : record.priority
  if (priority !== 'high' && priority !== 'normal') {
    throw LovartError.invalidInput('priority 只能是 high 或 normal')
  }

  return { prompt, model, ratio, size, count, refs, priority }
}

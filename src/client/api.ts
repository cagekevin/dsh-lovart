/**
 * 侧栏对 host 的唯一 HTTP 入口：只调 `/lovart/api/*`。
 *
 * 只打同源路由，不碰 Lovart 上游；上游请求仍只有 host 的 `request.ts` 一个出口。
 * 错误文案一律用后端 `{error}`；只有连不上或响应不是 JSON 时才用兜底文案。
 * 返回体逐层窄化，不 `as any`：字段缺失就报「后端返回格式不正确」。
 */

const BASE = '/lovart/api'

/** 徽章外观档位；与 host 的 `PHASE_TABLE.tone` 同一套取值，前端只读不推导。 */
export type PhaseTone = 'active' | 'waiting' | 'done' | 'idle'

const TONES: readonly PhaseTone[] = ['active', 'waiting', 'done', 'idle']

function isPhaseTone(value: unknown): value is PhaseTone {
  return typeof value === 'string' && (TONES as readonly string[]).includes(value)
}

/** 侧栏需要的任务字段；与 host 的 LovartMeta 同形，只取展示用到的部分。 */
export interface JobMeta {
  readonly jobId: string
  readonly prompt: string
  readonly model: string
  readonly ratio: string
  readonly size: string
  /** 参考图 CDN 地址；重跑时原样带回，不重新上传。 */
  readonly refs: string[]
  /** 会话内递增的展示编号；人和 AI 用它指认任务，位次会变、它不会。 */
  readonly seq: number
  readonly phase: string
  /** 阶段徽章文案；由 host 的 PHASE_TABLE 派生，前端不再写一份映射。 */
  readonly phaseLabel: string
  /** 徽章外观档位；同样由 host 派生，前端不按 phase 判断。 */
  readonly tone: PhaseTone
  /** 终态标记；决定显示「耗时」还是「已跑」、是否给重跑按钮。 */
  readonly terminal: boolean
  readonly files: string[]
  readonly confirmCount: number
  readonly createdAt: number
  readonly settledAt?: number
  readonly error?: string
}

/** 提交参数；`sessionId` 必填，取自侧栏 scope，不放 query。 */
export interface SubmitInput {
  readonly sessionId: string
  readonly prompt: string
  readonly model?: string
  readonly ratio?: string
  readonly size?: string
  readonly count?: number
  /** 已上传的参考图 URL；空数组等价于不传。 */
  readonly refs?: readonly string[]
}

/** 单张参考图的上传体；host 只收 data URL，浏览器碰不到上游凭据。 */
export interface RefUploadInput {
  readonly name: string
  readonly dataUrl: string
}

/** 模型下拉项；`name` 是给人看的可读名。 */
export interface ModelOption {
  readonly id: string
  readonly name: string
}

/** 出图选项；全部由 `GET /options` 派生，前端不写第二份模型/比例/尺寸表。 */
export interface Options {
  readonly models: readonly ModelOption[]
  readonly ratios: readonly string[]
  readonly sizes: readonly string[]
  readonly defaults: {
    readonly model: string
    readonly ratio: string
    readonly size: string
  }
  readonly maxCount: number
  readonly maxRefs: number
}

/** 凭据状态；`writable` 为假时侧栏不显示输入框（填了也存不进去）。 */
export interface Health {
  readonly credentials: boolean
  readonly credentialsWritable: boolean
}

/** 一对要写进 DSH 凭据库的 key；插件不落盘、不缓存。 */
export interface CredentialPair {
  readonly accessKey: string
  readonly secretKey: string
}

/** 图墙：只拉本会话；`sessionId` 走 query（读接口不带 body）。 */
export async function listJobs(sessionId: string): Promise<JobMeta[]> {
  const payload = await call('GET', `/jobs?${queryOf(sessionId)}`)
  if (!Array.isArray(payload)) throw new Error('后端返回格式不正确')
  return payload.map(readJob)
}

/** 侧栏提交：POST /jobs，body 里带 sessionId 与出图参数。 */
export async function createJobs(input: SubmitInput): Promise<JobMeta[]> {
  const payload = await call('POST', '/jobs', input)
  if (!isRecord(payload) || !Array.isArray(payload.jobs)) {
    throw new Error('后端返回格式不正确')
  }
  return payload.jobs.map(readJob)
}

/** 人工确认：唯一会触发扣积分的调用，失败只展示后端文案。 */
export async function confirmJob(jobId: string, sessionId: string): Promise<JobMeta> {
  return readJob(
    await call('POST', `/jobs/${encodeURIComponent(jobId)}/confirm`, { sessionId }),
  )
}

/** 删任务：只对终态开放；host 会把磁盘上的图一起删掉。DELETE 不带 body，`sessionId` 走 query。 */
export async function deleteJob(jobId: string, sessionId: string): Promise<void> {
  await call('DELETE', `/jobs/${encodeURIComponent(jobId)}?${queryOf(sessionId)}`)
}

/**
 * 取消 = 放弃这个任务，图也不要了。
 *
 * 不会让上游停下（C1 没有中止端点），只是本地不再等、不再下载，并清掉已落盘的部分。
 */
export async function cancelJob(jobId: string, sessionId: string): Promise<JobMeta> {
  return readJob(
    await call('POST', `/jobs/${encodeURIComponent(jobId)}/cancel`, { sessionId }),
  )
}

/** 上传一张参考图：返回上游 CDN URL；失败直接抛，由调用方整批丢弃。 */
export async function uploadRef(input: RefUploadInput): Promise<string> {
  const payload = await call('POST', '/refs', input)
  if (!isRecord(payload) || typeof payload.url !== 'string' || payload.url === '') {
    throw new Error('后端返回格式不正确')
  }
  return payload.url
}

/** 拉取出图选项；下拉框只能来自这里，缺字段就报错，不回落成前端硬编码。 */
export async function loadOptions(): Promise<Options> {
  return readOptions(await call('GET', '/options'))
}

/** 读凭据状态；决定侧栏显不显示「填 key」那块。 */
export async function loadHealth(): Promise<Health> {
  const payload = await call('GET', '/health')
  if (
    !isRecord(payload) ||
    typeof payload.credentials !== 'boolean' ||
    typeof payload.credentialsWritable !== 'boolean'
  ) {
    throw new Error('后端返回格式不正确')
  }
  return { credentials: payload.credentials, credentialsWritable: payload.credentialsWritable }
}

/** 写入凭据；成功即已落进 DSH 凭据库，下一次请求就会生效。 */
export async function saveCredentials(pair: CredentialPair): Promise<void> {
  await call('POST', '/credentials', pair)
}

async function call(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload: unknown = await response.json().catch(() => undefined)
  if (!response.ok) throw new Error(errorOf(payload) ?? `请求失败（HTTP ${response.status}）`)
  return payload
}

function errorOf(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined
  return typeof payload.error === 'string' && payload.error !== '' ? payload.error : undefined
}

function readJob(value: unknown): JobMeta {
  if (!isRecord(value)) throw new Error('后端返回格式不正确')
  const {
    jobId,
    prompt,
    model,
    ratio,
    size,
    refs,
    seq,
    phase,
    phaseLabel,
    tone,
    terminal,
    files,
    confirmCount,
    createdAt,
    settledAt,
    error,
  } = value
  if (
    typeof jobId !== 'string' ||
    typeof prompt !== 'string' ||
    typeof model !== 'string' ||
    typeof ratio !== 'string' ||
    typeof size !== 'string' ||
    typeof seq !== 'number' ||
    typeof phase !== 'string' ||
    typeof phaseLabel !== 'string' ||
    !isPhaseTone(tone) ||
    typeof terminal !== 'boolean' ||
    !Array.isArray(files) ||
    typeof confirmCount !== 'number' ||
    typeof createdAt !== 'number'
  ) {
    throw new Error('后端返回格式不正确')
  }
  return {
    jobId,
    prompt,
    seq,
    phase,
    phaseLabel,
    tone,
    terminal,
    model,
    ratio,
    size,
    refs: Array.isArray(refs)
      ? refs.filter((item): item is string => typeof item === 'string')
      : [],
    files: files.filter((file): file is string => typeof file === 'string'),
    confirmCount,
    createdAt,
    settledAt: typeof settledAt === 'number' ? settledAt : undefined,
    error: typeof error === 'string' ? error : undefined,
  }
}

function readOptions(value: unknown): Options {
  if (!isRecord(value)) throw new Error('后端返回格式不正确')
  const { models, ratios, sizes, defaults, maxCount, maxRefs } = value
  if (
    !Array.isArray(models) ||
    !Array.isArray(ratios) ||
    !Array.isArray(sizes) ||
    !isRecord(defaults) ||
    typeof defaults.model !== 'string' ||
    typeof defaults.ratio !== 'string' ||
    typeof defaults.size !== 'string' ||
    typeof maxCount !== 'number' ||
    typeof maxRefs !== 'number'
  ) {
    throw new Error('后端返回格式不正确')
  }
  return {
    models: models.map((item) => {
      if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string') {
        throw new Error('后端返回格式不正确')
      }
      return { id: item.id, name: item.name }
    }),
    ratios: ratios.filter((item): item is string => typeof item === 'string'),
    sizes: sizes.filter((item): item is string => typeof item === 'string'),
    defaults: { model: defaults.model, ratio: defaults.ratio, size: defaults.size },
    maxCount,
    maxRefs,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** 读接口的会话参数；只此一处拼，避免有的地方手写 `?sessionId=` 忘了编码。 */
function queryOf(sessionId: string): string {
  return new URLSearchParams({ sessionId }).toString()
}

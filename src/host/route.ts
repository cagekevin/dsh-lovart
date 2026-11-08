/**
 * /lovart/api 七条路由（规范 §6 C5）。
 *
 * 注册只发生在 `resolveWebServer(ctx)` 非空之后。本文件同时是**唯一**能触发上游
 * `chat/confirm` 的路径：agent 工具没有确认能力，这条闸门只能由人从侧栏打开。
 *
 * 纯逻辑拆在 `handleRequest`：只收 `{method, path, query, body}`、只回 `{status, body}`，
 * 所以状态码、错误体、排序、确认校验都能在没有真 webServer 时测。
 * 错误一律 `{error}` + 非 2xx，未知异常归一为「内部错误」，不返回堆栈。
 */

import { LovartError, respond } from './errors.ts'
import { findOwnedJob, removeJob } from './job/board.ts'
import { isTerminal, PHASE_TABLE, type PhaseTone } from './job/phase.ts'
import type { LovartMeta } from './job/run.ts'
import type { Store } from './job/store.ts'
import {
  DEFAULT_MODEL_ID,
  DEFAULT_RATIO,
  DEFAULT_SIZE,
  MODEL_TABLE,
  modelOptions,
  RATIO_OPTIONS,
  SIZE_OPTIONS,
} from './lovart/models.ts'
import { parseRefUpload, type RefUpload } from './lovart/refs.ts'
import {
  MAX_COUNT,
  MAX_REFS,
  parseGenerateArgs,
  type GenerateArgs,
} from './lovart/types.ts'

const PREFIX = '/lovart/api'
const COLLECTION = `${PREFIX}/jobs`
const REFS = `${PREFIX}/refs`
const OPTIONS = `${PREFIX}/options`
const CREDENTIALS = `${PREFIX}/credentials`
const ITEM = /^\/lovart\/api\/jobs\/([^/]+)$/
const CONFIRM = /^\/lovart\/api\/jobs\/([^/]+)\/confirm$/
const CANCEL = /^\/lovart\/api\/jobs\/([^/]+)\/cancel$/

/** 请求面：node IncomingMessage 的结构子集（只读 URL / method / 异步体）。 */
export interface WebServerRequest {
  url?: string
  method?: string
  [Symbol.asyncIterator](): AsyncIterator<string | Uint8Array>
}

/** 响应面：node ServerResponse 的结构子集（只写状态、头、字符串体）。 */
export interface WebServerResponse {
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string): void
}

/** 一条注册路由；kind 与 DSH webServer 保持一致。 */
export interface WebServerRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: WebServerRequest, res: WebServerResponse) => void | Promise<void>
}

/** Cordis 服务表是动态的；这是唯一把 webServer 收成端口类型的桥接点。 */
export interface WebServerPort {
  register(route: WebServerRoute): () => void
}

/** 唯一可选服务解析入口；缺 webServer 时返回 undefined，调用方不得继续注册。 */
export function resolveWebServer(ctx: { get(name: string): unknown }): WebServerPort | undefined {
  const server = ctx.get('webServer')
  return server === undefined ? undefined : (server as WebServerPort)
}

/** 路由装配依赖；提交与确认都由 index.ts 注入，路由不自己拿 api / jobs。 */
export interface RouteDeps {
  readonly store: Store<LovartMeta>
  /** 与工具共用 startLovartJobs，不另开一条提交路径。 */
  readonly startJobs: (args: GenerateArgs, sessionId: string) => string[]
  /** 只有 confirm 路由会调到；工具侧没有这个依赖。 */
  readonly confirm: (meta: LovartMeta) => Promise<void>
  /** 取消 = 放弃这个任务（图不要了）；只有侧栏与工具能触发，没有自动路径。 */
  readonly cancelJob: (meta: LovartMeta) => 'requested' | 'already-finished'
  /** 垫图上传：交给 api.uploadFile，路由不接触凭据与上游地址。 */
  readonly uploadRef: (file: RefUpload) => Promise<string>
  /** 删任务时连磁盘文件一起删；路径只来自 meta.files，不在这里拼。 */
  readonly removeFiles: (paths: readonly string[]) => Promise<void>
  readonly credentialsConfigured: () => Promise<boolean>
  /** 当前凭据源能不能被 set 写入；决定侧栏是否显示输入框。 */
  readonly credentialsWritable: () => Promise<boolean>
  /** 唯一写凭据入口：只调 ctx.credentials.set，插件不落盘。 */
  readonly saveCredentials: (accessKey: string, secretKey: string) => Promise<void>
  readonly version: string
}

/** 已解析请求；body 由适配层解 JSON，纯逻辑层不碰流。 */
export interface RouteRequest {
  readonly method: string
  /** 只含 pathname，查询串在 {@link RouteRequest.query}。 */
  readonly path: string
  readonly query: URLSearchParams
  readonly body: unknown
}

/** 纯逻辑层唯一返回形状；适配层照抄成 HTTP。 */
export interface RouteResponse {
  readonly status: number
  readonly body: unknown
}

/** 唯一路由注册入口；参数非可空，拿不到 server 就调不到这里。 */
export function registerRoutes(server: WebServerPort, deps: RouteDeps): () => void {
  return server.register({
    kind: 'prefix',
    path: PREFIX,
    handler: (req, res) => serve(deps, req, res),
  })
}

/** 纯逻辑入口：任意异常都走 respond()，测试直接拿状态码与错误体。 */
export async function handleRequest(
  deps: RouteDeps,
  request: RouteRequest,
): Promise<RouteResponse> {
  try {
    return { status: 200, body: await route(deps, request) }
  } catch (error) {
    const { status, body } = respond(error)
    return { status, body }
  }
}

/**
 * 唯一人工确认入口（规范 §5.3）。
 *
 * 先校验、再**同步**把 confirmCount 置 1、最后才发请求：双击或并发只会有一次 POST，
 * 不会重复扣积分。失败不回滚、不唤醒 —— 规范要求「确认失败不重试、不唤醒 run()」，
 * 任务会停在 confirming，用户可自行 kill。
 */
export async function confirmJob(
  meta: LovartMeta,
  confirm: (threadId: string) => Promise<void>,
): Promise<void> {
  if (meta.phase !== 'confirming') {
    throw LovartError.conflict(`任务不在待确认状态（当前 ${meta.phase}）`)
  }
  if (meta.confirmCount !== 0) {
    throw LovartError.conflict('该任务已确认过，不能重复确认')
  }
  if (meta.threadId === undefined) {
    throw LovartError.internal('任务缺少 threadId，无法确认')
  }
  meta.confirmCount = 1
  await confirm(meta.threadId)
  meta.unblockConfirm?.()
}

async function route(deps: RouteDeps, request: RouteRequest): Promise<unknown> {
  const { method, path } = request

  if (path === `${PREFIX}/health`) {
    requireMethod(method, 'GET')
    return {
      credentials: await deps.credentialsConfigured(),
      // 只读事实：凭据源是否可写；不可写时侧栏不显示输入框，避免填了必然失败。
      credentialsWritable: await deps.credentialsWritable(),
      modelCount: MODEL_TABLE.length,
      version: deps.version,
      // 路由只在 webServer 存在时注册，能走到这里就说明它可用。
      webServer: true,
    }
  }

  if (path === CREDENTIALS) {
    requireMethod(method, 'POST')
    const pair = readCredentialPair(request.body)
    await deps.saveCredentials(pair.accessKey, pair.secretKey)
    return { configured: true }
  }

  if (path === OPTIONS) {
    requireMethod(method, 'GET')
    return {
      models: modelOptions(),
      ratios: [...RATIO_OPTIONS],
      sizes: [...SIZE_OPTIONS],
      defaults: { model: DEFAULT_MODEL_ID, ratio: DEFAULT_RATIO, size: DEFAULT_SIZE },
      maxCount: MAX_COUNT,
      maxRefs: MAX_REFS,
    }
  }

  if (path === REFS) {
    requireMethod(method, 'POST')
    const file = parseRefUpload(request.body)
    return { url: await deps.uploadRef(file) }
  }

  if (path === COLLECTION) {
    if (method === 'GET') return listJobs(deps, requireSessionId(request.query.get('sessionId')))
    if (method === 'POST') return createJobs(deps, request)
    throw LovartError.invalidInput('该接口只支持 GET / POST')
  }

  const confirmMatch = CONFIRM.exec(path)
  if (confirmMatch !== null) {
    requireMethod(method, 'POST')
    return confirmRoute(deps, confirmMatch[1] ?? '', requireSessionId(sessionIdOf(request.body)))
  }

  const cancelMatch = CANCEL.exec(path)
  if (cancelMatch !== null) {
    requireMethod(method, 'POST')
    return cancelRoute(deps, cancelMatch[1] ?? '', requireSessionId(sessionIdOf(request.body)))
  }

  const itemMatch = ITEM.exec(path)
  if (itemMatch !== null) {
    const id = itemMatch[1] ?? ''
    const sessionId = requireSessionId(request.query.get('sessionId'))
    if (method === 'GET') return toView(findOwnedJob(deps.store, id, sessionId))
    if (method === 'DELETE') return deleteJob(deps, id, sessionId)
    throw LovartError.invalidInput('该接口只支持 GET / DELETE')
  }

  throw LovartError.notFound('未知接口')
}

/** 侧栏图墙读列表；只读本会话的 LovartMeta，不混 ctx.jobs（规范 §5.5）。 */
function listJobs(deps: RouteDeps, sessionId: string): JobView[] {
  return [...deps.store.values()]
    .filter((meta) => meta.sessionId === sessionId)
    .map(toView)
    .sort(compareTimeline)
}

/**
 * 图墙只有一种排序：待确认置顶，其余按创建时间倒序。
 * 新任务自然压在上面，完成后留在原位、随新任务下沉；前端不再排第二次。
 */
function compareTimeline(left: JobView, right: JobView): number {
  const leftTop = left.phase === 'confirming' ? 0 : 1
  const rightTop = right.phase === 'confirming' ? 0 : 1
  if (leftTop !== rightTop) return leftTop - rightTop
  return right.createdAt - left.createdAt
}

/**
 * 对外任务视图：元数据 + 三个派生字段（徽章文案 / 终态 / 外观档位）。
 * 三者都从 `PHASE_TABLE` 派生一次，前端不再自己按 phase 判断（ADR-0005）。
 */
interface JobView extends LovartMeta {
  readonly phaseLabel: string
  readonly terminal: boolean
  readonly tone: PhaseTone
}

function toView(meta: LovartMeta): JobView {
  const row = PHASE_TABLE[meta.phase]
  return {
    ...meta,
    phaseLabel: row.label,
    terminal: isTerminal(meta.phase),
    tone: row.tone,
  }
}

/**
 * 侧栏提交。`sessionId` 只从 body 读：同一个请求的参数不分两处，避免以后一半在 body、
 * 一半在 query；也避免会话 id 落进 URL 与访问日志。
 */
async function createJobs(
  deps: RouteDeps,
  request: RouteRequest,
): Promise<{ jobs: LovartMeta[] }> {
  const sessionId = sessionIdOf(request.body)
  if (sessionId === undefined) {
    throw LovartError.invalidInput(
      '缺少 sessionId：POST /lovart/api/jobs 的 body 必须带非空 sessionId',
    )
  }
  const args = parseGenerateArgs(request.body)
  const ids = deps.startJobs(args, sessionId)
  return {
    jobs: ids.map((id) => {
      const meta = deps.store.get(id)
      if (meta === undefined) throw LovartError.internal(`任务元数据缺失：${id}`)
      return toView(meta)
    }),
  }
}

/** body 里的 sessionId 只认非空字符串；数字、空串、缺字段都算没带。 */
function sessionIdOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const value = (body as { sessionId?: unknown }).sessionId
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * 缺 sessionId 直接 400，**不回落成「全部会话」**：回落等于隔离形同虚设，
 * 而且调用方看不出自己漏传了参数。
 */
function requireSessionId(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') {
    throw LovartError.invalidInput('缺少 sessionId：请求必须带非空 sessionId')
  }
  return value
}

/**
 * 两个 key 必须成对写入：只写一半等于没配，还会让 `resolve` 报「未配置」时看不出缺哪半。
 * 所以缺任一就整单拒绝，不做部分写入。
 */
function readCredentialPair(body: unknown): { accessKey: string; secretKey: string } {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  const accessKey = nonEmpty(record.accessKey)
  const secretKey = nonEmpty(record.secretKey)
  if (accessKey === undefined || secretKey === undefined) {
    throw LovartError.invalidInput(
      '缺少凭据：POST /lovart/api/credentials 的 body 必须带非空 accessKey 与 secretKey',
    )
  }
  return { accessKey, secretKey }
}

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** 删任务：规则与工具侧共用 `removeJob`，路由只做参数搬运。 */
async function deleteJob(
  deps: RouteDeps,
  id: string,
  sessionId: string,
): Promise<{ deleted: true }> {
  await removeJob({
    store: deps.store,
    sessionId,
    jobId: id,
    removeFiles: deps.removeFiles,
    cancelJob: deps.cancelJob,
  })
  return { deleted: true }
}

async function confirmRoute(deps: RouteDeps, id: string, sessionId: string): Promise<JobView> {
  const meta = findOwnedJob(deps.store, id, sessionId)
  await deps.confirm(meta)
  return toView(meta)
}

/**
 * 取消 = 放弃这个任务，图也不要了。
 *
 * 只对非终态开放；终态再取消是调用方的错，直接 409 说清楚。
 * 返回的视图还是取消前的 phase —— run() 异步结算，侧栏下一轮轮询就变 `已取消`。
 */
function cancelRoute(deps: RouteDeps, id: string, sessionId: string): JobView {
  const meta = findOwnedJob(deps.store, id, sessionId)
  if (isTerminal(meta.phase)) {
    throw LovartError.conflict('任务已经结束，不能取消')
  }
  deps.cancelJob(meta)
  return toView(meta)
}

function requireMethod(actual: string, expected: string): void {
  if (actual !== expected) throw LovartError.invalidInput(`该接口只支持 ${expected}`)
}

/** 适配层：解析 URL 与 JSON 体，交给 handleRequest，再把结果写回响应。 */
async function serve(
  deps: RouteDeps,
  req: WebServerRequest,
  res: WebServerResponse,
): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const method = (req.method ?? 'GET').toUpperCase()
    const body = method === 'POST' ? await readJsonBody(req) : undefined
    sendJson(res, await handleRequest(deps, { method, path: url.pathname, query: url.searchParams, body }))
  } catch (error) {
    sendJson(res, respond(error))
  }
}

function sendJson(res: WebServerResponse, response: RouteResponse): void {
  const payload = JSON.stringify(response.body)
  res.writeHead(response.status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(Buffer.byteLength(payload)),
  })
  res.end(payload)
}

/** 只接受 JSON 或空体；中文可能跨 chunk，必须用流式解码器。 */
async function readJsonBody(req: WebServerRequest): Promise<unknown> {
  const decoder = new TextDecoder()
  let text = ''
  for await (const chunk of req) {
    text += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
  }
  text += decoder.decode()
  if (text.trim() === '') return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw LovartError.invalidInput('请求体不是合法 JSON')
  }
}

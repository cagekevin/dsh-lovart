/**
 * DSH 平台端口（ADR-0009 第二级范本）。
 *
 * 平台包不在本仓依赖里，这里只描述 `ctx` 上真实存在的四个必需服务与两个可选服务。
 * 所有 unknown → 端口的转换只在 `servicesOf` / `optionalService` 发生，
 * 业务代码不再碰 `ctx as ...`，也不再出现第二套接口声明。
 */

import type { Context } from '@deepseek-ai/cordis'

/** 会话 id；与 DSH 的 SessionId 同形（字符串）。 */
export type SessionId = string

/** 工具执行时能拿到的 agent，只用到它的会话 id。 */
export interface AgentHandle {
  readonly id: SessionId
}

/** 凭据引用是品牌化字符串；运行时就是变量名本身。 */
export type CredentialRef = string & { readonly __credentialRef: unique symbol }

/** 把变量名变成凭据引用；只有 apply 装配时会调用。 */
export function credentialRef(name: string): CredentialRef {
  return name as CredentialRef
}

export interface ResolvedCredential {
  readonly value: string
  readonly source: string
}

/** 配置界面的读面：只说有没有、能不能写，不带值。 */
export interface CredentialInfoPort {
  readonly configured: boolean
  readonly source?: string
  readonly writable: boolean
}

/**
 * 凭据服务（`dsh-credentials` 的 CredentialProvider）。
 *
 * 值归 DSH 存；本插件只 resolve（每次请求前）与 set（侧栏填一次）。
 * 没有第三件事：不缓存、不落自己的文件。
 */
export interface CredentialsService {
  resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined>
  describe(ref: CredentialRef): Promise<CredentialInfoPort>
  set(ref: CredentialRef, value: string): Promise<void>
}

export interface SessionHandle {
  readonly header: { readonly cwd?: string }
}

export interface SessionsService {
  get(id: SessionId): SessionHandle | undefined
}

export interface WorkingDirectoryService {
  ensure(agent: AgentHandle, signal?: AbortSignal): Promise<string>
}

/** job 句柄里本插件真正用到的部分；生命周期结算仍归 ctx.jobs。 */
export interface JobHandle {
  readonly id: string
  updateProgress(line: string): void
}

export type JobStatus = 'completed' | 'failed' | 'killed'

export interface JobOutcome {
  readonly status: JobStatus
  readonly result?: string
  readonly detail?: string
}

export interface JobHooks {
  cancel(reason?: string): void
  readonly done: Promise<JobOutcome>
}

export interface JobSpec {
  readonly kind: 'lovart'
  readonly label: string
  readonly owner?: SessionId
  run(job: JobHandle): JobHooks
}

export interface JobsService {
  start(spec: JobSpec): string
  /**
   * 放弃一个任务（DSH 的 `job_kill`）。
   *
   * 语义是「不要这个结果了」，不是「让上游停下来」——C1 没有中止端点，
   * 上游该跑完还是跑完，我们只是不再等、不再下载、并清掉已落盘的部分。
   */
  kill(id: string, caller?: SessionId, reason?: string): 'requested' | 'already-finished'
}

export interface ContentBlock {
  readonly type: 'text'
  readonly text: string
}

export interface ToolRunContext {
  readonly agent?: AgentHandle
  readonly signal: AbortSignal
}

export interface ToolOutputPort {
  readonly schema: Record<string, unknown>
  render(args: unknown, value: unknown): ContentBlock[]
}

export interface ToolDefinitionPort {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly output: ToolOutputPort
  execute(args: unknown, context: ToolRunContext): Promise<unknown>
  isConcurrencySafe?(args: unknown): boolean
}

export interface ToolsService {
  register(definition: ToolDefinitionPort): () => void
}

/** 一条随插件注册的 skill；`source` 用 runtime，正文随代码走、不落文件。 */
export interface SkillRegistrationPort {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly source: string
  readonly content: string
}

export interface SkillsService {
  register(skill: SkillRegistrationPort): () => void
}

/** 五个必需服务；`inject` 保证 apply 执行时它们已存在。 */
export interface HostServices {
  readonly tools: ToolsService
  readonly credentials: CredentialsService
  readonly jobs: JobsService
  readonly sessions: SessionsService
  readonly skills: SkillsService
}

/** 唯一把 ctx 收窄成服务表的地方。 */
export function servicesOf(ctx: Context): HostServices {
  return ctx as unknown as HostServices
}

/** 可选服务探测；未提供时返回 undefined，不抛错、不落 process.cwd。 */
export function optionalService<T>(ctx: Context, name: string): T | undefined {
  const getter = (ctx as unknown as { get(name: string): unknown }).get
  const value = getter.call(ctx, name)
  return value === undefined ? undefined : (value as T)
}

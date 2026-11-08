/**
 * dsh-lovart host 半边唯一入口（规范 §6 C3）。
 *
 * 只做四件事：建 Map<JobId, LovartMeta>、注册 lovart_generate、有 webServer 才注册路由、不写 sweeper。
 * 本文件是唯一的装配点：baseUrl / 凭据解析 / 服务探测都只在这里接一次。
 */

import type { Context } from '@deepseek-ai/cordis'
import { version as VERSION } from '../../package.json'
import type { Config as ConfigShape } from './config.ts'
import { LovartError } from './errors.ts'
import { removeImages } from './job/download.ts'
import { createSlotQueue } from './job/queue.ts'
import { LOVART_SKILL } from './skill.ts'
import { DEFAULT_TIMINGS, startLovartJobs, type LovartMeta } from './job/run.ts'
import { createStore } from './job/store.ts'
import { createLovartApi } from './lovart/api.ts'
import { createLovartClient, type Credential } from './lovart/request.ts'
import type { GenerateArgs } from './lovart/types.ts'
import {
  credentialRef,
  optionalService,
  servicesOf,
  type AgentHandle,
  type CredentialsService,
  type WorkingDirectoryService,
} from './platform.ts'
import { confirmJob, registerRoutes, resolveWebServer } from './route.ts'
import { createBoardTool, createLovartTool } from './tools.ts'

/** Loader 读取的配置 schema；与 apply 的第二个参数是同一份定义。 */
export { Config } from './config.ts'

/** Cordis 插件名。 */
export const name = 'dsh-lovart'

/** 只声明必需服务；webServer / workingDirectory 走运行时探测（规范 §6 C3）。 */
export const inject = ['tools', 'credentials', 'jobs', 'sessions', 'skills']

const ACCESS = credentialRef('LOVART_ACCESS_KEY')
const SECRET = credentialRef('LOVART_SECRET_KEY')

/** 每次请求前解析，不缓存；缺任一项就报错，不静默降级。 */
async function resolveLovartCredential(credentials: CredentialsService): Promise<Credential> {
  const [access, secret] = await Promise.all([
    credentials.resolve(ACCESS),
    credentials.resolve(SECRET),
  ])
  if (access === undefined || secret === undefined) {
    throw LovartError.credentialsMissing(
      '未配置 Lovart 凭据（LOVART_ACCESS_KEY / LOVART_SECRET_KEY）',
    )
  }
  return { accessKey: access.value, secretKey: secret.value }
}

/** 插件装配入口；每件注册都套 ctx.effect。 */
export function apply(ctx: Context, config: ConfigShape): void {
  const services = servicesOf(ctx)
  const store = createStore<LovartMeta>()
  const client = createLovartClient({
    baseUrl: config.baseUrl,
    resolveCredential: () => resolveLovartCredential(services.credentials),
  })
  const api = createLovartApi(client)
  const workingDirectory = optionalService<WorkingDirectoryService>(ctx, 'workingDirectory')
  // 槽位是账号级的：全局一份，不按会话分。
  const queue = createSlotQueue(config.maxConcurrency)

  // 工具与侧栏共用这一份提交装配；两条入口，一个出口（规范 §5.1）。
  const startJobs = (
    args: GenerateArgs,
    sessionId: string,
    agent: AgentHandle | undefined,
  ): string[] =>
    startLovartJobs({
      jobs: services.jobs,
      store,
      api,
      client,
      sessions: services.sessions,
      workingDirectory,
      sessionId,
      agent,
      queue,
      timings: DEFAULT_TIMINGS,
      args,
    })

  /**
   * 取消 = 放弃。路由与工具共用这一份，不各写一个 `jobs.kill` 调用
   * （ADR-0005：同一能力只有一个装配点）。
   */
  const cancelJob = (meta: LovartMeta): 'requested' | 'already-finished' =>
    services.jobs.kill(meta.jobId, meta.sessionId, 'user-cancelled')

  // skill 常驻在技能目录里，模型在「还没决定调工具」时就能看到「怎么开工」。
  ctx.effect(() => services.skills.register(LOVART_SKILL))

  ctx.effect(() =>
    services.tools.register(
      createLovartTool({
        store,
        startJobs: (args, execution) => {
          const sessionId = execution.agent?.id
          if (sessionId === undefined) throw LovartError.invalidInput('无法确定当前会话')
          return startJobs(args, sessionId, execution.agent)
        },
      }),
    ),
  )

  // 台面工具：看 prompt / 参数 / 位次，删已结束的任务；不含提交。
  ctx.effect(() =>
    services.tools.register(
      createBoardTool({
        store,
        maxConcurrency: config.maxConcurrency,
        removeFiles: removeImages,
        cancelJob,
      }),
    ),
  )

  const webServer = resolveWebServer(ctx)
  if (webServer) {
    ctx.effect(() =>
      registerRoutes(webServer, {
        store,
        startJobs: (args, sessionId) => startJobs(args, sessionId, undefined),
        // 垫图只在这里转发：浏览器给 data URL，凭据与上游地址都留在 host。
        uploadRef: (file) => api.uploadFile(file),
        removeFiles: removeImages,
        // 确认只从这里进：agent 工具没有 confirm 能力（规范 §5.3）。
        confirm: (meta) => confirmJob(meta, (threadId) => api.confirm(threadId)),
        // 取消 = 放弃：kill 只让本地不再等，上游该跑完还是跑完。
        cancelJob,
        credentialsConfigured: async () => {
          try {
            await resolveLovartCredential(services.credentials)
            return true
          } catch {
            return false
          }
        },
        credentialsWritable: async () => (await services.credentials.describe(ACCESS)).writable,
        // 先写 secret 再写 access：中途失败只留下半套，resolve 仍报「未配置」，
        // 不会出现「有一半能用」的中间态。
        saveCredentials: async (accessKey, secretKey) => {
          await services.credentials.set(SECRET, secretKey)
          await services.credentials.set(ACCESS, accessKey)
        },
        version: VERSION,
      }),
    )
  }
}

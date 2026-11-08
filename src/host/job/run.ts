/**
 * 单个 job 的完整生命周期（规范 §5.1 / §5.2）。
 *
 * run() 必须同步返回 JobHooks，异步工作放进立即执行的 async IIFE，promise 塞进 done；
 * 终态靠 done 结算 ctx.jobs，不写 sweeper。confirming 不占并发，且只等 resolver。
 */

import { LovartError } from '../errors.ts'
import { buildPrompt } from '../lovart/prompt.ts'
import { resolveModel, toolConfigFor } from '../lovart/models.ts'
import type { LovartApi } from '../lovart/api.ts'
import type { LovartClient } from '../lovart/request.ts'
import type { GenerateArgs, Priority, Size } from '../lovart/types.ts'
import type {
  AgentHandle,
  JobHandle,
  JobOutcome,
  JobsService,
  SessionId,
  SessionsService,
  WorkingDirectoryService,
} from '../platform.ts'
import { isTerminal, PHASE_TABLE, phaseFor, type Phase } from './phase.ts'
import type { SlotQueue, SlotTicket } from './queue.ts'
import { formatOutcome, type SubmittedBy } from './result.ts'
import { removeImages, saveImages } from './download.ts'
import type { Store } from './store.ts'

/** 轮询节奏；唯一真源。测试注入毫秒级的值，业务侧只用 DEFAULT_TIMINGS。 */
export interface PollTimings {
  /** 首轮间隔，之后翻倍。 */
  readonly initialMs: number
  /** 间隔上限。 */
  readonly maxMs: number
  /** done 后复核前的等待（防子任务未起跑误判）。 */
  readonly recheckMs: number
}

export const DEFAULT_TIMINGS: PollTimings = { initialMs: 10_000, maxMs: 60_000, recheckMs: 5_000 }

/** 本插件持有的任务元数据（规范 §4.1）；只在内存，重启即丢。 */
export interface LovartMeta {
  jobId: string
  /** 归属会话。一个会话 = 一个项目，侧栏与 agent 都只看本会话。 */
  readonly sessionId: string
  readonly prompt: string
  readonly model: string
  readonly ratio: string
  readonly size: Size
  /** 参考图 CDN 地址；重跑时原样复用，不再二次上传。 */
  readonly refs: readonly string[]
  /** 本地排队优先级；只影响「谁先占槽」，提交后就没有意义了。 */
  readonly priority: Priority
  /**
   * 会话内递增的展示编号（`#7`）。人和 AI 用它指认任务，
   * 与 `jobId`（机器句柄）分工：这个能说出口，那个不能。
   */
  readonly seq: number
  threadId?: string
  projectId?: string
  phase: Phase
  files: string[]
  urls: string[]
  error?: string
  readonly createdAt: number
  submittedAt?: number
  settledAt?: number
  confirmCount: number
  /** 唯一非数据字段：唤醒停在 confirming 的 await。 */
  unblockConfirm?: () => void
}

export interface StartJobsInput {
  readonly jobs: JobsService
  readonly store: Store<LovartMeta>
  readonly api: LovartApi
  readonly client: LovartClient
  readonly sessions: SessionsService
  readonly workingDirectory: WorkingDirectoryService | undefined
  readonly sessionId: SessionId
  readonly agent: AgentHandle | undefined
  /** 全局一份：槽位是账号级的，与会话无关。 */
  readonly queue: SlotQueue
  readonly timings: PollTimings
  readonly args: GenerateArgs
}

/** 退避：每次翻倍，封顶 maxMs（规范 §5.2）。 */
export function nextDelay(current: number, maxMs: number): number {
  return Math.min(current * 2, maxMs)
}

/** 提交 count 个任务，立即返回 job id 列表；不等图（规范 §9.1）。 */
export function startLovartJobs(context: StartJobsInput): string[] {
  const ids: string[] = []
  const base = nextSeq(context.store, context.sessionId)
  for (let index = 0; index < context.args.count; index += 1) {
    ids.push(startOne(context, base + index))
  }
  return ids
}

/** 会话内递增编号。删掉最大的几个后可能被复用，作为展示名够用。 */
function nextSeq(store: Store<LovartMeta>, sessionId: string): number {
  let max = 0
  for (const meta of store.values()) {
    if (meta.sessionId === sessionId && meta.seq > max) max = meta.seq
  }
  return max + 1
}

function startOne(context: StartJobsInput, seq: number): string {
  const model = resolveModel(context.args.model)
  const meta: LovartMeta = {
    jobId: '',
    sessionId: context.sessionId,
    prompt: context.args.prompt,
    model: model.id,
    ratio: context.args.ratio,
    size: context.args.size,
    refs: [...context.args.refs],
    priority: context.args.priority,
    seq,
    phase: 'waiting',
    files: [],
    urls: [],
    confirmCount: 0,
    createdAt: Date.now(),
  }
  // 侧栏提交时没有 agent；结果文本据此告诉模型「什么都不用做」。
  const submittedBy: SubmittedBy = context.agent === undefined ? 'user' : 'agent'

  return context.jobs.start({
    kind: 'lovart',
    owner: context.sessionId,
    label: `lovart · ${model.readableName}`,
    run(job: JobHandle) {
      meta.jobId = job.id
      context.store.set(job.id, meta)

      let cancelled = false
      let wake: (() => void) | undefined

      // 当前这张槽位票；取消排队或还槽后置空，finally 只还「当前这张」。
      let ticket: SlotTicket | undefined

      /** 拿槽；返回 false = 排队期间被取消（此时还没碰上游，等于没提交）。 */
      const acquire = async (): Promise<boolean> => {
        const next = context.queue.take(context.args.priority)
        ticket = next
        if (!(await next.granted)) return false
        if (cancelled) {
          next.release()
          ticket = undefined
          return false
        }
        return true
      }

      const release = (): void => {
        ticket?.release()
        ticket = undefined
      }

      const wait = (ms: number): Promise<void> =>
        new Promise((resolve) => {
          // 取消可能发生在上一轮 await 期间，且当时还没有 wake 可调。
          if (cancelled) {
            resolve()
            return
          }
          const timer = setTimeout(() => {
            wake = undefined
            resolve()
          }, ms)
          timer.unref()
          wake = () => {
            clearTimeout(timer)
            wake = undefined
            resolve()
          }
        })

      const work = (async (): Promise<JobOutcome> => {
        // 初始就是 waiting：先排队，拿到槽位前不碰上游。
        job.updateProgress(PHASE_TABLE.waiting.progress)
        if (!(await acquire())) return finishCancelled(job, meta, submittedBy)
        setPhase(job, meta, 'submitting')
        try {
          const promptText = buildPrompt({
            prompt: meta.prompt,
            model,
            ratio: meta.ratio,
            size: meta.size,
            hasRefs: meta.refs.length > 0,
          })

          // unlimited 是账号级持久设置，随时会被别处改回 fast，所以每次提交前重设。
          await context.api.setUnlimited(true)
          const projectId = await context.api.createProject()
          meta.projectId = projectId
          const threadId = await context.api.sendChat({
            prompt: promptText,
            projectId,
            toolConfig: toolConfigFor(model),
            attachments: meta.refs,
          })
          meta.threadId = threadId
          meta.submittedAt = Date.now()
          setPhase(job, meta, 'queued')
          if (cancelled) return finishCancelled(job, meta, submittedBy)

          let delay = context.timings.initialMs
          while (!cancelled) {
            const status = await context.api.getStatus(threadId)
            if (cancelled) return finishCancelled(job, meta, submittedBy)
            if (status.kind === 'failed') throw LovartError.upstream('上游中止了任务')

            if (status.kind === 'done') {
              // 先等 recheckMs 再复核一次，防子任务未起跑误判（规范 §5.2）。
              await wait(context.timings.recheckMs)
              if (cancelled) return finishCancelled(job, meta, submittedBy)
              const recheck = await context.api.getStatus(threadId)
              if (recheck.kind === 'failed') throw LovartError.upstream('上游中止了任务')
              if (recheck.kind !== 'done') {
                setPhase(job, meta, phaseFor(recheck))
                delay = context.timings.initialMs
                await wait(delay)
                delay = nextDelay(delay, context.timings.maxMs)
                continue
              }

              const result = await context.api.getResult(threadId)
              if (cancelled) return finishCancelled(job, meta, submittedBy)
              if (result.pendingConfirmation) {
                // 等人期间不占槽：先还，确认后再排一次。
                release()
                await waitForConfirmation(job, meta)
                if (cancelled) return finishCancelled(job, meta, submittedBy)
                if (!(await acquire())) return finishCancelled(job, meta, submittedBy)
                setPhase(job, meta, 'queued')
                continue
              }
              if (result.urls.length === 0) {
                throw LovartError.upstream('任务完成但没有产出图片')
              }

              meta.urls = result.urls
              setPhase(job, meta, 'downloading')
              const cwd = await resolveCwd(context)
              if (cancelled) return finishCancelled(job, meta, submittedBy)
              meta.files = await saveImages({
                client: context.client,
                urls: result.urls,
                cwd,
                prompt: meta.prompt,
                now: new Date(),
                isCancelled: () => cancelled,
              })
              // 下载期间用户可能已点停止；已写下的文件保留，但任务按取消结算。
              if (cancelled) return finishCancelled(job, meta, submittedBy)
              meta.settledAt = Date.now()
              setPhase(job, meta, 'done')
              return {
                status: 'completed',
                detail: `${meta.files.length} 张`,
                result: formatOutcome(
                  {
                    kind: 'done',
                    files: meta.files,
                    elapsedMs: meta.settledAt - meta.createdAt,
                  },
                  submittedBy,
                ),
              }
            }

            if (status.kind === 'confirming') {
              // 等人期间不占槽：先还，确认后再排一次。
              release()
              await waitForConfirmation(job, meta)
              if (cancelled) return finishCancelled(job, meta, submittedBy)
              if (!(await acquire())) return finishCancelled(job, meta, submittedBy)
              setPhase(job, meta, 'queued')
              continue
            }

            setPhase(job, meta, phaseFor(status))
            await wait(delay)
            delay = nextDelay(delay, context.timings.maxMs)
          }
          return finishCancelled(job, meta, submittedBy)
        } catch (error) {
          if (cancelled) return finishCancelled(job, meta, submittedBy)
          const message = error instanceof LovartError ? error.message : '内部错误'
          meta.error = message
          meta.settledAt = Date.now()
          setPhase(job, meta, 'failed')
          return {
            status: 'failed',
            detail: message,
            result: formatOutcome({ kind: 'failed', message }, submittedBy),
          }
        } finally {
          // 成功 / 失败 / 取消都从这里还槽；只还当前这张，重复调用是空操作。
          release()
        }
      })()

      return {
        cancel() {
          cancelled = true
          // 排队中的票要摘掉；确认中的 resolver 要唤醒；等待中的定时器要提前结束。
          ticket?.cancel()
          meta.unblockConfirm?.()
          wake?.()
        },
        done: work,
      }
    },
  })
}

/** phase 推进与 updateProgress 必须同批发生；同阶段不重复刷行，终态之后不再改。 */
function setPhase(job: JobHandle, meta: LovartMeta, phase: Phase): void {
  if (isTerminal(meta.phase) || meta.phase === phase) return
  meta.phase = phase
  const progress = PHASE_TABLE[phase].progress
  if (progress.length > 0) job.updateProgress(progress)
}

/** confirming 只等 resolver，不占并发；cancel 会唤醒它。还槽与重新排队由调用方做。 */
async function waitForConfirmation(job: JobHandle, meta: LovartMeta): Promise<void> {
  setPhase(job, meta, 'confirming')
  await new Promise<void>((resolve) => {
    meta.unblockConfirm = resolve
  })
  meta.unblockConfirm = undefined
}

/**
 * 取消 = 放弃这个任务，图也不要了。
 *
 * 已落盘的部分要删掉，否则「取消了」却在 `lovart/` 留半套图。删除失败不改变
 * 「已取消」这个事实 —— 任务已经放弃了，不能因为文件删不掉就变成失败。
 */
async function finishCancelled(
  job: JobHandle,
  meta: LovartMeta,
  submittedBy: SubmittedBy,
): Promise<JobOutcome> {
  meta.settledAt = Date.now()
  setPhase(job, meta, 'cancelled')
  if (meta.files.length > 0) {
    const files = meta.files
    // 先清空再删：删失败也不该让同一批路径被后续路径重复处理。
    meta.files = []
    try {
      await removeImages(files)
    } catch (cause) {
      // 不静默：文件没删掉要在卡片上看得见，否则用户以为已经清干净了。
      const reason = cause instanceof Error ? cause.message : '未知错误'
      meta.error = `已取消，但有 ${files.length} 张图没能删除：${reason}`
    }
  }
  return {
    status: 'killed',
    detail: '已取消',
    result: formatOutcome({ kind: 'cancelled' }, submittedBy),
  }
}

/** cwd 顺序固定：workingDirectory.ensure → sessions.header.cwd → 报错（规范 §3 P5）。 */
async function resolveCwd(context: StartJobsInput): Promise<string> {
  if (context.workingDirectory !== undefined && context.agent !== undefined) {
    try {
      // 不传工具调用的 signal：任务已在后台跑，调用方的取消不该中途掐断取目录。
      return await context.workingDirectory.ensure(context.agent)
    } catch {
      // 服务存在但拿不到目录时，回落到 session header，不落 process.cwd。
    }
  }
  const cwd = context.sessions.get(context.sessionId)?.header.cwd
  if (cwd === undefined || cwd.length === 0) {
    throw LovartError.cwdUnknown('无法确定会话工作目录')
  }
  return cwd
}

/**
 * 台面快照与删除（§6 C4 的 `lovart_board` 与 §6 C5 的 `DELETE` 共用）。
 *
 * 「一个会话能看见什么、能删什么」只有这一份实现：路由与工具都调它，
 * 不各写一遍过滤规则与 404 语义（ADR-0005）。
 */

import { LovartError } from '../errors.ts'
import type { Priority } from '../lovart/types.ts'
import { isTerminal, PHASE_TABLE, type Phase } from './phase.ts'
import type { LovartMeta } from './run.ts'
import type { Store } from './store.ts'

/** 快照里每条任务共有的字段；不重复写三遍。 */
interface EntryBase {
  /** 机器句柄。 */
  readonly jobId: string
  /** 人和 AI 共用的展示编号（`#7`）；位次会变，编号不会。 */
  readonly seq: number
  readonly prompt: string
  readonly model: string
  readonly ratio: string
  readonly size: string
  readonly refs: readonly string[]
  /** 本地排队优先级；`high` 会排在 normal 前面。 */
  readonly priority: Priority
}

export type WaitingEntry = EntryBase

export interface ActiveEntry extends EntryBase {
  readonly phase: Phase
  readonly elapsedMs: number
}

export interface FinishedEntry {
  readonly jobId: string
  readonly seq: number
  readonly prompt: string
  readonly phase: Phase
  readonly files: readonly string[]
  readonly error?: string
}

/** 一次拿到整张台面；`finished` 受 `limit` 限制，默认只给最近的。 */
export interface BoardSnapshot {
  readonly slots: {
    /** 正在占槽的任务数（`PHASE_TABLE.holdsSlot`）。 */
    readonly running: number
    readonly max: number
    readonly waiting: number
  }
  readonly waiting: readonly WaitingEntry[]
  readonly active: readonly ActiveEntry[]
  readonly finished: readonly FinishedEntry[]
}

export interface SnapshotInput {
  readonly store: Store<LovartMeta>
  readonly sessionId: string
  /** 同时提交给上游的上限，来自 config。 */
  readonly max: number
  readonly limit: number
  /** 便于测试注入固定时钟。 */
  readonly now?: number
}

/**
 * 派发顺序：`high` 先，同优先级按提交时间。
 *
 * 只用于把 `waiting` 列表按「谁先上」排好，**不对外暴露位次**：
 * 位次会随轮询变化，不能当身份用（编号 `seq` 才是身份）。
 */
function compareDispatch(left: LovartMeta, right: LovartMeta): number {
  const leftRank = left.priority === 'high' ? 0 : 1
  const rightRank = right.priority === 'high' ? 0 : 1
  return leftRank !== rightRank ? leftRank - rightRank : left.createdAt - right.createdAt
}

function baseOf(meta: LovartMeta): EntryBase {
  return {
    jobId: meta.jobId,
    seq: meta.seq,
    prompt: meta.prompt,
    model: meta.model,
    ratio: meta.ratio,
    size: meta.size,
    refs: [...meta.refs],
    priority: meta.priority,
  }
}

/** 只读：不发请求、不改状态。 */
export function buildSnapshot(input: SnapshotInput): BoardSnapshot {
  const now = input.now ?? Date.now()
  const mine = [...input.store.values()].filter((meta) => meta.sessionId === input.sessionId)
  const byCreated = [...mine].sort((left, right) => left.createdAt - right.createdAt)
  const waiting = byCreated
    .filter((meta) => meta.phase === 'waiting')
    .sort(compareDispatch)
  const active = byCreated.filter((meta) => meta.phase !== 'waiting' && !isTerminal(meta.phase))
  const finished = mine
    .filter((meta) => isTerminal(meta.phase))
    .sort(
      (left, right) =>
        (right.settledAt ?? right.createdAt) - (left.settledAt ?? left.createdAt),
    )
    .slice(0, input.limit)

  return {
    slots: {
      running: mine.filter((meta) => PHASE_TABLE[meta.phase].holdsSlot).length,
      max: input.max,
      waiting: waiting.length,
    },
    waiting: waiting.map(baseOf),
    active: active.map((meta) => ({
      ...baseOf(meta),
      phase: meta.phase,
      elapsedMs: Math.max(0, now - meta.createdAt),
    })),
    finished: finished.map((meta) => ({
      jobId: meta.jobId,
      seq: meta.seq,
      prompt: meta.prompt,
      phase: meta.phase,
      files: [...meta.files],
      ...(meta.error === undefined ? {} : { error: meta.error }),
    })),
  }
}

/**
 * 取本会话的任务。**跨会话与不存在返回同一个 404**：
 * 报「不是你的任务」等于告诉对方这个 id 存在。
 */
export function findOwnedJob(
  store: Store<LovartMeta>,
  jobId: string,
  sessionId: string,
): LovartMeta {
  const meta = store.get(jobId)
  if (meta === undefined || meta.sessionId !== sessionId) {
    throw LovartError.notFound('任务不存在')
  }
  return meta
}

export interface RemoveJobInput {
  readonly store: Store<LovartMeta>
  readonly sessionId: string
  readonly jobId: string
  readonly removeFiles: (paths: readonly string[]) => Promise<void>
  /**
   * 删 `waiting` 的任务要先把它从队列里摘掉：否则 run() 醒来还会去提交一份
   * 已经不在 store 里的 meta。
   *
   * **必填**：做成可选的话，将来某个调用方漏传就变成静默错误。
   */
  readonly cancelJob: (meta: LovartMeta) => void
}

/**
 * 删任务：终态直接删；`waiting` 也允许（它从没碰过上游，删掉等于没提过），
 * 但必须先取消。跑着的任务拒绝 —— 删了会留下一个还在写这份 meta 的 run()。
 *
 * 删的时候连磁盘文件一起删：侧栏删了但 `lovart/` 里还留着，会变成看不见的残留。
 */
export async function removeJob(input: RemoveJobInput): Promise<void> {
  const meta = findOwnedJob(input.store, input.jobId, input.sessionId)
  if (meta.phase === 'waiting') {
    input.cancelJob(meta)
  } else if (!isTerminal(meta.phase)) {
    throw LovartError.conflict(`任务还没结束（当前 ${meta.phase}），先取消再删除`)
  }
  await input.removeFiles(meta.files)
  input.store.delete(input.jobId)
}

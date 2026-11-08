/**
 * Phase 表（规范 §4.2）。唯一真源：加阶段必须加一行，否则编译不过。
 *
 * holdsSlot 决定并发闸；terminal 决定终态后不再改状态；progress 是会话头
 * 唯一能看到的业务文本，phase 推进时必须同时 updateProgress；label 只给侧栏徽章。
 */

import { assertNever } from '../errors.ts'
import type { UpstreamStatus } from '../lovart/types.ts'

/** 侧栏徽章外观；前端只读这个字段，不再自己按 phase 判断（ADR-0005）。 */
export type PhaseTone = 'active' | 'waiting' | 'done' | 'idle'

export const PHASE_TABLE = {
  waiting: { holdsSlot: false, terminal: false, progress: '等待空位', label: '等待中', tone: 'idle' },
  submitting: { holdsSlot: true, terminal: false, progress: '提交中', label: '提交中', tone: 'active' },
  queued: { holdsSlot: true, terminal: false, progress: '排队中', label: '排队中', tone: 'active' },
  generating: { holdsSlot: true, terminal: false, progress: '生成中', label: '生成中', tone: 'active' },
  confirming: { holdsSlot: false, terminal: false, progress: '等你确认（会扣积分）', label: '待确认', tone: 'waiting' },
  // 上游此时已 done，槽位是上游的；本地下载不该继续挡队列（02 §4.1）。
  downloading: { holdsSlot: false, terminal: false, progress: '下载中', label: '下载中', tone: 'active' },
  done: { holdsSlot: false, terminal: true, progress: '', label: '已完成', tone: 'done' },
  failed: { holdsSlot: false, terminal: true, progress: '', label: '已失败', tone: 'done' },
  cancelled: { holdsSlot: false, terminal: true, progress: '', label: '已取消', tone: 'done' },
} as const satisfies Record<
  string,
  {
    readonly holdsSlot: boolean
    readonly terminal: boolean
    readonly progress: string
    readonly label: string
    readonly tone: PhaseTone
  }
>

export type Phase = keyof typeof PHASE_TABLE

/** 终态之后不允许再改 phase、再回调、再发请求。 */
export function isTerminal(phase: Phase): boolean {
  return PHASE_TABLE[phase].terminal
}

/** 上游状态 → phase；`done` 的下载细分由 run() 处理，这里给 downloading。 */
export function phaseFor(status: UpstreamStatus): Phase {
  switch (status.kind) {
    case 'queued':
      return 'queued'
    case 'generating':
      return 'generating'
    case 'confirming':
      return 'confirming'
    case 'done':
      return 'downloading'
    case 'failed':
      return 'failed'
    default:
      return assertNever(status)
  }
}

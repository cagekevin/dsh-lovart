/**
 * 终态结果文本（ADR-0009 第一级：写不出来）。
 * formatOutcome 只接受终态判别联合；调用方写不出「临时拼一句」的中间态。
 * job_output 与 detail 都调这一个函数。
 *
 * submittedBy 只区分一件事：侧栏任务是用户自己点的，agent 收到通知后不该做任何事。
 * 这句话必须由结果文本带出去 —— 模型只看得到这段文本，看不到调用栈。
 */

import { assertNever } from '../errors.ts'

/** 只有三种终态；没有 running / confirming 之类的半成品。 */
export type TerminalOutcome =
  | { kind: 'done'; files: readonly string[]; elapsedMs: number }
  | { kind: 'failed'; message: string }
  | { kind: 'cancelled' }

/** 谁提交的：`user` = 用户在侧栏点的，agent 收到通知后什么都不用做。 */
export type SubmittedBy = 'agent' | 'user'

const USER_SUBMITTED = '这是用户在侧栏自己提交的任务，你不需要做任何事。'

/** 唯一结果文本；换行符固定，测试按整串断言。 */
export function formatOutcome(outcome: TerminalOutcome, submittedBy: SubmittedBy): string {
  const text = bodyOf(outcome)
  return submittedBy === 'user' ? `${text}\n${USER_SUBMITTED}` : text
}

function bodyOf(outcome: TerminalOutcome): string {
  switch (outcome.kind) {
    case 'done': {
      const seconds = Math.round(outcome.elapsedMs / 1000)
      return `已生成 ${outcome.files.length} 张图（耗时 ${seconds}s）\n${outcome.files.join('\n')}`
    }
    case 'failed':
      return `生成失败：${outcome.message}`
    case 'cancelled':
      return '已取消'
    default:
      return assertNever(outcome)
  }
}

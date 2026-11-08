/**
 * 本地槽位队列（02 §4.2）。
 *
 * 只回答一个问题：**现在能不能拿到槽位**。它不对外报「当前占用几个」——
 * 那个数由 `PHASE_TABLE.holdsSlot` 派生，另立计数器会与真相漂移。
 *
 * 一次 apply 一份，实例由 `index.ts` 持有，不落模块级变量（ADR-0009 第一级）。
 */

/** 一张号票；拿不到就是排队，取消后永远不会被放行。 */
export interface SlotTicket {
  /** true = 拿到槽位；false = 等待期间被取消。只会 settle 一次。 */
  readonly granted: Promise<boolean>
  /** 取消排队：还在队列里就摘掉并 resolve(false)；已拿到则无效。 */
  cancel(): void
  /** 还槽并唤醒下一个；拿到过才需要调用，重复调用无效。 */
  release(): void
}

export interface SlotQueue {
  /**
   * 领号：有空位立即拿到，否则排队。
   *
   * `high` 会插到所有 `normal` 前面（同优先级内部仍先来后到）；
   * 这是本地插队，只影响「什么时候提交给上游」，不影响上游自己的排队。
   */
  take(priority?: Priority): SlotTicket
}

type State = 'waiting' | 'granted' | 'cancelled' | 'released'

/** 排队优先级；`high` 只对**还没提交**的任务有意义（已提交给上游就改不了了）。 */
import type { Priority } from '../lovart/types.ts'

interface Waiter {
  /** 放行；已被取消时返回 false。 */
  grant(): boolean
  /** 摘号；已放行时返回 false。 */
  drop(): boolean
}

interface Entry {
  readonly waiter: Waiter
  readonly priority: Priority
}

/**
 * 唯一创建入口。`max` 是同时提交给上游的任务数，不是「最多能提几个」。
 */
export function createSlotQueue(max: number): SlotQueue {
  let active = 0
  const pending: Entry[] = []

  /** 取队首：先看有没有 high，没有才轮到 normal；同优先级内部先来后到。 */
  const takeNext = (): Entry | undefined => {
    const highIndex = pending.findIndex((entry) => entry.priority === 'high')
    if (highIndex >= 0) return pending.splice(highIndex, 1)[0]
    return pending.shift()
  }

  /** 有空位就依次放行；被取消的号直接跳过。 */
  const pump = (): void => {
    while (active < max && pending.length > 0) {
      const next = takeNext()
      if (next === undefined) return
      if (!next.waiter.grant()) continue
      active += 1
    }
  }

  return {
    take(priority: Priority = 'normal'): SlotTicket {
      let settle: (value: boolean) => void = () => {}
      const granted = new Promise<boolean>((resolve) => {
        settle = resolve
      })
      let state: State = 'waiting'

      const waiter: Waiter = {
        grant(): boolean {
          if (state !== 'waiting') return false
          state = 'granted'
          settle(true)
          return true
        },
        drop(): boolean {
          if (state !== 'waiting') return false
          state = 'cancelled'
          settle(false)
          return true
        },
      }

      if (active < max) {
        waiter.grant()
        active += 1
      } else {
        pending.push({ waiter, priority })
      }

      return {
        granted,
        cancel(): void {
          if (!waiter.drop()) return
          const index = pending.findIndex((entry) => entry.waiter === waiter)
          if (index >= 0) pending.splice(index, 1)
        },
        release(): void {
          // 只认「拿到过且还没还」：重复 release、取消后 release 都是空操作。
          if (state !== 'granted') return
          state = 'released'
          active -= 1
          pump()
        },
      }
    },
  }
}

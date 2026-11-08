/**
 * 内存任务表（ADR-0009 第一级：写不出来）。
 * 只导出工厂，不导出实例或模块级容器：两个 apply 实例、两个测试用例天然隔离。
 * 需要 LovartMeta 时写 createStore<LovartMeta>()，不另造全局单例。
 */

/** 任务表的最小接口；Map 细节不外泄。 */
export interface Store<T> {
  get(id: string): T | undefined
  set(id: string, value: T): void
  delete(id: string): boolean
  values(): IterableIterator<T>
}

/** 唯一创建入口；每次调用得到一个独立实例。 */
export function createStore<T>(): Store<T> {
  const items = new Map<string, T>()
  return {
    get: (id) => items.get(id),
    set: (id, value) => {
      items.set(id, value)
    },
    delete: (id) => items.delete(id),
    values: () => items.values(),
  }
}

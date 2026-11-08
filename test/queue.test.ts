import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSlotQueue } from '../src/host/job/queue.ts'

/** 把「是否已放行」读出来；promise 只 settle 一次，用这个标记判断先后。 */
function watch(ticket: ReturnType<ReturnType<typeof createSlotQueue>['take']>) {
  const state = { settled: false, value: undefined as boolean | undefined }
  void ticket.granted.then((value) => {
    state.settled = true
    state.value = value
  })
  return state
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

test('取号：有空位立即放行，超出上限的排队', async () => {
  const queue = createSlotQueue(2)
  const first = queue.take()
  const second = queue.take()
  const third = queue.take()

  assert.equal(await first.granted, true)
  assert.equal(await second.granted, true)

  const state = watch(third)
  await tick()
  assert.equal(state.settled, false, '第三个不该在满员时拿到槽')

  first.release()
  assert.equal(await third.granted, true)
  assert.equal(state.value, true)
})

test('还槽按先来后到：释放一个只放行队首', async () => {
  const queue = createSlotQueue(1)
  const first = queue.take()
  const second = queue.take()
  const third = queue.take()
  assert.equal(await first.granted, true)

  first.release()
  assert.equal(await second.granted, true)

  const state = watch(third)
  await tick()
  assert.equal(state.settled, false)
})

test('取消排队：promise 变 false，且不再被后续还槽放行', async () => {
  const queue = createSlotQueue(1)
  const first = queue.take()
  const second = queue.take()
  assert.equal(await first.granted, true)

  second.cancel()
  assert.equal(await second.granted, false)

  first.release()
  await tick()
  // 取消过的号不会因为这次还槽被放行（release 只放行队首，而队列已空）。
  assert.equal(await second.granted, false)
})

test('取消已拿到的票无效：槽位仍要由 release 归还', async () => {
  const queue = createSlotQueue(1)
  const first = queue.take()
  assert.equal(await first.granted, true)

  first.cancel()
  assert.equal(await first.granted, true, '已放行的票 cancel 不改变结果')

  const second = queue.take()
  const state = watch(second)
  await tick()
  assert.equal(state.settled, false, '没 release 之前第二个拿不到')

  first.release()
  assert.equal(await second.granted, true)
})

test('重复 release 是空操作：不会凭空多出槽位', async () => {
  const queue = createSlotQueue(1)
  const first = queue.take()
  assert.equal(await first.granted, true)

  first.release()
  first.release()

  const second = queue.take()
  assert.equal(await second.granted, true)

  const third = queue.take()
  const state = watch(third)
  await tick()
  assert.equal(state.settled, false, '只有 1 个槽，第三个必须等')
})

test('优先级：high 插到所有 normal 前面，同优先级仍先来后到', async () => {
  const queue = createSlotQueue(1)
  const running = queue.take()
  assert.equal(await running.granted, true)

  const normalFirst = queue.take('normal')
  const normalSecond = queue.take()
  const highFirst = queue.take('high')
  const highSecond = queue.take('high')

  running.release()
  assert.equal(await highFirst.granted, true, '第一个 high 先上')

  highFirst.release()
  assert.equal(await highSecond.granted, true, '同优先级先来后到')

  highSecond.release()
  assert.equal(await normalFirst.granted, true, 'high 用完才轮到 normal')

  normalFirst.release()
  assert.equal(await normalSecond.granted, true)
})

test('取消排队中的票不会影响它后面的人', async () => {
  const queue = createSlotQueue(1)
  const first = queue.take()
  const second = queue.take()
  const third = queue.take()
  assert.equal(await first.granted, true)

  second.cancel()
  first.release()

  assert.equal(await third.granted, true, '队首被摘掉后，后面的人顶上')
})

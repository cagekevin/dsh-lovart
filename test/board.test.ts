import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LovartError } from '../src/host/errors.ts'
import { buildSnapshot, findOwnedJob, removeJob } from '../src/host/job/board.ts'
import type { LovartMeta } from '../src/host/job/run.ts'
import { createStore, type Store } from '../src/host/job/store.ts'

function makeMeta(jobId: string, overrides: Partial<LovartMeta> = {}): LovartMeta {
  return {
    jobId,
    sessionId: 's-1',
    prompt: `画 ${jobId}`,
    model: 'nano-bn-2',
    ratio: '3:4',
    size: '2K',
    priority: 'normal',
    seq: 1,
    refs: [],
    phase: 'generating',
    files: [],
    urls: [],
    confirmCount: 0,
    createdAt: 1,
    ...overrides,
  }
}

function storeWith(...metas: LovartMeta[]): Store<LovartMeta> {
  const store = createStore<LovartMeta>()
  for (const meta of metas) store.set(meta.jobId, meta)
  return store
}

test('buildSnapshot：只返回本会话，且按 waiting / active / finished 分三组', () => {
  const store = storeWith(
    makeMeta('w-1', { phase: 'waiting', createdAt: 10, seq: 1 }),
    makeMeta('w-2', { phase: 'waiting', createdAt: 20, seq: 2 }),
    makeMeta('a-1', { phase: 'generating', createdAt: 30 }),
    makeMeta('c-1', { phase: 'confirming', createdAt: 40 }),
    makeMeta('f-1', { phase: 'done', createdAt: 5, settledAt: 50, files: ['/a.png'] }),
    makeMeta('x-1', { sessionId: 's-2', phase: 'generating', createdAt: 1 }),
  )

  const snapshot = buildSnapshot({ store, sessionId: 's-1', max: 4, limit: 10, now: 100 })

  assert.deepEqual(
    snapshot.waiting.map((entry) => entry.jobId),
    ['w-1', 'w-2'],
    'waiting 按派发顺序排',
  )
  assert.deepEqual(
    snapshot.waiting.map((entry) => entry.seq),
    [1, 2],
    '编号是稳定身份，不随位次变',
  )
  assert.deepEqual(
    snapshot.active.map((entry) => entry.jobId),
    ['a-1', 'c-1'],
    'confirming 也算在跑（在等人），但它不占槽',
  )
  assert.deepEqual(
    snapshot.finished.map((entry) => entry.jobId),
    ['f-1'],
  )
  assert.equal(snapshot.slots.running, 1, '只有 generating 占槽')
  assert.equal(snapshot.slots.waiting, 2)
  assert.equal(snapshot.slots.max, 4)
})

test('buildSnapshot：waiting 的位次按派发顺序 —— high 先，同优先级按提交时间', () => {
  const store = storeWith(
    makeMeta('normal-early', { phase: 'waiting', createdAt: 10 }),
    makeMeta('high-late', { phase: 'waiting', priority: 'high', createdAt: 20 }),
    makeMeta('normal-late', { phase: 'waiting', createdAt: 30 }),
  )

  const snapshot = buildSnapshot({ store, sessionId: 's-1', max: 4, limit: 10, now: 100 })

  assert.deepEqual(
    snapshot.waiting.map((entry) => entry.jobId),
    ['high-late', 'normal-early', 'normal-late'],
    'high 先，同优先级按提交时间',
  )
})

test('buildSnapshot：finished 按结束时间倒序，并受 limit 限制', () => {
  const store = storeWith(
    makeMeta('old', { phase: 'done', createdAt: 1, settledAt: 10 }),
    makeMeta('new', { phase: 'done', createdAt: 2, settledAt: 30 }),
    makeMeta('mid', { phase: 'failed', createdAt: 3, settledAt: 20, error: '上游 402' }),
  )

  const snapshot = buildSnapshot({ store, sessionId: 's-1', max: 4, limit: 2, now: 100 })

  assert.deepEqual(
    snapshot.finished.map((entry) => entry.jobId),
    ['new', 'mid'],
  )
  assert.equal(snapshot.finished[1]?.error, '上游 402')
})

test('buildSnapshot：active 带已跑时长，waiting 不带', () => {
  const store = storeWith(makeMeta('a-1', { phase: 'generating', createdAt: 40 }))
  const snapshot = buildSnapshot({ store, sessionId: 's-1', max: 4, limit: 10, now: 100 })

  assert.equal(snapshot.active[0]?.elapsedMs, 60)
  assert.equal('elapsedMs' in (snapshot.waiting[0] ?? {}), false)
})

test('findOwnedJob：跨会话与不存在都是同一个 404', () => {
  const store = storeWith(makeMeta('lovart-1', { sessionId: 's-2' }))

  for (const id of ['lovart-1', 'lovart-404']) {
    assert.throws(
      () => findOwnedJob(store, id, 's-1'),
      (error: unknown) => error instanceof LovartError && error.code === 'NOT_FOUND',
    )
  }
})

test('removeJob：终态删文件并移出 store', async () => {
  const store = storeWith(makeMeta('lovart-1', { phase: 'done', files: ['/a.png', '/b.png'] }))
  const removed: string[][] = []

  await removeJob({
    store,
    sessionId: 's-1',
    jobId: 'lovart-1',
    cancelJob: () => {},
    removeFiles: async (paths) => {
      removed.push([...paths])
    },
  })

  assert.deepEqual(removed, [['/a.png', '/b.png']])
  assert.equal(store.get('lovart-1'), undefined)
})

test('removeJob：waiting 可以删，但先取消，避免 run() 继续跑一份不在 store 里的 meta', async () => {
  const store = storeWith(makeMeta('lovart-1', { phase: 'waiting' }))
  const cancelled: string[] = []

  await removeJob({
    store,
    sessionId: 's-1',
    jobId: 'lovart-1',
    removeFiles: async () => {},
    cancelJob: (meta) => {
      cancelled.push(meta.jobId)
      return 'requested'
    },
  })

  assert.deepEqual(cancelled, ['lovart-1'])
  assert.equal(store.get('lovart-1'), undefined)
})

test('removeJob：跑着的任务 409，且不动文件、不删记录', async () => {
  const store = storeWith(makeMeta('lovart-1', { phase: 'generating', files: ['/a.png'] }))
  let called = 0

  await assert.rejects(
    removeJob({
      store,
      sessionId: 's-1',
      jobId: 'lovart-1',
      cancelJob: () => {},
      removeFiles: async () => {
        called += 1
      },
    }),
    (error: unknown) => error instanceof LovartError && error.code === 'CONFLICT',
  )

  assert.equal(called, 0)
  assert.ok(store.get('lovart-1') !== undefined)
})

test('removeJob：跨会话 404，不删别人的任务', async () => {
  const store = storeWith(makeMeta('lovart-1', { sessionId: 's-2', phase: 'done' }))

  await assert.rejects(
    removeJob({
      store,
      sessionId: 's-1',
      jobId: 'lovart-1',
      removeFiles: async () => {},
      cancelJob: () => {},
    }),
    (error: unknown) => error instanceof LovartError && error.code === 'NOT_FOUND',
  )
  assert.ok(store.get('lovart-1') !== undefined)
})

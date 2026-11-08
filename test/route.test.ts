/**
 * /lovart/api 的纯逻辑测试：状态码、错误体、排序、确认闸门。
 * 传输层（URL/JSON 解析、writeHead/end）不在这里验，必须有真 webServer。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createStore, type Store } from '../src/host/job/store.ts'
import type { LovartMeta } from '../src/host/job/run.ts'
import { MODEL_TABLE } from '../src/host/lovart/models.ts'
import type { RefUpload } from '../src/host/lovart/refs.ts'
import {
  confirmJob,
  handleRequest,
  type RouteDeps,
  type RouteRequest,
} from '../src/host/route.ts'

function makeMeta(jobId: string, overrides: Partial<LovartMeta> = {}): LovartMeta {
  return {
    jobId,
    sessionId: 's-1',
    prompt: '一只戴帽子的猫',
    model: 'nano-bn-2',
    ratio: '3:4',
    size: '2K',
    priority: 'normal',
    seq: 1,
    refs: [],
    phase: 'queued',
    files: [],
    urls: [],
    createdAt: 1,
    confirmCount: 0,
    ...overrides,
  }
}

function makeDeps(overrides: Partial<RouteDeps> = {}): RouteDeps {
  return {
    store: createStore<LovartMeta>(),
    startJobs: () => [],
    uploadRef: async () => 'https://cdn.example.com/ref.png',
    removeFiles: async () => {},
    confirm: async () => {},
    cancelJob: () => 'requested',
    credentialsConfigured: async () => false,
    credentialsWritable: async () => true,
    saveCredentials: async () => {},
    version: '9.9.9',
    ...overrides,
  }
}

/** 读接口默认带本会话；要测「缺 sessionId」就显式传 `query: ''`。 */
function request(
  method: string,
  path: string,
  init: { query?: string; body?: unknown } = {},
): RouteRequest {
  return {
    method,
    path,
    query: new URLSearchParams(init.query ?? 'sessionId=s-1'),
    body: init.body,
  }
}

function storeWith(...metas: LovartMeta[]): Store<LovartMeta> {
  const store = createStore<LovartMeta>()
  for (const meta of metas) store.set(meta.jobId, meta)
  return store
}

test('GET /jobs 按 createdAt 倒序，并带上徽章文案与终态标记', async () => {
  const older = makeMeta('lovart-a', { createdAt: 10 })
  const newest = makeMeta('lovart-b', { createdAt: 30, phase: 'done' })
  const middle = makeMeta('lovart-c', { createdAt: 20 })
  const response = await handleRequest(
    makeDeps({ store: storeWith(older, newest, middle) }),
    request('GET', '/lovart/api/jobs'),
  )

  assert.equal(response.status, 200)
  const body = response.body as {
    jobId: string
    phaseLabel: string
    terminal: boolean
  }[]
  assert.deepEqual(
    body.map((job) => job.jobId),
    ['lovart-b', 'lovart-c', 'lovart-a'],
  )
  assert.equal(body[0]?.phaseLabel, '已完成')
  assert.equal(body[0]?.terminal, true)
  assert.equal(body[2]?.phaseLabel, '排队中')
  assert.equal(body[2]?.terminal, false)
})

test('GET /jobs 待确认置顶，其余仍按时间倒序', async () => {
  const newest = makeMeta('lovart-new', { createdAt: 30 })
  const waiting = makeMeta('lovart-wait', { createdAt: 10, phase: 'confirming' })
  const older = makeMeta('lovart-old', { createdAt: 5 })
  const response = await handleRequest(
    makeDeps({ store: storeWith(newest, waiting, older) }),
    request('GET', '/lovart/api/jobs'),
  )

  assert.equal(response.status, 200)
  assert.deepEqual(
    (response.body as { jobId: string }[]).map((job) => job.jobId),
    ['lovart-wait', 'lovart-new', 'lovart-old'],
  )
})

test('POST /jobs 缺 sessionId 直接 400，不启动任务', async () => {
  let started = 0
  const response = await handleRequest(
    makeDeps({ startJobs: () => (started++, []) }),
    request('POST', '/lovart/api/jobs', { body: { prompt: '猫' } }),
  )

  assert.equal(response.status, 400)
  assert.deepEqual(response.body, {
    error: '缺少 sessionId：POST /lovart/api/jobs 的 body 必须带非空 sessionId',
  })
  assert.equal(started, 0)
})

test('旧 query 写法不再生效：只认 body 里的 sessionId', async () => {
  let started = 0
  const response = await handleRequest(
    makeDeps({ startJobs: () => (started++, []) }),
    request('POST', '/lovart/api/jobs', { query: 'sessionId=s-1', body: { prompt: '猫' } }),
  )

  assert.equal(response.status, 400)
  assert.equal(started, 0)
})

test('POST /jobs 成功返回新建任务的元数据', async () => {
  const store = createStore<LovartMeta>()
  const response = await handleRequest(
    makeDeps({
      store,
      startJobs: (args, sessionId) => {
        assert.equal(sessionId, 's-1')
        assert.equal(args.prompt, '画一只猫')
        store.set('lovart-1', makeMeta('lovart-1'))
        return ['lovart-1']
      },
    }),
    request('POST', '/lovart/api/jobs', { body: { sessionId: 's-1', prompt: '画一只猫' } }),
  )

  assert.equal(response.status, 200)
  const body = response.body as { jobs: { jobId: string; phaseLabel: string }[] }
  assert.equal(body.jobs.length, 1)
  assert.equal(body.jobs[0]?.jobId, 'lovart-1')
  assert.equal(body.jobs[0]?.phaseLabel, '排队中')
})

test('POST /jobs 的 sessionId 与出图参数同在一处 body', async () => {
  const store = createStore<LovartMeta>()
  const response = await handleRequest(
    makeDeps({
      store,
      startJobs: (args, sessionId) => {
        assert.deepEqual(args, {
          prompt: '赛博猫',
          model: 'gpt-image-2-high',
          ratio: '16:9',
          size: '4K',
          count: 2,
          refs: [],
          priority: 'normal',
        })
        assert.equal(sessionId, 's-9')
        store.set('lovart-2', makeMeta('lovart-2'))
        return ['lovart-2']
      },
    }),
    request('POST', '/lovart/api/jobs', {
      body: {
        sessionId: 's-9',
        prompt: '赛博猫',
        model: 'gpt-image-2-high',
        ratio: '16:9',
        size: '4K',
        count: 2,
      },
    }),
  )

  assert.equal(response.status, 200)
  const body = response.body as { jobs: { jobId: string; phaseLabel: string }[] }
  assert.equal(body.jobs[0]?.jobId, 'lovart-2')
  assert.equal(body.jobs[0]?.phaseLabel, '排队中')
})

test('GET /jobs/:id 命中 200，未命中 404', async () => {
  const meta = makeMeta('lovart-1')
  const deps = makeDeps({ store: storeWith(meta) })

  const hit = await handleRequest(deps, request('GET', '/lovart/api/jobs/lovart-1'))
  assert.equal(hit.status, 200)
  const hitBody = hit.body as { jobId: string; phaseLabel: string }
  assert.equal(hitBody.jobId, 'lovart-1')
  assert.equal(hitBody.phaseLabel, '排队中')

  const miss = await handleRequest(deps, request('GET', '/lovart/api/jobs/lovart-404'))
  assert.equal(miss.status, 404)
  assert.deepEqual(miss.body, { error: '任务不存在' })
})

test('confirm 非 confirming 拒一次：409，不递增不唤醒', async () => {
  const meta = makeMeta('lovart-1', { phase: 'generating', threadId: 't-1' })
  let calls = 0
  const response = await handleRequest(
    makeDeps({ store: storeWith(meta), confirm: (m) => confirmJob(m, async () => (calls++, undefined)) }),
    request('POST', '/lovart/api/jobs/lovart-1/confirm', { body: { sessionId: 's-1' } }),
  )

  assert.equal(response.status, 409)
  assert.deepEqual(response.body, { error: '任务不在待确认状态（当前 generating）' })
  assert.equal(meta.confirmCount, 0)
  assert.equal(calls, 0)
})

test('confirm 成功只发一次、递增一次、唤醒一次；第二次拒绝', async () => {
  const meta = makeMeta('lovart-1', { phase: 'confirming', threadId: 't-1' })
  let calls = 0
  let woken = 0
  meta.unblockConfirm = () => {
    woken += 1
  }
  const deps = makeDeps({
    store: storeWith(meta),
    confirm: (m) => confirmJob(m, async () => (calls++, undefined)),
  })

  const first = await handleRequest(deps, request('POST', '/lovart/api/jobs/lovart-1/confirm', { body: { sessionId: 's-1' } }))
  assert.equal(first.status, 200)
  assert.equal(meta.confirmCount, 1)
  assert.equal(calls, 1)
  assert.equal(woken, 1)

  const second = await handleRequest(deps, request('POST', '/lovart/api/jobs/lovart-1/confirm', { body: { sessionId: 's-1' } }))
  assert.equal(second.status, 409)
  assert.deepEqual(second.body, { error: '该任务已确认过，不能重复确认' })
  assert.equal(calls, 1)
  assert.equal(woken, 1)
})

test('confirm 上游失败：500 内部错误，不重试不唤醒，任务留在 confirming', async () => {
  const meta = makeMeta('lovart-1', { phase: 'confirming', threadId: 't-1' })
  let woken = 0
  meta.unblockConfirm = () => {
    woken += 1
  }
  const deps = makeDeps({
    store: storeWith(meta),
    confirm: (m) =>
      confirmJob(m, async () => {
        throw new Error('上游 502')
      }),
  })

  const response = await handleRequest(deps, request('POST', '/lovart/api/jobs/lovart-1/confirm', { body: { sessionId: 's-1' } }))
  assert.equal(response.status, 500)
  assert.deepEqual(response.body, { error: '内部错误' })
  assert.equal(meta.confirmCount, 1)
  assert.equal(woken, 0)
  assert.equal(meta.phase, 'confirming')

  const retry = await handleRequest(deps, request('POST', '/lovart/api/jobs/lovart-1/confirm', { body: { sessionId: 's-1' } }))
  assert.equal(retry.status, 409)
})

test('DELETE /jobs/:id 终态可删：先删文件再移出 store', async () => {
  const meta = makeMeta('lovart-1', { phase: 'done', files: ['/tmp/a.png', '/tmp/b.png'] })
  const store = storeWith(meta)
  const removed: string[][] = []
  const deps = makeDeps({
    store,
    removeFiles: async (paths) => {
      removed.push([...paths])
    },
  })

  const response = await handleRequest(deps, request('DELETE', '/lovart/api/jobs/lovart-1'))
  assert.equal(response.status, 200)
  assert.deepEqual(response.body, { deleted: true })
  assert.deepEqual(removed, [['/tmp/a.png', '/tmp/b.png']])
  assert.equal(store.get('lovart-1'), undefined)
})

test('DELETE 跑着的任务：409，不删文件也不移出 store', async () => {
  const store = storeWith(makeMeta('lovart-1', { phase: 'generating' }))
  let calls = 0
  const deps = makeDeps({
    store,
    removeFiles: async () => {
      calls += 1
    },
  })

  const response = await handleRequest(deps, request('DELETE', '/lovart/api/jobs/lovart-1'))
  assert.equal(response.status, 409)
  assert.equal(calls, 0)
  assert.ok(store.get('lovart-1') !== undefined)
})

test('DELETE 未知 id：404', async () => {
  const response = await handleRequest(makeDeps(), request('DELETE', '/lovart/api/jobs/lovart-404'))
  assert.equal(response.status, 404)
  assert.deepEqual(response.body, { error: '任务不存在' })
})

test('POST /refs 解 data URL 后交给 uploadRef，只回 CDN URL', async () => {
  let received: RefUpload | undefined
  const response = await handleRequest(
    makeDeps({
      uploadRef: async (file) => {
        received = file
        return 'https://cdn.example.com/ref.png'
      },
    }),
    request('POST', '/lovart/api/refs', {
      body: { name: 'cat.png', dataUrl: 'data:image/png;base64,AAEC' },
    }),
  )

  assert.equal(response.status, 200)
  assert.deepEqual(response.body, { url: 'https://cdn.example.com/ref.png' })
  assert.equal(received?.contentType, 'image/png')
  assert.equal(received?.filename, 'cat.png')
  assert.deepEqual([...(received?.bytes ?? [])], [0, 1, 2])
})

test('POST /refs 坏 data URL：400，且不触达上游', async () => {
  let called = 0
  const response = await handleRequest(
    makeDeps({
      uploadRef: async () => {
        called += 1
        return 'https://cdn.example.com/ref.png'
      },
    }),
    request('POST', '/lovart/api/refs', { body: { name: 'cat.txt', dataUrl: 'data:text/plain;base64,AAEC' } }),
  )

  assert.equal(response.status, 400)
  assert.equal(called, 0)
  assert.ok(typeof (response.body as { error?: unknown }).error === 'string')
})

test('POST /jobs 把 refs 原样交给 startJobs', async () => {
  const store = createStore<LovartMeta>()
  const response = await handleRequest(
    makeDeps({
      store,
      startJobs: (args, sessionId) => {
        assert.deepEqual(args.refs, ['https://cdn.example.com/a.png'])
        assert.equal(sessionId, 's-1')
        store.set('lovart-1', makeMeta('lovart-1', { refs: args.refs }))
        return ['lovart-1']
      },
    }),
    request('POST', '/lovart/api/jobs', {
      body: { sessionId: 's-1', prompt: '猫', refs: ['https://cdn.example.com/a.png'] },
    }),
  )

  assert.equal(response.status, 200)
})

test('GET /options 全部从模型表派生', async () => {
  const response = await handleRequest(makeDeps(), request('GET', '/lovart/api/options'))

  assert.equal(response.status, 200)
  const body = response.body as {
    models: { id: string; name: string }[]
    ratios: string[]
    sizes: string[]
    defaults: { model: string; ratio: string; size: string }
    maxCount: number
    maxRefs: number
  }
  assert.equal(body.models.length, MODEL_TABLE.length)
  assert.deepEqual(body.models[0], {
    id: MODEL_TABLE[0]?.id,
    name: MODEL_TABLE[0]?.readableName,
  })
  assert.deepEqual(body.ratios, ['1:1', '3:4', '4:3', '16:9', '9:16'])
  assert.deepEqual(body.sizes, ['1K', '2K', '4K'])
  assert.deepEqual(body.defaults, { model: 'nano-bn-2', ratio: '3:4', size: '2K' })
  assert.equal(body.maxCount, 4)
  assert.equal(body.maxRefs, 8)
})

test('GET /health 形状固定', async () => {
  const response = await handleRequest(
    makeDeps({ credentialsConfigured: async () => false }),
    request('GET', '/lovart/api/health'),
  )

  assert.equal(response.status, 200)
  assert.deepEqual(response.body, {
    credentials: false,
    credentialsWritable: true,
    modelCount: MODEL_TABLE.length,
    version: '9.9.9',
    webServer: true,
  })
})

test('POST /credentials 两个 key 一起写；缺一个或空白就 400 且不写', async () => {
  const writes: [string, string][] = []
  const deps = makeDeps({
    saveCredentials: async (accessKey, secretKey) => {
      writes.push([accessKey, secretKey])
    },
  })

  const ok = await handleRequest(
    deps,
    request('POST', '/lovart/api/credentials', { body: { accessKey: ' ak ', secretKey: 'sk' } }),
  )
  assert.equal(ok.status, 200)
  assert.deepEqual(ok.body, { configured: true })
  assert.deepEqual(writes, [['ak', 'sk']])

  const missing = await handleRequest(
    deps,
    request('POST', '/lovart/api/credentials', { body: { accessKey: 'ak' } }),
  )
  assert.equal(missing.status, 400)
  assert.equal(writes.length, 1)

  const blank = await handleRequest(
    deps,
    request('POST', '/lovart/api/credentials', { body: { accessKey: '   ', secretKey: 'sk' } }),
  )
  assert.equal(blank.status, 400)
  assert.equal(writes.length, 1)
})

test('GET /credentials 不存在：这条路由只收 POST', async () => {
  const response = await handleRequest(makeDeps(), request('GET', '/lovart/api/credentials'))
  assert.equal(response.status, 400)
  assert.deepEqual(response.body, { error: '该接口只支持 POST' })
})

test('GET /jobs 缺 sessionId：400，不回落成「全部会话」', async () => {
  const response = await handleRequest(
    makeDeps({ store: storeWith(makeMeta('lovart-1')) }),
    request('GET', '/lovart/api/jobs', { query: '' }),
  )
  assert.equal(response.status, 400)
  assert.deepEqual(response.body, { error: '缺少 sessionId：请求必须带非空 sessionId' })
})

test('GET /jobs 只返回本会话的任务', async () => {
  const mine = makeMeta('lovart-mine', { createdAt: 1 })
  const other = makeMeta('lovart-other', { sessionId: 's-2', createdAt: 2 })
  const response = await handleRequest(
    makeDeps({ store: storeWith(mine, other) }),
    request('GET', '/lovart/api/jobs'),
  )

  assert.equal(response.status, 200)
  assert.deepEqual(
    (response.body as { jobId: string }[]).map((job) => job.jobId),
    ['lovart-mine'],
  )
})

test('POST /jobs/:id/cancel 只对非终态开放；终态 409', async () => {
  const killed: string[] = []
  const deps = makeDeps({
    store: storeWith(makeMeta('lovart-1', { phase: 'generating' })),
    cancelJob: (meta) => {
      killed.push(meta.jobId)
      return 'requested'
    },
  })

  const ok = await handleRequest(
    deps,
    request('POST', '/lovart/api/jobs/lovart-1/cancel', { body: { sessionId: 's-1' } }),
  )
  assert.equal(ok.status, 200)
  assert.deepEqual(killed, ['lovart-1'])

  const doneDeps = makeDeps({
    store: storeWith(makeMeta('lovart-2', { phase: 'done' })),
    cancelJob: () => 'already-finished',
  })
  const refused = await handleRequest(
    doneDeps,
    request('POST', '/lovart/api/jobs/lovart-2/cancel', { body: { sessionId: 's-1' } }),
  )
  assert.equal(refused.status, 409)
  assert.deepEqual(refused.body, { error: '任务已经结束，不能取消' })
})

test('取消缺 sessionId：400，不触发 kill', async () => {
  let called = 0
  const deps = makeDeps({
    store: storeWith(makeMeta('lovart-1', { phase: 'generating' })),
    cancelJob: () => {
      called += 1
      return 'requested'
    },
  })

  const response = await handleRequest(
    deps,
    request('POST', '/lovart/api/jobs/lovart-1/cancel'),
  )
  assert.equal(response.status, 400)
  assert.equal(called, 0)
})

test('GET /jobs：按会话返回，带稳定编号 seq', async () => {
  const store = storeWith(
    makeMeta('a', { seq: 1, createdAt: 10 }),
    makeMeta('b', { seq: 2, createdAt: 20 }),
    makeMeta('c', { seq: 3, sessionId: 's-2', createdAt: 30 }),
  )
  const response = await handleRequest(makeDeps({ store }), request('GET', '/lovart/api/jobs'))

  assert.equal(response.status, 200)
  assert.deepEqual(
    (response.body as { jobId: string; seq: number }[]).map((job) => [job.jobId, job.seq]),
    [
      ['b', 2],
      ['a', 1],
    ],
    '按 createdAt 倒序；编号是稳定身份，不随顺序变',
  )
})

test('跨会话读 / 删 / 确认一律 404，且不动别人的任务', async () => {
  const other = makeMeta('lovart-other', { sessionId: 's-2', phase: 'done', files: ['/tmp/x.png'] })
  const store = storeWith(other)
  const deps = makeDeps({ store })

  const read = await handleRequest(deps, request('GET', '/lovart/api/jobs/lovart-other'))
  assert.equal(read.status, 404)

  const remove = await handleRequest(deps, request('DELETE', '/lovart/api/jobs/lovart-other'))
  assert.equal(remove.status, 404)
  assert.ok(store.get('lovart-other') !== undefined)

  const confirm = await handleRequest(
    deps,
    request('POST', '/lovart/api/jobs/lovart-other/confirm', { body: { sessionId: 's-1' } }),
  )
  assert.equal(confirm.status, 404)
})

test('未知路径 404，方法不对 400', async () => {
  const deps = makeDeps()

  const unknown = await handleRequest(deps, request('GET', '/lovart/api/nope'))
  assert.equal(unknown.status, 404)
  assert.deepEqual(unknown.body, { error: '未知接口' })

  const healthPost = await handleRequest(deps, request('POST', '/lovart/api/health'))
  assert.equal(healthPost.status, 400)
  assert.deepEqual(healthPost.body, { error: '该接口只支持 GET' })

  const confirmGet = await handleRequest(deps, request('GET', '/lovart/api/jobs/lovart-1/confirm'))
  assert.equal(confirmGet.status, 400)
  assert.deepEqual(confirmGet.body, { error: '该接口只支持 POST' })
})

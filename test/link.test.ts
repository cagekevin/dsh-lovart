/**
 * 链路验证：用本地假上游把真实客户端、真实 run()、真实落盘跑一遍。
 *
 * 这里的桩只存在于 test/，不接入 src；目的是让「签名 → 信封 → 轮询 → 确认 → 落盘」
 * 的每条边都有一次真实调用，而不是靠类型和单测推断。
 */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, type TestContext } from 'node:test'
import { LovartError } from '../src/host/errors.ts'
import { saveImages } from '../src/host/job/download.ts'
import { PHASE_TABLE } from '../src/host/job/phase.ts'
import { createSlotQueue } from '../src/host/job/queue.ts'
import { startLovartJobs, type LovartMeta, type PollTimings } from '../src/host/job/run.ts'
import { createStore, type Store } from '../src/host/job/store.ts'
import { createLovartApi, type LovartApi } from '../src/host/lovart/api.ts'
import { createLovartClient, type LovartClient } from '../src/host/lovart/request.ts'
import { signRequest } from '../src/host/lovart/sign.ts'
import { parseGenerateArgs, type GenerateArgs } from '../src/host/lovart/types.ts'
import type { JobHooks, JobsService } from '../src/host/platform.ts'
import {
  startFakeUpstream,
  type FakeReply,
  type FakeUpstream,
} from './fake-upstream.ts'

const ACCESS_KEY = 'test-access-key'
const SECRET_KEY = 'test-secret-key'
const SESSION_ID = 'session-link'
const STATUS_PATH = '/v1/openapi/chat/status'
const RESULT_PATH = '/v1/openapi/chat/result'

/** 链路测试不需要真等 10s/20s/5s；毫秒级节奏跑的是同一段代码。 */
const FAST_TIMINGS: PollTimings = { initialMs: 5, maxMs: 10, recheckMs: 5 }
/**
 * done 复核用例要停在「复核回来是 running」这一刻：下一轮间隔给足 3s，
 * 断言完立刻 cancel 唤醒，不真的等这 3s。
 */
const RECHECK_TIMINGS: PollTimings = { initialMs: 3_000, maxMs: 3_000, recheckMs: 20 }

function ok(data: unknown): FakeReply {
  return { json: { code: 0, data } }
}

/** 状态脚本：按调用次数依次返回，用完后一直重复最后一项。 */
function lifecycleUpstream(statuses: readonly string[]): Promise<FakeUpstream> {
  let index = 0
  let origin = ''
  return startFakeUpstream((request) => {
    switch (request.path) {
      case '/v1/openapi/mode/set':
        return ok({})
      case '/v1/openapi/project/save':
        return ok({ project_id: 'project-link' })
      case '/v1/openapi/chat':
        return ok({ thread_id: 'thread-link' })
      case STATUS_PATH: {
        const status = statuses[Math.min(index, statuses.length - 1)] ?? 'running'
        index += 1
        return ok({ status })
      }
      case RESULT_PATH:
        return ok({ items: [{ artifacts: [{ content: `${origin}/img/1` }] }] })
      case '/img/1':
        return { bytes: new Uint8Array([7, 7, 7]), contentType: 'image/png' }
      default:
        return { status: 404, json: { code: 404, error: `未配置的路径 ${request.path}` } }
    }
  }).then((upstream) => {
    origin = upstream.baseUrl
    return upstream
  })
}

interface FakeJob {
  readonly progress: string[]
  readonly hooks: JobHooks
}

/** 假 ctx.jobs：同步调用 spec.run()，把 hooks 留下来观察。 */
function createFakeJobs(): { service: JobsService; items: Map<string, FakeJob> } {
  const items = new Map<string, FakeJob>()
  let sequence = 0
  return {
    items,
    service: {
      start(spec) {
        const id = `lovart-fake-${++sequence}`
        const progress: string[] = []
        const hooks = spec.run({ id, updateProgress: (line) => progress.push(line) })
        items.set(id, { progress, hooks })
        return id
      },
      kill() {
        return 'already-finished' as const
      },
    },
  }
}

interface Harness {
  readonly api: LovartApi
  readonly client: LovartClient
  readonly store: Store<LovartMeta>
  readonly jobs: ReturnType<typeof createFakeJobs>
  start(
    prompt: string,
    overrides?: Partial<GenerateArgs>,
    maxConcurrency?: number,
  ): string[]
}

function createHarness(
  upstream: FakeUpstream,
  cwd: string,
  maxConcurrency = 4,
  timings: PollTimings = FAST_TIMINGS,
): Harness {
  const credential = { accessKey: ACCESS_KEY, secretKey: SECRET_KEY }
  const client = createLovartClient({
    baseUrl: upstream.baseUrl,
    resolveCredential: async () => credential,
  })
  const api = createLovartApi(client)
  const store = createStore<LovartMeta>()
  const jobs = createFakeJobs()
  const queue = createSlotQueue(maxConcurrency)
  return {
    api,
    client,
    store,
    jobs,
    start(prompt, overrides = {}) {
      return startLovartJobs({
        jobs: jobs.service,
        store,
        api,
        client,
        sessions: { get: () => ({ header: { cwd } }) },
        workingDirectory: undefined,
        sessionId: SESSION_ID,
        agent: undefined,
        queue,
        timings,
        args: parseGenerateArgs({ prompt, ...overrides }),
      })
    },
  }
}

async function makeCwd(t: TestContext): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-lovart-link-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  return cwd
}

/** 按墙钟轮询，而不是按圈数：定时器到点前 setImmediate 可以空转几千圈。 */
async function waitFor(check: () => boolean, label: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise<void>((resolve) => setTimeout(resolve, 2))
  }
  if (check()) return
  throw new Error(`等待超时：${label}`)
}

/** 真实计时器下等 done；给一个 120s 的护栏，避免测试静默挂死。 */
async function settle(done: Promise<unknown>): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('任务 120s 内没有结算')), 120_000)
    timer.unref()
  })
  try {
    return await Promise.race([done, guard])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function hookOf(harness: Harness, id: string): FakeJob {
  const job = harness.jobs.items.get(id)
  assert.ok(job !== undefined, `找不到任务 ${id}`)
  return job
}

function headerValue(value: string | string[] | undefined, name: string): string {
  if (typeof value === 'string') return value
  throw new Error(`缺少请求头 ${name}`)
}

test('签名头：五件齐全、可复算、时间戳每次不同', async (t) => {
  const upstream = await startFakeUpstream(() => ok({ status: 'running' }))
  t.after(() => upstream.close())
  const { api } = createHarness(upstream, tmpdir())

  await api.getStatus('thread-1')
  await new Promise<void>((resolve) => setTimeout(resolve, 1_100))
  await api.getStatus('thread-1')

  const statusRequests = upstream.requests.filter((request) => request.path === STATUS_PATH)
  assert.equal(statusRequests.length, 2)
  const [first, second] = statusRequests
  assert.ok(first !== undefined)
  assert.ok(second !== undefined)

  assert.equal(headerValue(first.headers['x-access-key'], 'x-access-key'), ACCESS_KEY)
  assert.equal(headerValue(first.headers['x-signed-method'], 'x-signed-method'), 'GET')
  assert.equal(headerValue(first.headers['x-signed-path'], 'x-signed-path'), STATUS_PATH)
  assert.equal(first.query.get('thread_id'), 'thread-1')

  const timestamp = headerValue(first.headers['x-timestamp'], 'x-timestamp')
  assert.match(timestamp, /^\d{10}$/)
  assert.equal(
    headerValue(first.headers['x-signature'], 'x-signature'),
    signRequest('GET', STATUS_PATH, timestamp, SECRET_KEY),
  )
  assert.notEqual(
    headerValue(first.headers['x-timestamp'], 'x-timestamp'),
    headerValue(second.headers['x-timestamp'], 'x-timestamp'),
  )
})

test('垫图：multipart 上传换 CDN URL，提交时进 attachments', async (t) => {
  const cwd = await makeCwd(t)
  let origin = ''
  const upstream = await startFakeUpstream((request) => {
    switch (request.path) {
      case '/v1/openapi/mode/set':
        return ok({})
      case '/v1/openapi/project/save':
        return ok({ project_id: 'project-link' })
      case '/v1/openapi/file/upload':
        return ok({ url: `${origin}/ref/1.png` })
      case '/v1/openapi/chat':
        return ok({ thread_id: 'thread-link' })
      case STATUS_PATH:
        return ok({ status: 'pending' })
      default:
        return { status: 404, json: { code: 404, error: '未配置' } }
    }
  })
  origin = upstream.baseUrl
  t.after(() => upstream.close())
  const harness = createHarness(upstream, cwd)

  const refUrl = await harness.api.uploadFile({
    filename: 'cat.png',
    contentType: 'image/png',
    bytes: new Uint8Array([1, 2, 3]),
  })
  assert.equal(refUrl, `${origin}/ref/1.png`)

  const upload = upstream.requests.find((item) => item.path === '/v1/openapi/file/upload')
  assert.ok(upload !== undefined)
  assert.equal(upload.method, 'POST')
  assert.ok(upload.text.includes('name="file"'), 'multipart 字段名必须是 file')
  assert.ok(upload.text.includes('filename="cat.png"'))
  assert.equal(
    headerValue(upload.headers['x-signed-path'], 'x-signed-path'),
    '/v1/openapi/file/upload',
  )

  const [id] = harness.start('猫', { refs: [refUrl] })
  assert.ok(id !== undefined)
  await waitFor(() => upstream.count('/v1/openapi/chat') >= 1, 'chat 已提交')
  const chat = upstream.requests.find((item) => item.path === '/v1/openapi/chat')
  assert.ok(chat !== undefined)
  const body = chat.body as Record<string, unknown>
  assert.deepEqual(body.attachments, [refUrl])
  assert.match(String(body.prompt), /^Reference image attached\./m)

  hookOf(harness, id).hooks.cancel()
  const outcome = await settle(hookOf(harness, id).hooks.done)
  assert.equal((outcome as { status?: string }).status, 'killed')
})

test('信封：code 0 放行、字符串 "0" 报错、非 2xx 先出业务码', async (t) => {
  const upstream = await startFakeUpstream((request) => {
    switch (request.path) {
      case '/v1/openapi/mode/query':
        return ok({ mode: 'unlimited' })
      case '/v1/openapi/chat/confirm':
        return { json: { code: '0', error: '字符串零' } }
      case '/v1/openapi/mode/set':
        return { status: 500, json: { code: 40001, error: '业务码优先' } }
      default:
        return { status: 404, json: { code: 404, error: '未配置' } }
    }
  })
  t.after(() => upstream.close())
  const { api } = createHarness(upstream, tmpdir())

  assert.deepEqual(await api.queryMode(), { mode: 'unlimited' })

  await assert.rejects(api.confirm('thread-1'), (error: unknown) => {
    return (
      error instanceof LovartError &&
      error.code === 'UPSTREAM' &&
      error.message.includes('字符串零')
    )
  })

  await assert.rejects(api.setUnlimited(true), (error: unknown) => {
    return (
      error instanceof LovartError &&
      error.code === 'UPSTREAM' &&
      error.upstreamCode === 40001 &&
      error.message === '业务码优先'
    )
  })
})

test('轮询：pending → running → done，progress 逐段推进并落盘', async (t) => {
  const cwd = await makeCwd(t)
  const upstream = await lifecycleUpstream(['pending', 'running', 'done', 'done'])
  t.after(() => upstream.close())
  const harness = createHarness(upstream, cwd)

  const [id] = harness.start('一只戴帽子的猫')
  assert.ok(id !== undefined)
  const job = hookOf(harness, id)
  const meta = harness.store.get(id)
  assert.ok(meta !== undefined)

  assert.deepEqual(job.progress, ['等待空位'])

  const outcome = await settle(job.hooks.done)
  assert.equal((outcome as { status?: string }).status, 'completed')
  assert.equal((outcome as { detail?: string }).detail, '1 张')
  assert.match((outcome as { result?: string }).result ?? '', /^已生成 1 张图/)
  assert.equal(meta.files.length, 1)
  assert.ok((outcome as { result?: string }).result?.includes(meta.files[0] ?? ''))
  assert.deepEqual(job.progress, ['等待空位', '提交中', '排队中', '生成中', '下载中'])
})

test('轮询：status 缺失直接报错，不继续轮询', async (t) => {
  const cwd = await makeCwd(t)
  const upstream = await startFakeUpstream((request) => {
    switch (request.path) {
      case '/v1/openapi/mode/set':
        return ok({})
      case '/v1/openapi/project/save':
        return ok({ project_id: 'project-link' })
      case '/v1/openapi/chat':
        return ok({ thread_id: 'thread-link' })
      case STATUS_PATH:
        return ok({})
      default:
        return { status: 404, json: { code: 404, error: '未配置' } }
    }
  })
  t.after(() => upstream.close())
  const harness = createHarness(upstream, cwd)
  const [id] = harness.start('猫')
  assert.ok(id !== undefined)
  const job = hookOf(harness, id)
  const outcome = await settle(job.hooks.done)
  assert.equal((outcome as { status?: string }).status, 'failed')
  assert.equal((outcome as { detail?: string }).detail, '上游响应缺少 status 字段')
  assert.equal(upstream.count(STATUS_PATH), 1)
})

test('轮询：abort 落 failed', async (t) => {
  const cwd = await makeCwd(t)
  const upstream = await lifecycleUpstream(['abort'])
  t.after(() => upstream.close())
  const harness = createHarness(upstream, cwd)
  const [id] = harness.start('猫')
  assert.ok(id !== undefined)
  const job = hookOf(harness, id)
  const outcome = await settle(job.hooks.done)
  assert.equal((outcome as { status?: string }).status, 'failed')
  assert.equal((outcome as { detail?: string }).detail, '上游中止了任务')
})

test('确认：pending_confirmation 进 confirming、不占名额、取消唤醒为 killed', async (t) => {
  const cwd = await makeCwd(t)
  const upstream = await lifecycleUpstream(['pending_confirmation'])
  t.after(() => upstream.close())
  const harness = createHarness(upstream, cwd)

  const [firstId] = harness.start('猫')
  assert.ok(firstId !== undefined)
  const first = harness.store.get(firstId)
  assert.ok(first !== undefined)
  await waitFor(() => first.phase === 'confirming', '进入 confirming')
  assert.equal(PHASE_TABLE.confirming.holdsSlot, false)
  assert.ok(hookOf(harness, firstId).progress.includes('等你确认（会扣积分）'))

  // active = 0（confirming 不持槽），所以还能一次开满 4 个。
  const ids = harness.start('猫', { count: 4 })
  assert.equal(ids.length, 4)

  for (const id of [firstId, ...ids]) hookOf(harness, id).hooks.cancel()
  const outcomes = await Promise.all(
    [firstId, ...ids].map((id) => hookOf(harness, id).hooks.done),
  )
  for (const outcome of outcomes) assert.equal(outcome.status, 'killed')
  assert.equal(first.phase, 'cancelled')
})

test('done 后 5s 复核：复核为 running 时不落盘', async (t) => {
  const cwd = await makeCwd(t)
  const upstream = await lifecycleUpstream(['done', 'running', 'done', 'done'])
  t.after(() => upstream.close())
  const harness = createHarness(upstream, cwd, 4, RECHECK_TIMINGS)

  const [id] = harness.start('猫')
  assert.ok(id !== undefined)
  const job = hookOf(harness, id)
  const meta = harness.store.get(id)
  assert.ok(meta !== undefined)

  await waitFor(() => upstream.count(STATUS_PATH) >= 1, '第一次 done')
  // 等的是「复核回来后的状态」，不是「请求已到达」：两者之间还隔着一次响应处理。
  await waitFor(() => meta.phase === 'generating', '复核 running')
  assert.equal(upstream.count(RESULT_PATH), 0)
  assert.equal(meta.files.length, 0)

  job.hooks.cancel()
  const outcome = await settle(job.hooks.done)
  assert.equal((outcome as { status?: string }).status, 'killed')
  assert.equal(upstream.count(RESULT_PATH), 0)
  assert.equal(meta.files.length, 0)
})

test('落盘：目录、命名、-2 去重、Content-Type 扩展名、并发不覆盖', async (t) => {
  const upstream = await startFakeUpstream((request) => {
    switch (request.path) {
      case '/img/png-a':
        return { bytes: new Uint8Array([1, 1, 1]), contentType: 'image/png' }
      case '/img/png-b':
        return { bytes: new Uint8Array([2, 2, 2]), contentType: 'image/png' }
      case '/img/jpeg':
        return { bytes: new Uint8Array([3, 3, 3]), contentType: 'image/jpeg' }
      default:
        return { status: 404, json: { code: 404, error: '未配置' } }
    }
  })
  t.after(() => upstream.close())
  const cwd = await makeCwd(t)
  const { client } = createHarness(upstream, cwd)
  const now = new Date(2026, 10, 8, 12, 15, 30)

  const [left, right] = await Promise.all([
    saveImages({
      client,
      urls: [`${upstream.baseUrl}/img/png-a`],
      cwd,
      prompt: '一只戴帽子的猫',
      now,
    }),
    saveImages({
      client,
      urls: [`${upstream.baseUrl}/img/png-b`],
      cwd,
      prompt: '一只戴帽子的猫',
      now,
    }),
  ])
  const leftPath = left[0]
  const rightPath = right[0]
  assert.ok(leftPath !== undefined)
  assert.ok(rightPath !== undefined)
  assert.notEqual(leftPath, rightPath)
  assert.match(leftPath, /lovart[\\/]20261108-121530_一只戴帽子的猫(-2)?\.png$/)
  assert.match(rightPath, /lovart[\\/]20261108-121530_一只戴帽子的猫(-2)?\.png$/)

  const names = [leftPath, rightPath].map((path) => path.split(/[\\/]/).at(-1)).sort()
  assert.deepEqual(names, ['20261108-121530_一只戴帽子的猫-2.png', '20261108-121530_一只戴帽子的猫.png'])
  assert.deepEqual([...new Uint8Array(await readFile(leftPath))], [1, 1, 1])
  assert.deepEqual([...new Uint8Array(await readFile(rightPath))], [2, 2, 2])

  const [jpegPath] = await saveImages({
    client,
    urls: [`${upstream.baseUrl}/img/jpeg`],
    cwd,
    prompt: '照片',
    now,
  })
  assert.ok(jpegPath !== undefined)
  assert.match(jpegPath, /\.jpg$/)
})

test('并发：连开 5 个不报错，第 5 个在 waiting 等空位', async (t) => {
  const cwd = await makeCwd(t)
  const upstream = await lifecycleUpstream(['pending'])
  t.after(() => upstream.close())
  const harness = createHarness(upstream, cwd, 4)

  const ids = Array.from({ length: 5 }, () => harness.start('猫')[0]).filter(
    (id): id is string => id !== undefined,
  )
  assert.equal(ids.length, 5, '提交不再因为并发被拒')

  // 前 4 个占槽并提交，第 5 个留在 waiting。
  await waitFor(() => upstream.count('/v1/openapi/chat') === 4, '四个已提交')
  assert.equal(
    ids.filter((id) => harness.store.get(id)?.phase === 'waiting').length,
    1,
    '第 5 个在等空位',
  )

  for (const id of ids) hookOf(harness, id).hooks.cancel()
  const outcomes = await Promise.all(ids.map((id) => hookOf(harness, id).hooks.done))
  for (const outcome of outcomes) assert.equal(outcome.status, 'killed')
})

test('排队中取消：不占槽、不提交上游，后面的任务顶上', async (t) => {
  const cwd = await makeCwd(t)
  const upstream = await lifecycleUpstream(['pending'])
  t.after(() => upstream.close())
  const harness = createHarness(upstream, cwd, 1)

  const first = harness.start('猫')[0]
  const second = harness.start('猫')[0]
  assert.ok(first !== undefined)
  assert.ok(second !== undefined)

  await waitFor(() => harness.store.get(first)?.phase === 'queued', '第一个已提交')
  assert.equal(harness.store.get(second)?.phase, 'waiting')

  // 取消排在后面的那个：它从没碰过上游，也不该占槽。
  hookOf(harness, second).hooks.cancel()
  const secondOutcome = await hookOf(harness, second).hooks.done
  assert.equal(secondOutcome.status, 'killed')
  assert.equal(upstream.count('/v1/openapi/chat'), 1, '排队中取消不产生提交')

  hookOf(harness, first).hooks.cancel()
  assert.equal((await hookOf(harness, first).hooks.done).status, 'killed')
})

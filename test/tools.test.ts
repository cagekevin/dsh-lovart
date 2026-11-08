import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createStore } from '../src/host/job/store.ts'
import type { LovartMeta } from '../src/host/job/run.ts'
import { createLovartTool } from '../src/host/tools.ts'

/** 工具不读 signal；测试里给一个真实的、不会被取消的。 */
const SIGNAL = new AbortController().signal

/** 造一条最小 meta；工具只读 id / phase / model / ratio / size 五个字段。 */
function metaOf(id: string): LovartMeta {
  return {
    jobId: id,
    sessionId: 's-1',
    prompt: '一只戴帽子的猫',
    model: 'nano-bn-2',
    ratio: '3:4',
    size: '2K',
    priority: 'normal',
    seq: 1,
    refs: [],
    phase: 'submitting',
    files: [],
    urls: [],
    confirmCount: 0,
    createdAt: 0,
  }
}

function setup(ids: string[], recorded: unknown[] = []) {
  const store = createStore<LovartMeta>()
  for (const id of ids) store.set(id, metaOf(id))
  const tool = createLovartTool({
    store,
    startJobs: (args) => {
      recorded.push(args)
      return ids
    },
  })
  return { tool, recorded }
}

test('lovart_generate：立即返回 job id 与元数据，不等图', async () => {
  const { tool } = setup(['job-1', 'job-2'])
  const value = await tool.execute({ prompt: '一只戴帽子的猫', count: 2 }, { signal: SIGNAL })
  assert.deepEqual(value, {
    jobs: [
      { id: 'job-1', phase: 'submitting', model: 'nano-bn-2', ratio: '3:4', size: '2K' },
      { id: 'job-2', phase: 'submitting', model: 'nano-bn-2', ratio: '3:4', size: '2K' },
    ],
  })
})

test('lovart_generate：入参先补默认值再交给 startJobs', async () => {
  const { tool, recorded } = setup(['job-1'])
  await tool.execute({ prompt: '猫' }, { signal: SIGNAL })
  assert.deepEqual(recorded[0], {
    prompt: '猫',
    model: 'nano-bn-2',
    ratio: '3:4',
    size: '2K',
    count: 1,
    refs: [],
    priority: 'normal',
  })
})

test('lovart_generate：空 prompt 直接拒绝，不建任务', async () => {
  const { tool } = setup(['job-1'])
  await assert.rejects(tool.execute({ prompt: '   ' }, { signal: SIGNAL }), /prompt/)
})

test('lovart_generate：同会话并发安全、参数 schema 必填 prompt', () => {
  const { tool } = setup([])
  assert.equal(tool.isConcurrencySafe?.({ prompt: '猫' }), true)
  assert.deepEqual(tool.parameters.required, ['prompt'])
  assert.equal(tool.name, 'lovart_generate')
})

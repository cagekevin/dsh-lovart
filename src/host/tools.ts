/**
 * 两条工具（规范 §6 C4）：
 *
 * - `lovart_generate`：提交任务，立即返回 job id，不等图；
 * - `lovart_board`：看本会话台面（prompt / 参数 / 队列位次），删一个已结束的任务。
 *
 * 分工写死：提交只有 `lovart_generate`，`lovart_board` **不含 submit**；
 * 取消仍走 DSH 的 `job_kill`（它是「放弃」，不是「停止」）。
 */

import { LovartError } from './errors.ts'
import { MAX_COUNT, MAX_REFS } from './lovart/types.ts'
import type { GenerateArgs } from './lovart/types.ts'
import { parseGenerateArgs } from './lovart/types.ts'
import type { ToolDefinitionPort, ToolRunContext } from './platform.ts'
import { buildSnapshot, removeJob } from './job/board.ts'
import type { LovartMeta } from './job/run.ts'
import type { Store } from './job/store.ts'

export interface LovartToolDeps {
  /** 提交任务；返回 ctx.jobs 发放的 id。由 index.ts 适配到 startLovartJobs。 */
  readonly startJobs: (args: GenerateArgs, context: ToolRunContext) => string[]
  readonly store: Store<LovartMeta>
}

const JOB_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    phase: { type: 'string' },
    model: { type: 'string' },
    ratio: { type: 'string' },
    size: { type: 'string' },
  },
  required: ['id', 'phase', 'model', 'ratio', 'size'],
  additionalProperties: false,
}

/** 工具定义；参数 schema 就是对外契约，改它等于改规范 §6 C4。 */
export function createLovartTool(deps: LovartToolDeps): ToolDefinitionPort {
  return {
    name: 'lovart_generate',
    // 描述就是给模型的说明书：怎么提交、满了怎么办、完成后做什么、历史在哪。
    description: [
      '提交 Lovart 出图任务，立即返回 job id，不等图（免费排队可能要几十分钟）。',
      `count 是任务数（1..${MAX_COUNT}），每个任务一张图；同时提交给上游的数量有上限（默认 4），超出的自动排队，不会报错，也不需要重试。`,
      '用户说「这张先出」时用 priority: "high" —— 它只对还在排队（waiting）的任务有效，已经提交给上游的改不了顺序。',
      '用 job_list 看本会话所有任务（含用户在侧栏提交的），用 job_output 取结果，job_kill 取消。',
      '任务完成时会收到 background job 通知：用 job_output 拿到图片绝对路径，把「生成完了 + 路径」告诉用户，然后停下，不要做其他事。',
      '若结果里写明是用户在侧栏自己提交的任务，什么都不要做。',
      '历史图都在会话工作目录的 lovart/ 下，文件名是「时间戳_提示词」；需要参考或避免重复时直接列这个目录（任务记录重启后不保留，图还在）。',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '图片描述，必填' },
        model: { type: 'string', description: '模型 id，默认 nano-bn-2' },
        ratio: { type: 'string', description: '宽高比，默认 3:4' },
        size: { type: 'string', enum: ['1K', '2K', '4K'], description: '分辨率，默认 2K' },
        count: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_COUNT,
          description: '任务数，默认 1',
        },
        refs: {
          type: 'array',
          items: { type: 'string' },
          maxItems: MAX_REFS,
          description: `参考图 CDN 地址，最多 ${MAX_REFS} 张；本地图片先用侧栏上传换取 URL`,
        },
        priority: {
          type: 'string',
          enum: ['high', 'normal'],
          description: '排队优先级，默认 normal；high 会插到所有普通任务前面',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: { jobs: { type: 'array', items: JOB_SCHEMA } },
        required: ['jobs'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, context) {
      const parsed = parseGenerateArgs(args)
      const ids = deps.startJobs(parsed, context)
      return {
        jobs: ids.map((id) => {
          const meta = deps.store.get(id)
          if (meta === undefined) throw LovartError.internal(`任务元数据缺失：${id}`)
          return {
            id,
            phase: meta.phase,
            model: meta.model,
            ratio: meta.ratio,
            size: meta.size,
          }
        }),
      }
    },
  }
}

/** 快照默认给最近 10 条；上限 50，避免把整段历史倒给模型。 */
const SNAPSHOT_DEFAULT = 10
const SNAPSHOT_MAX = 50

export interface BoardToolDeps {
  readonly store: Store<LovartMeta>
  /** 同时提交给上游的上限，来自 config。 */
  readonly maxConcurrency: number
  /** 删任务时连磁盘文件一起删。 */
  readonly removeFiles: (paths: readonly string[]) => Promise<void>
  /** 删 `waiting` 的任务要先取消，否则 run() 会继续跑一份不在 store 里的 meta。 */
  readonly cancelJob: (meta: LovartMeta) => 'requested' | 'already-finished'
}

/** 台面工具：只有「看」与「删」两个动作，不含提交。 */
export function createBoardTool(deps: BoardToolDeps): ToolDefinitionPort {
  return {
    name: 'lovart_board',
    description: [
      '查看本会话的 Lovart 台面，或删掉一个已结束的任务。',
      'snapshot：返回占用槽位、等待队列（含位次）、在跑任务（含提示词与参数）、最近结束的任务（含图片路径）。',
      'delete：只对已结束的任务有效（还在排队的也可以，会先取消），会连磁盘图片一起删；跨会话的任务看不到也删不掉。',
      '提交任务用 lovart_generate；取消任务用 job_kill（它是放弃，不是停止）。',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['snapshot', 'delete'], description: '要做什么' },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: SNAPSHOT_MAX,
          description: `snapshot 里 finished 的条数，默认 ${SNAPSHOT_DEFAULT}`,
        },
        jobId: { type: 'string', description: 'delete 时要删的任务 id' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, context) {
      const sessionId = context.agent?.id
      if (sessionId === undefined) throw LovartError.invalidInput('无法确定当前会话')

      const record = typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {}
      const action = record.action

      if (action === 'snapshot') {
        return buildSnapshot({
          store: deps.store,
          sessionId,
          max: deps.maxConcurrency,
          limit: readLimit(record.limit),
        })
      }

      if (action === 'delete') {
        const jobId = record.jobId
        if (typeof jobId !== 'string' || jobId === '') {
          throw LovartError.invalidInput('delete 需要 jobId')
        }
        await removeJob({
          store: deps.store,
          sessionId,
          jobId,
          removeFiles: deps.removeFiles,
          cancelJob: deps.cancelJob,
        })
        return { deleted: true }
      }

      throw LovartError.invalidInput('action 只能是 snapshot 或 delete')
    },
  }
}

/** `limit` 非法就退回默认值：这是展示参数，不值得让整次调用失败。 */
function readLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return SNAPSHOT_DEFAULT
  return Math.min(Math.max(value, 1), SNAPSHOT_MAX)
}

/**
 * 模型表（规范 §4.4）。唯一真源，别名匹配与 tool_config 都从这里派生。
 *
 * 匹配用「子串包含 + 表顺序命中」，所以更长的别名必须排在前面：
 * `nano-bn-2-lite` 在 `nano-bn-2` 之前，`gpt-image-2.6-*` 在 `gpt-image-2-*` 之前。
 * 没有兜底项，未知模型直接报错，不静默换模型。
 */

import { LovartError } from '../errors.ts'

export type Quality = 'low' | 'medium' | 'high'

/** 出图尺寸；与 SIZE_OPTIONS 同一份定义，解析与下拉都不另写一份。 */
export type Size = '1K' | '2K' | '4K'

export interface ModelSpec {
  readonly id: string
  readonly readableName: string
  /** prompt 里的模型名；质量档位单独拼，不重复写进这里。 */
  readonly promptName: string
  readonly tool: string | undefined
  readonly quality: Quality | undefined
  /** 同一模型的可识别写法（子串匹配，已归一成小写与连字符）。 */
  readonly aliases: readonly string[]
}

/** P0 只放 IMAGE。别名更长的必须同时写全，避免被短别名抢先。 */
export const MODEL_TABLE: readonly ModelSpec[] = [
  {
    id: 'gpt-image-2.6-sunburst-low',
    readableName: 'GPT Image 2.6 Sunburst Low',
    promptName: 'GPT Image 2.6 Sunburst',
    tool: 'generate_image_gpt_image_2_6_sunburst',
    quality: 'low',
    aliases: ['gpt-image-2.6-sunburst-low', 'sunburst-low'],
  },
  {
    id: 'gpt-image-2.6-sunburst-medium',
    readableName: 'GPT Image 2.6 Sunburst Medium',
    promptName: 'GPT Image 2.6 Sunburst',
    tool: 'generate_image_gpt_image_2_6_sunburst',
    quality: 'medium',
    aliases: ['gpt-image-2.6-sunburst-medium', 'sunburst-medium'],
  },
  {
    id: 'gpt-image-2.6-flare-low',
    readableName: 'GPT Image 2.6 Flare Low',
    promptName: 'GPT Image 2.6 Flare',
    tool: 'generate_image_gpt_image_2_6_flare',
    quality: 'low',
    aliases: ['gpt-image-2.6-flare-low', 'flare-low'],
  },
  {
    id: 'gpt-image-2.6-flare-medium',
    readableName: 'GPT Image 2.6 Flare Medium',
    promptName: 'GPT Image 2.6 Flare',
    tool: 'generate_image_gpt_image_2_6_flare',
    quality: 'medium',
    aliases: ['gpt-image-2.6-flare-medium', 'flare-medium'],
  },
  {
    id: 'gpt-image-2-low',
    readableName: 'GPT Image 2 Low',
    promptName: 'GPT Image 2',
    tool: 'generate_image_gpt_image_2',
    quality: 'low',
    aliases: ['gpt-image-2-low'],
  },
  {
    id: 'gpt-image-2-medium',
    readableName: 'GPT Image 2 Medium',
    promptName: 'GPT Image 2',
    tool: 'generate_image_gpt_image_2',
    quality: 'medium',
    aliases: ['gpt-image-2-medium'],
  },
  {
    id: 'gpt-image-2-high',
    readableName: 'GPT Image 2 High',
    promptName: 'GPT Image 2',
    tool: 'generate_image_gpt_image_2',
    quality: 'high',
    aliases: ['gpt-image-2-high'],
  },
  {
    id: 'nano-bn-2-lite',
    readableName: 'Nano Banana 2 Lite',
    promptName: 'Nano Banana 2 Lite',
    tool: undefined,
    quality: undefined,
    aliases: ['nano-bn-2-lite', 'nano-banana-2-lite'],
  },
  {
    id: 'nano-bn-pro',
    readableName: 'Nano Banana Pro',
    promptName: 'Nano Banana Pro',
    tool: 'generate_image_nano_banana_pro',
    quality: undefined,
    aliases: ['nano-bn-pro', 'nano-banana-pro'],
  },
  {
    id: 'nano-bn-2',
    readableName: 'Nano Banana 2',
    promptName: 'Nano Banana 2',
    tool: 'generate_image_nano_banana_2',
    quality: undefined,
    aliases: ['nano-bn-2', 'nano-banana-2'],
  },
]

export const DEFAULT_MODEL_ID = 'nano-bn-2'

/** 比例候选：与参考实现 ui/app.js 的 RATIOS 一致；上游对模型不做比例互斥。 */
export const RATIO_OPTIONS: readonly string[] = ['1:1', '3:4', '4:3', '16:9', '9:16']

/** 尺寸候选：与参考实现 ui/app.js 的 SIZES 一致；全部模型共用，无按模型限制。 */
export const SIZE_OPTIONS: readonly Size[] = ['1K', '2K', '4K']

export const DEFAULT_RATIO = '3:4'
export const DEFAULT_SIZE: Size = '2K'

/** 尺寸窄化；候选表变化时这里自动跟随。 */
export function isSize(value: string): value is Size {
  return SIZE_OPTIONS.some((size) => size === value)
}

/** 侧栏下拉的一项；只暴露 id 与可读名，别名与工具名留在 host。 */
export interface ModelOption {
  readonly id: string
  readonly name: string
}

/** 下拉选项唯一派生入口；`GET /lovart/api/options` 直接用它。 */
export function modelOptions(): ModelOption[] {
  return MODEL_TABLE.map((model) => ({ id: model.id, name: model.readableName }))
}

/** 把用户写法归一成小写连字符形式。 */
export function normalizeModelInput(input: string): string {
  return input.trim().toLowerCase().replace(/[\s_]+/g, '-')
}

/** 子串包含 + 表顺序首个命中；没有命中原样报错，不换模型。 */
export function resolveModel(input: string | undefined): ModelSpec {
  const value = normalizeModelInput(input ?? DEFAULT_MODEL_ID)
  for (const model of MODEL_TABLE) {
    if (model.aliases.some((alias) => value.includes(alias))) return model
  }
  throw LovartError.invalidInput(`未知模型：${input ?? ''}`)
}

/** 有工具名才下发 `tool_config`；空工具名下发会被上游当成无效工具（规范 §6 C1）。 */
export function toolConfigFor(model: ModelSpec): Record<string, unknown> | undefined {
  if (model.tool === undefined) return undefined
  return { prefer_tool_categories: { IMAGE: [model.tool] } }
}

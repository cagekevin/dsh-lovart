/**
 * prompt 拼装（规范 §6 C1 第 1 条）。
 *
 * ratio / size 不是 API 参数，只能进这段文本；把它们塞进 body 会被上游忽略，
 * 表现是「图出来了但比例不对」。模板逐字对齐上游，别改标点。
 */

import type { ModelSpec } from './models.ts'
import type { Size } from './types.ts'

export interface PromptInput {
  readonly prompt: string
  readonly model: ModelSpec
  readonly ratio: string
  readonly size: Size
  /** 有垫图时加一句声明；缺省 false，保持 P1 的文本逐字不变。 */
  readonly hasRefs?: boolean
}

/** 唯一 prompt 拼装入口；调用方不再自己拼字符串。 */
export function buildPrompt(input: PromptInput): string {
  const settings = `resolution: ${input.size}, aspect_ratio: ${input.ratio}`
  const quality = input.model.quality === undefined ? '' : `, quality ${input.model.quality}`
  const instruction = `Generate exactly ONE image using the ${input.model.promptName} model${quality}.`
  // 参考实现把这句话放在同一行句首；垫图为空时不出现。
  const head = input.hasRefs === true ? `Reference image attached. ${instruction}` : instruction
  return [
    settings,
    head,
    '<user_prompt>',
    input.prompt,
    '</user_prompt>',
    '以上为用户提示词原文，直接使用，请勿修改',
  ].join('\n')
}

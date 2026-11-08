/**
 * 插件配置（规范 §7：schemastery，DSH 设置页自动生成表单）。
 * 只放部署者可调参数；凭据走 credentialRef，不在这里，也不缓存。
 */
import z from '@deepseek-ai/schemastery'

/** 部署者可调参数。默认值以规范 §5.6 / §6 C1 为准。 */
export interface Config {
  /** 上游 Base URL；换环境只改这里。 */
  baseUrl: string
  /**
   * 同时提交给上游的任务数（不是「最多能提几个」——超出的进队列）。
   * Lovart 服务端最多 8 个槽，本地默认 4（规范 §5.6）。
   */
  maxConcurrency: number
}

/** Loader 读取的配置 schema；默认值集中在此，不在业务代码里散落。 */
export const Config: z<Config> = z.object({
  baseUrl: z.string().default('https://lgw.lovart.ai'),
  maxConcurrency: z.number().step(1).min(1).max(8).default(4),
})

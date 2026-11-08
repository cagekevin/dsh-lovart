/**
 * 八个上游端点（规范 §6 C1）。端点字符串只在这里出现，其他模块不拼 path。
 *
 * 本文件不碰 URL、凭据与超时：那三样在 request.ts 的闭包里。
 * 返回形状仍走 types.ts 的唯一窄化函数，这里只负责把 data 交过去。
 */

import type { RefUpload } from './refs.ts'
import { parseUploadUrl } from './refs.ts'
import type { LovartClient } from './request.ts'
import {
  parseChatResult,
  parseIdField,
  parseUpstreamStatus,
  type ChatResult,
  type UpstreamStatus,
} from './types.ts'

export interface SendChatInput {
  readonly prompt: string
  readonly projectId: string
  /** 空工具名的模型传 undefined，`tool_config` 整体不下发。 */
  readonly toolConfig: Record<string, unknown> | undefined
  /** 参考图 CDN 地址；空数组时整个字段不下发（`[]` 与不传是两种语义）。 */
  readonly attachments: readonly string[]
}

export interface LovartApi {
  setUnlimited(unlimited: boolean): Promise<void>
  queryMode(): Promise<unknown>
  createProject(): Promise<string>
  sendChat(input: SendChatInput): Promise<string>
  getStatus(threadId: string): Promise<UpstreamStatus>
  getResult(threadId: string): Promise<ChatResult>
  confirm(threadId: string): Promise<void>
  /** 本地图片转 CDN 地址；失败直接抛，不降级成纯文本生成。 */
  uploadFile(file: RefUpload): Promise<string>
}

/** 八个端点只在这里组装；调用方拿不到 path，也就写不出第二个端点表。 */
export function createLovartApi(client: LovartClient): LovartApi {
  return {
    async setUnlimited(unlimited) {
      await client.signedPost('/v1/openapi/mode/set', { unlimited })
    },

    queryMode() {
      return client.signedPost('/v1/openapi/mode/query', {})
    },

    async createProject() {
      const data = await client.signedPost('/v1/openapi/project/save', {
        project_id: '',
        canvas: '',
        project_cover_list: [],
        pic_count: 0,
        project_type: 3,
      })
      return parseIdField(data, 'project_id')
    },

    async sendChat(input) {
      const body: Record<string, unknown> = {
        prompt: input.prompt,
        project_id: input.projectId,
      }
      if (input.attachments.length > 0) body.attachments = [...input.attachments]
      if (input.toolConfig !== undefined) body.tool_config = input.toolConfig
      const data = await client.signedPost('/v1/openapi/chat', body)
      return parseIdField(data, 'thread_id')
    },

    async getStatus(threadId) {
      return parseUpstreamStatus(
        await client.signedGet('/v1/openapi/chat/status', { thread_id: threadId }),
      )
    },

    async getResult(threadId) {
      return parseChatResult(
        await client.signedGet('/v1/openapi/chat/result', { thread_id: threadId }),
      )
    },

    async confirm(threadId) {
      await client.signedPost('/v1/openapi/chat/confirm', { thread_id: threadId })
    },

    async uploadFile(file) {
      const data = await client.signedUpload('/v1/openapi/file/upload', file)
      return parseUploadUrl(data)
    },
  }
}

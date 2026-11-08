/**
 * 链路验证用的本地假上游（只存在于 test/，不进口生产代码）。
 *
 * 用真实 `node:http` 监听 127.0.0.1，让 `createLovartClient` / `createLovartApi`
 * 走真实 fetch 与真实响应解析；handler 只决定返回什么，不替被测代码做判断。
 */

import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

/** 一次被记录下来的上游请求。 */
export interface FakeRequest {
  readonly method: string
  readonly path: string
  readonly query: URLSearchParams
  readonly headers: IncomingHttpHeaders
  readonly text: string
  readonly body: unknown
}

/** handler 的返回形状；`json` 与 `bytes` 二选一。 */
export interface FakeReply {
  readonly status?: number
  readonly json?: unknown
  readonly bytes?: Uint8Array
  readonly contentType?: string
}

export interface FakeUpstream {
  readonly baseUrl: string
  readonly requests: readonly FakeRequest[]
  /** 按 path（可选 method）数请求次数。 */
  count(path: string, method?: string): number
  close(): Promise<void>
}

function parseBody(text: string): unknown {
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

async function readText(stream: AsyncIterable<unknown>): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array))
  return Buffer.concat(chunks).toString('utf8')
}

function writeReply(response: ServerResponse, reply: FakeReply): void {
  const status = reply.status ?? 200
  if (reply.bytes !== undefined) {
    response.writeHead(status, { 'content-type': reply.contentType ?? 'application/octet-stream' })
    response.end(Buffer.from(reply.bytes))
    return
  }
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(reply.json === undefined ? '' : JSON.stringify(reply.json))
}

/** 启动假上游；每个测试自己建一个，结束后 close。 */
export async function startFakeUpstream(
  handle: (request: FakeRequest) => FakeReply | Promise<FakeReply>,
): Promise<FakeUpstream> {
  const requests: FakeRequest[] = []
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const text = await readText(request)
      const record: FakeRequest = {
        method: request.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        headers: request.headers,
        text,
        body: parseBody(text),
      }
      requests.push(record)
      try {
        writeReply(response, await handle(record))
      } catch {
        writeReply(response, { status: 500, json: { code: 500, error: '假上游 handler 抛错' } })
      }
    })()
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('假上游没有拿到端口')
  }
  const baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`

  return {
    baseUrl,
    requests,
    count: (path, method) =>
      requests.filter((item) => item.path === path && (method === undefined || item.method === method))
        .length,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)))
      })
    },
  }
}

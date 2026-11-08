/**
 * media.ts 的纯逻辑测试：只验 URL 拼装与编码，不验浏览器是否出图（那要真 DSH）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mediaUrl } from '../src/client/media.ts'

/** 记录 hostRouteUrl 收到的路径，并返回一个可解析的绝对地址。 */
function locatorWith(calls: string[]): { get(name: string): unknown } {
  return {
    get: (name) =>
      name === 'betterSidebar'
        ? {
            hostRouteUrl: (path: string): string => {
              calls.push(path)
              return `https://dsh.test/${path}`
            },
          }
        : undefined,
  }
}

test('路径与文件名全部编码，特殊字符不会拆出额外参数', () => {
  const calls: string[] = []
  const path = '/work/lovart/一只 猫&50%#1.png'
  const url = mediaUrl(locatorWith(calls), { sessionId: 's-1' }, path)

  const raw = calls[0] ?? ''
  assert.ok(raw.startsWith('sidebar/file?'), '不得带前导斜杠，否则丢掉反代前缀')
  const parsed = new URL(url)
  assert.equal(parsed.pathname, '/sidebar/file')
  assert.equal(parsed.searchParams.get('sessionId'), 's-1')
  assert.equal(parsed.searchParams.get('path'), path)
  assert.equal(parsed.searchParams.get('cwd'), null)
})

test('有 cwd 时带上，空串不带', () => {
  const calls: string[] = []
  mediaUrl(locatorWith(calls), { sessionId: 's-1', cwd: '/work' }, '/work/lovart/a.png')
  assert.equal(new URL(calls[0] ?? '/', 'https://dsh.test/').searchParams.get('cwd'), '/work')

  calls.length = 0
  mediaUrl(locatorWith(calls), { sessionId: 's-1', cwd: '' }, '/work/lovart/a.png')
  assert.equal(new URL(calls[0] ?? '/', 'https://dsh.test/').searchParams.get('cwd'), null)
})

test('缺 betterSidebar 服务直接报错，不返回空地址', () => {
  assert.throws(
    () => mediaUrl({ get: () => undefined }, { sessionId: 's-1' }, '/work/lovart/a.png'),
    /betterSidebar/,
  )
})

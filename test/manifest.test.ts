/**
 * 清单边界测试：零运行时依赖、ESM 入口、dsh bundle 补丁。
 * 这些是规范 §6 C2 的硬约束，改 package.json 时先让本测试红。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readManifest(): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.ok(isRecord(parsed), 'package.json 必须是对象')
  return parsed
}

test('package.json：零运行时依赖', () => {
  const deps = readManifest().dependencies
  assert.ok(deps === undefined || (isRecord(deps) && Object.keys(deps).length === 0))
})

test('package.json：ESM 入口与 dsh 清单', () => {
  const manifest = readManifest()
  // 包名不能以 dsh- 开头：桌面端会把这类包当成自己的内部预设插件，
  // 不在它的清单里就判为孤立并强制卸载（详见 cordis.patch.yml 的注释）。
  assert.equal(manifest.name, 'lovart-dsh-plugin')
  assert.ok(!String(manifest.name).startsWith('dsh-'), '包名不能以 dsh- 开头')
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.main, 'lib/index.js')

  const dsh = manifest.dsh
  assert.ok(isRecord(dsh), 'dsh 字段必须是对象')
  assert.ok(isRecord(dsh.bundle), 'dsh.bundle 必须是对象')
  assert.equal(dsh.bundle.patch, './cordis.patch.yml')
})

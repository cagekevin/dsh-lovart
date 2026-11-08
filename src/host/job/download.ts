/**
 * P5 落盘（规范 §3 P5 / §6 C6）。
 *
 * 命名、扩展名、去重都是纯函数，测试直接断言；真正写盘只在 saveImages 里。
 * 不覆盖同名文件：同内容重复生成必须得到 `-2`、`-3`。
 */

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LovartError } from '../errors.ts'
import type { LovartClient } from '../lovart/request.ts'

const FORBIDDEN = /[\\/:*?"<>|]/g
const EXT_BY_TYPE: Readonly<Record<string, string>> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}
const SLUG_LIMIT = 40

/** 本地时间戳 `20261108-121530`；用本地时区，和用户看到的文件名一致。 */
export function stamp(date: Date): string {
  const two = (value: number): string => String(value).padStart(2, '0')
  return [
    `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}`,
    `${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`,
  ].join('-')
}

/** 文件名 slug：换行/制表→空格、去非法字符、连续空白→_、截断 40 字、空则 prompt。 */
export function slugify(prompt: string): string {
  const cleaned = prompt
    .replace(/[\n\t]+/g, ' ')
    .replace(FORBIDDEN, '')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
  const shortened = Array.from(cleaned).slice(0, SLUG_LIMIT).join('')
  return shortened.length > 0 ? shortened : 'prompt'
}

/** 按 Content-Type 取扩展名；未知与缺失一律兜底 .png。 */
export function extensionFor(contentType: string | undefined): string {
  if (contentType === undefined) return '.png'
  const base = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  return EXT_BY_TYPE[base] ?? '.png'
}

/** 第 1 个文件不带后缀，第 2 个起加 `-2`，后缀在扩展名之前。 */
export function fileName(base: string, index: number, extension: string): string {
  return index <= 1 ? `${base}${extension}` : `${base}-${index}${extension}`
}

export interface SaveImagesInput {
  readonly client: LovartClient
  readonly urls: readonly string[]
  readonly cwd: string
  readonly prompt: string
  readonly now: Date
  /** 每张之间问一次：用户取消了就别把剩下的也下完。 */
  readonly isCancelled?: () => boolean
}

/** 下载并落盘到 `<cwd>/lovart/`；返回本地绝对路径。 */
export async function saveImages(input: SaveImagesInput): Promise<string[]> {
  const directory = join(input.cwd, 'lovart')
  await mkdir(directory, { recursive: true })
  const base = `${stamp(input.now)}_${slugify(input.prompt)}`
  const files: string[] = []
  for (const url of input.urls) {
    if (input.isCancelled?.() === true) break
    const downloaded = await input.client.download(url)
    const extension = extensionFor(downloaded.contentType)
    files.push(await writeNew(directory, base, extension, downloaded.bytes))
  }
  return files
}

/**
 * 删除已落盘的图（删任务时用）。
 *
 * `force` 让「文件已被用户自己删掉」也算成功：删任务的目标是「这张图不在了」，
 * 不是「必须由我删掉」。其余错误照常抛，不静默吞。
 */
export async function removeImages(paths: readonly string[]): Promise<void> {
  await Promise.all(paths.map((path) => rm(path, { force: true })))
}

/** 用 `wx` 原子占位：同名已存在就换 `-2`、`-3`，不覆盖也不先查后写。 */
async function writeNew(
  directory: string,
  base: string,
  extension: string,
  bytes: Uint8Array,
): Promise<string> {
  for (let index = 1; index < 1000; index += 1) {
    const candidate = join(directory, fileName(base, index, extension))
    try {
      await writeFile(candidate, bytes, { flag: 'wx' })
      return candidate
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw LovartError.internal('同名文件过多，无法落盘')
}

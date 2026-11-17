/**
 * 垫图协议层：data URL 解析、本地路径读取、三种形态归一、上传响应窄化。
 *
 * 这些判断必须在 host 侧成立；浏览器只是把文件读成 data URL，不决定类型。
 */
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { LovartError } from '../src/host/errors.ts'
import {
  parseRefUpload,
  parseUploadUrl,
  resolveRefs,
  type RefUpload,
} from '../src/host/lovart/refs.ts'

/** 四种图片的最小文件头；够 sniffImageType 认出来。 */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x00])
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from([0])])

test('data URL：解出 MIME / 文件名 / 原始字节', () => {
  const file = parseRefUpload({
    name: '一只猫.PNG',
    dataUrl: 'data:image/png;base64,AAEC',
  })
  assert.equal(file.contentType, 'image/png')
  assert.equal(file.filename, '一只猫.PNG')
  assert.deepEqual([...file.bytes], [0, 1, 2])
})

test('data URL：缺扩展名时按 MIME 补，非法字符替换为下划线', () => {
  const file = parseRefUpload({ name: 'cat pic', dataUrl: 'data:image/jpeg;base64,AAEC' })
  assert.equal(file.filename, 'cat_pic.jpg')
})

test('data URL：只收 png / jpeg / webp / gif', () => {
  assert.throws(
    () => parseRefUpload({ name: 'a.txt', dataUrl: 'data:text/plain;base64,AAEC' }),
    LovartError,
  )
  assert.throws(() => parseRefUpload({ name: 'a.png', dataUrl: 'https://cdn/a.png' }), LovartError)
  assert.throws(() => parseRefUpload({}), LovartError)
})

test('data URL：空内容拒绝（不再有大小上限）', () => {
  assert.throws(() => parseRefUpload({ name: 'a.png', dataUrl: 'data:image/png;base64,' }), LovartError)
})

test('上传响应：只认 data.url，缺字段或协议不对都报错', () => {
  assert.equal(parseUploadUrl({ url: 'https://cdn.example.com/a.png' }), 'https://cdn.example.com/a.png')
  assert.throws(() => parseUploadUrl({}), LovartError)
  assert.throws(() => parseUploadUrl({ url: '' }), LovartError)
  assert.throws(() => parseUploadUrl({ url: 'file:///tmp/a.png' }), LovartError)
})

/** 临时目录里放一张真图；每个用例自己建、自己删。 */
async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'lovart-refs-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** 假上传：记录收到的字节，返回可辨认的 CDN 地址。 */
function recordingUpload(): { calls: RefUpload[]; upload: (file: RefUpload) => Promise<string> } {
  const calls: RefUpload[] = []
  return {
    calls,
    upload: async (file) => {
      calls.push(file)
      return `https://cdn.example.com/${file.filename}`
    },
  }
}

test('resolveRefs：http(s) 地址原样透传，不重复上传', async () => {
  const { calls, upload } = recordingUpload()
  const urls = await resolveRefs(['https://cdn.example.com/a.png'], '/nowhere', upload)
  assert.deepEqual(urls, ['https://cdn.example.com/a.png'])
  assert.equal(calls.length, 0)
})

test('resolveRefs：本地绝对路径读成字节，类型按文件头认', async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, '猫.png')
    await writeFile(path, PNG)
    const { calls, upload } = recordingUpload()

    const urls = await resolveRefs([path], '/nowhere', upload)

    assert.deepEqual(urls, ['https://cdn.example.com/猫.png'])
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.contentType, 'image/png')
    assert.deepEqual([...calls[0]!.bytes], [...PNG])
  })
})

test('resolveRefs：相对路径按 cwd 解析', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'a.jpg'), JPEG)
    const { calls, upload } = recordingUpload()

    const urls = await resolveRefs(['a.jpg'], dir, upload)

    assert.deepEqual(urls, ['https://cdn.example.com/a.jpg'])
    assert.equal(calls[0]?.contentType, 'image/jpeg')
  })
})

test('resolveRefs：扩展名说谎时按文件头认类型', async () => {
  await withTempDir(async (dir) => {
    // 名字是 .png，内容是 JPEG：contentType 以文件头为准（文件名只是 multipart 的 label）。
    const path = join(dir, '假的.png')
    await writeFile(path, JPEG)
    const { calls, upload } = recordingUpload()

    await resolveRefs([path], dir, upload)

    assert.equal(calls[0]?.contentType, 'image/jpeg')
  })
})

test('resolveRefs：data URL 解字节后上传', async () => {
  const { calls, upload } = recordingUpload()
  const urls = await resolveRefs(['data:image/gif;base64,AAEC'], '/nowhere', upload)
  assert.deepEqual(urls, ['https://cdn.example.com/ref.gif'])
  assert.equal(calls[0]?.contentType, 'image/gif')
})

test('resolveRefs：三种形态混在一批里，顺序保持不变', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'local.png'), PNG)
    const { upload } = recordingUpload()

    const urls = await resolveRefs(
      ['https://cdn.example.com/keep.png', 'local.png', 'data:image/webp;base64,AAEC'],
      dir,
      upload,
    )

    assert.deepEqual(urls, [
      'https://cdn.example.com/keep.png',
      'https://cdn.example.com/local.png',
      'https://cdn.example.com/ref.webp',
    ])
  })
})

test('resolveRefs：读不到的路径与不是图片的文件都整批报错', async () => {
  await withTempDir(async (dir) => {
    const { upload } = recordingUpload()
    await assert.rejects(resolveRefs([join(dir, '不存在.png')], dir, upload), LovartError)

    const text = join(dir, 'note.png')
    await writeFile(text, Buffer.from('这不是图片'))
    await assert.rejects(resolveRefs([text], dir, upload), LovartError)
  })
})

test('resolveRefs：一张失败就整批不返回（不静默少图）', async () => {
  await withTempDir(async (dir) => {
    await writeFile(join(dir, 'good.png'), PNG)
    const { upload } = recordingUpload()
    await assert.rejects(
      resolveRefs(['good.png', 'bad.png'], dir, upload),
      LovartError,
    )
  })
})

test('sniff 覆盖四种图片类型', async () => {
  await withTempDir(async (dir) => {
    const cases: Array<[string, Buffer, string]> = [
      ['a.png', PNG, 'image/png'],
      ['b.jpg', JPEG, 'image/jpeg'],
      ['c.gif', GIF, 'image/gif'],
      ['d.webp', WEBP, 'image/webp'],
    ]
    for (const [name, bytes, expected] of cases) {
      await writeFile(join(dir, name), bytes)
      const { calls, upload } = recordingUpload()
      await resolveRefs([name], dir, upload)
      assert.equal(calls[0]?.contentType, expected, name)
    }
  })
})

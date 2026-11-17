/**
 * 在系统文件管理器里打开一个文件夹。
 *
 * 唯一入口：`openFolder()`。调用方只给路径，平台差异全在这一处收敛
 * （ADR-0005：一个能力一个入口）。路径只能来自 `LovartMeta.files` 派生的目录，
 * 不接受前端传路径 —— 否则等于给侧栏开一个「打开任意目录」的后门。
 *
 * 用 `node:child_process` 起系统命令，不引依赖（规范：运行时依赖 = 0）。
 * 命令一律以参数数组形式传入（不经 shell），路径里的空格与特殊字符不会被二次解释。
 */

import { spawn } from 'node:child_process'
import { dirname } from 'node:path'

/** 打开失败的原因；调用方按它决定 HTTP 状态。 */
export class OpenFolderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpenFolderError'
  }
}

/**
 * 各平台打开文件夹的命令。
 *
 * - win32：`explorer` 打开目录本身。**不能加 `/select,`** —— 那是「选中文件」，
 *   目录加 /select 会打开它的上级并把目录选中，与「打开文件夹」不是一回事。
 * - darwin：`open` 不带 `-R`，`-R` 是 reveal（在 Finder 里选中），同样不是「打开」。
 * - linux：`xdg-open`，桌面环境的标准入口；没有图形环境时它会自己失败。
 */
function commandOf(platform: NodeJS.Platform, folder: string): { file: string; args: string[] } {
  switch (platform) {
    case 'win32':
      return { file: 'explorer', args: [folder] }
    case 'darwin':
      return { file: 'open', args: [folder] }
    default:
      return { file: 'xdg-open', args: [folder] }
  }
}

/**
 * 打开某个图片文件所在的文件夹。
 *
 * 给的是文件路径，打开的是它的目录：侧栏说的是「打开文件所在位置」。
 * 文件不存在也照开目录 —— 图可能已被用户手动移走，但目录仍值得看一眼。
 */
export async function openFolderOfFile(
  filePath: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const folder = dirname(filePath)
  const { file, args } = commandOf(platform, folder)

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const child = spawn(file, args, {
      // 完全脱离父进程：文件管理器是独立应用，不该跟着 DSH 的 stdin/stdout 走。
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })

    // 起不来（命令不存在、无权限）走这里；这是唯一能拿到原因的时刻。
    child.on('error', (error: Error) => {
      if (settled) return
      settled = true
      reject(new OpenFolderError(`打开文件夹失败：${error.message}`))
    })

    // 文件管理器常常不退出（explorer 会一直挂着），所以不 await 退出码：
    // 只要进程起来了就算成功，detached + unref 让它自己活。
    child.on('spawn', () => {
      if (settled) return
      settled = true
      child.unref()
      resolve()
    })
  })
}

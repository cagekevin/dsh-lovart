/**
 * 开发期工具共用的文件判定（不是检查规则，不判断代码对错）。
 *
 * mv-sync-refs.mjs 用它回答三个问题：哪些文件算源码、哪些目录不参与扫描、
 * 一个 import 说明符最终指向哪个真实源文件。口径固定在这里，避免每个命令各写一套。
 */
import { existsSync } from 'node:fs'

/** 参与扫描的扩展名。 */
export const SCAN_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

/** 允许互转后缀的源码扩展名。 */
export const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.jsx']

/** 不参与改写的目录（产物、依赖、治理数据）。 */
export const TS_EXEMPT_DIRS = ['node_modules', 'lib', 'dist', 'daily', 'docs', 'scripts']

/** 不参与改写的单文件。 */
export const TS_EXEMPT_FILES = []

const toPosix = (p) => p.replace(/\\/g, '/')

/** 相对仓库根的路径是否落在豁免目录里。 */
export function isExempt(relPath) {
  const p = toPosix(relPath)
  if (TS_EXEMPT_FILES.includes(p)) return true
  return TS_EXEMPT_DIRS.some((dir) => p === dir || p.startsWith(`${dir}/`))
}

/**
 * 把 import 说明符解析出的绝对路径归一成真实源文件。
 * Node-ESM 域常写 `.js` 指向 `.ts` 源，这里按存在性回退，不猜。
 */
export function resolveSourceFile(absPath, exists = defaultExists) {
  if (!absPath) return null
  if (exists(absPath)) return absPath
  const candidates = []
  if (absPath.endsWith('.js')) candidates.push(absPath.slice(0, -3) + '.ts', absPath.slice(0, -3) + '.tsx')
  if (absPath.endsWith('.jsx')) candidates.push(absPath.slice(0, -4) + '.tsx')
  if (!/\.[a-z]+$/i.test(absPath)) {
    candidates.push(`${absPath}.ts`, `${absPath}.tsx`, `${absPath}/index.ts`, `${absPath}/index.tsx`)
  }
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate
  }
  return null
}

/** 内容是否像 JSX（只用于 convert 时选 .ts 还是 .tsx）。 */
export function hasJsx(code) {
  return /<\/[A-Za-z]|<[A-Za-z][\w.]*(\s[^<>]*)?\/?>/.test(code)
}

/** 文件里是否已有显式 JSX 提示（pragma / createElement），用于避免启发式误报。 */
export function hasJsxHintRaw(code) {
  return /@jsx|React\.createElement|jsx\s*\(/.test(code)
}

function defaultExists(p) {
  return existsSync(p)
}

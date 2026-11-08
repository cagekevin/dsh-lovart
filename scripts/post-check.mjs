#!/usr/bin/env node
/**
 * `npm run check` 的最后一步：输出 typecheck 的真实结果 + 交付四问。
 *
 * 这是**回执**，不是闸：
 * - 只复述官方命令 `tsc --noEmit` 的真实退出码与首屏错误，不判断代码对错；
 * - 四问原文从 `AGENTS.md` 截取，这里不写第二份；
 * - 读不到、跑不起时降级为一句提示，**绝不让 check 变红**。
 */
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const START = '**绿 ≠ 对。**'
const END = '范围外发现另开债。'

const STYLE = process.stdout.isTTY
  ? { bold: '\u001b[1m', yellow: '\u001b[33m', red: '\u001b[31m', green: '\u001b[32m', reset: '\u001b[0m' }
  : { bold: '', yellow: '', red: '', green: '', reset: '' }
const bar = '━'.repeat(64)

const tsc = spawnSync(join('node_modules', '.bin', 'tsc'), ['--noEmit'], { encoding: 'utf8' })
const typecheckOk = tsc.status === 0
const typecheckOut = `${tsc.stdout ?? ''}${tsc.stderr ?? ''}`.trim()

console.log(`\n${bar}`)
console.log(`${STYLE.bold} typecheck 实跑（tsc --noEmit）：${typecheckOk ? `${STYLE.green}PASS` : `${STYLE.red}FAIL`}${STYLE.reset}（exit ${tsc.status ?? '未执行'}）`)
if (typecheckOut) {
  for (const line of typecheckOut.split(/\r?\n/).slice(0, 20)) console.log(`   ${line}`)
}
console.log(bar)

let reminder = ''
try {
  const agents = readFileSync('AGENTS.md', 'utf8')
  const start = agents.indexOf(START)
  const end = agents.indexOf(END)
  if (start !== -1 && end !== -1) reminder = agents.slice(start, end + END.length)
} catch {
  /* 读不到就当没有提醒，不影响交付 */
}

if (!reminder) {
  console.log('（本次没有交付提醒：AGENTS.md 里那四问已改名或删除）')
  process.exit(0)
}

console.log(`
${STYLE.red}${bar}${STYLE.reset}
${STYLE.bold}${STYLE.red} check 跑完 ≠ 做完。把下面四问的答案写进你给用户的回答里：${STYLE.reset}
${STYLE.red}${bar}${STYLE.reset}
${STYLE.yellow}${reminder}${STYLE.reset}
${STYLE.red}${bar}${STYLE.reset}
`)

/**
 * Agent skill（02 §7）：告诉模型「lovart 作图」怎么开工。
 *
 * 为什么是 skill 而不是只写工具描述：skill 的 description 常驻在技能目录里，
 * 模型在「还没决定调工具」时就能看到；工具描述只有决定调用之后才出现。
 *
 * 正文只写流程与边界，参数细节留给工具 `description` —— 两者不重复。
 */

/** kebab-case，与 DSH 的技能名语法一致。 */
export const LOVART_SKILL_NAME = 'lovart'

/** 常驻文案：决定「要不要用这个插件」。 */
export const LOVART_SKILL_DESCRIPTION = '用 Lovart 出图：提交任务、看队列、取图片路径'

/** 常驻文案：补一句什么时候该想起来它。 */
export const LOVART_SKILL_WHEN_TO_USE =
  '用户说「lovart 作图」，或要画图、改图、拿某张图当参考时'

/** 按需加载的正文。只写流程与红线。 */
export const LOVART_SKILL_BODY = `# Lovart 作图

## 什么时候用

用户说「lovart 作图」，或者要画图、改图、拿某张图当参考时。

## 开工顺序

1. **查任务用 \`job_list\`，它才是唯一可信的计数**。\`lovart_board\` 只反映插件内存里的记录：
   重载 / 重启后记录消失，但上游任务仍在跑 —— 只看板子会把在跑的任务算漏。
   需要提示词、参数、编号时才用 \`lovart_board({ action: 'snapshot' })\`。
   历史图在会话工作目录的 \`lovart/\`，文件名是「时间戳_提示词」；任务记录重启后不保留，图还在。
2. 提示词写具体：主体、风格、光线、构图。比例与尺寸只拼进 prompt 文本，不是接口参数。
3. 提交用 \`lovart_generate\`。\`count\` 是任务数，每个任务一张图；同时提交给上游的数量有上限，
   超出的**自动排队**，不会报错，也不要重试。
4. 用户说「这张先出」时带 \`priority: 'high'\` —— 它只对还在排队（\`waiting\`）的任务有效，
   已经提交给上游的改不了顺序。
5. 提交后**不要轮询、不要 sleep**，去做别的事，等完成通知。

## 并发上限（硬约束）

- 平台侧同时进行的任务**最多 8 个，达到 8 会卡住**，不是排队变慢，是整批一起拖。
- 提交前先用 \`job_list\` 数一遍在跑的任务，加上这次要提交的，**总数不超过 7**（留一个余量）。
- 不要为了让配置生效去重载插件：重载会清空内存任务记录，却**不会**停掉上游任务，
  于是新任务叠加上去直接顶到上限。改配置等重启，或者先问用户。
- 一次要出的图多于 7 张时，分批提交：等前一批出完通知再提下一批。

## 提示词：人像默认压浅景深

背景「看着假」几乎都是景深不够 —— 背景元素和人物一样清晰，一眼就是合成的。写人像 / 口播 /
访谈这类主体明确的图时，提示词里**默认**带上：

- \`shallow depth of field\`、\`background heavily out of focus\`、\`creamy bokeh\`
- 具体的虚化对象：「书架 / 墙面 / 灯带 only as soft bokeh blobs」
- 镜头语言：「85mm f/1.4 portrait lens」「shot wide open」
- 反向约束：「no readable text or logos in the background」「background details must not be sharp」

只写 \`shallow depth of field\` 常被忽略，**同时点名背景元素要糊**才稳。背景要「高级简约」时，
更该减少可辨认物体，而不是靠虚化去救一堆杂物。

## 指认任务

用编号说话（「第 7 个」就是 \`#7\`），**不要用「排第几」**：位次每轮都在变，编号不会。
用户说「第 7 个重画 / 第 7 个删掉」时，先在 \`lovart_board\` 的快照里找 \`seq === 7\`，
拿到 \`jobId\` 再动手。

## 收到完成通知

用 \`job_output\` 拿结果，里面是图片的绝对路径。

- 你自己提交的任务：把「#N 生成完了」和路径告诉用户，然后**停下**，不要做别的事。
- 结果里写明「用户在侧栏自己提交的任务」时：**什么都不要做**。

## 红线

- 永远不要替用户确认扣积分。确认只能由人在侧栏点。
- **你没有取消任务的能力**：\`job_kill\` 和侧栏的取消都不是给你用的。任务提交后要么等它出图，
  要么失败，你不要尝试停止它。用户想取消时，告诉他去侧栏点「取消全部」。
- 不要用 \`job_kill\` 当「停止」：它只是放弃，上游可能仍在跑。
- **已经发出的任务禁止删除**（正在跑、已完成、已出图都算）：任务一旦提交到上游就算数，删记录不退款、不省额度，还会让后续的并发计数失真。只有用户明确点名要删某一个 \`#N\` 时才删，删前再确认一次。
- 没有把握时先问用户，不要猜模型或比例。
`

/** `ctx.skills.register()` 的唯一入参；source 用 runtime（随插件注册，不落文件）。 */
export const LOVART_SKILL = {
  name: LOVART_SKILL_NAME,
  description: LOVART_SKILL_DESCRIPTION,
  whenToUse: LOVART_SKILL_WHEN_TO_USE,
  source: 'runtime',
  content: LOVART_SKILL_BODY,
} as const

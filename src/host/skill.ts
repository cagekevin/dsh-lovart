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

1. 先看台面：\`lovart_board({ action: 'snapshot' })\` 拿本会话的任务 —— 每张带编号 \`seq\`、
   提示词、参数、状态与优先级。历史图在会话工作目录的 \`lovart/\`，文件名是「时间戳_提示词」；
   任务记录重启后不保留，图还在。
2. 提示词写具体：主体、风格、光线、构图。比例与尺寸只拼进 prompt 文本，不是接口参数。
3. 提交用 \`lovart_generate\`。\`count\` 是任务数，每个任务一张图；同时提交给上游的数量有上限，
   超出的**自动排队**，不会报错，也不要重试。
4. 用户说「这张先出」时带 \`priority: 'high'\` —— 它只对还在排队（\`waiting\`）的任务有效，
   已经提交给上游的改不了顺序。
5. 提交后**不要轮询、不要 sleep**，去做别的事，等完成通知。

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
- 不要用 \`job_kill\` 当「停止」：它只是放弃，上游可能仍在跑。
- 删除只对已结束或还在排队的任务；删之前先跟用户确认一次。
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

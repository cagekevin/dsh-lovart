# AGENTS.md

> 适用对象：所有参与 dsh-lovart 的 AI 编码代理（TraeCode、Claude Code、Codex、Cursor 等）。
> 本文件只规定「开工前必须做什么」「绝对不允许什么」「怎么说话、怎么下笔」。
> 具体协议、数据形状、数据流、契约一律以唯一规范为准，本文件不复述。

---

## 0. 唯一规范

**唯一规范：[docs/00-总纲与契约.md](docs/00-总纲与契约.md)。**

- 原语（P1–P5）、`LovartMeta`、phase 表、数据流、上游端点、插件清单、host/client 半边、工具/路由/文件契约，全部以它为准。
- 代码、注释、README 与它冲突时：**改代码，不改规范**；确实要改规范，先让用户拍板，再同步改代码，并在 `docs/CHANGELOG.md` 加一行。
- 规范没写的，先问用户，不许自己发明一套「更好的」写法。
- `docs/plan/01-立项与分期-2026-11-08.md` 是**过程文档**（立项、分期、验收、选型对比），**已冻结，不再维护**；结论只在 00 里。
- `docs/plan/02-*.md` 是**施工图**（已确认、待落地）；落地后并入 00 并删除，不长期维护。
- `docs/adr/` 记录「为什么这样定」，索引由 `node scripts/adr.mjs index --write` 生成，**禁手改索引表**。

### 0.1 开工确认（硬性）

在创建 / 修改 / 删除任何项目文件之前，必须先读：

1. `docs/00-总纲与契约.md`
2. `docs/adr/README.md` 里与本任务相关的 ADR

第一次回复必须有一行确认：

```
已读完 docs/00-总纲与契约.md + docs/adr/README.md；本次最相关条款：§x、§y
```

并附上相关条款的实际内容要点（照原文写，不许凭记忆复述）。

### 0.2 「体检」是什么（用户口令）

用户说「体检」= **按 00 与 ADR 逐条对代码**，找「写的和做的不一样」。顺序固定：

0. **ADR**（`docs/adr/` 全部现行条目）—— 代码是否符合每条判据；新增入口、新写法尤其看 `0001`（半收口）、`0005`（一个能力一个入口）、`0008`（兜底净减）。每条给「符合 / 不符 / 不适用」。
1. **§3 原语**（P1 凭据 / P2 唯一出网口 / P3 信封 / P4 任务元数据 / P5 落盘）
2. **§4 数据形状**（`LovartMeta`、phase 表、上游状态映射、模型表）
3. **§5 数据流**（提交、轮询、确认、下载、侧栏读、队列）
4. **§6 契约**（C1 上游 HTTP、C2 清单、C3 装配、C4 工具、C5 路由、C6 文件）

规则：

- **不是跑测试。** `npm run check` 是另一件事，不许拿「检查全绿」当体检结论。
- **默认不改行为。** 体检只出清单（条款 → 现状 → 偏差 → 处置）；要改代码先等用户点头。
- 纯文档偏差（规范写旧了、目录树漏文件）可以顺手改，并在 `docs/CHANGELOG.md` 记一行。
- 偏差分三类：**代码错**（照规范改代码）/ **规范过时**（照代码改规范）/ **缺一环**（两边都对但少了衔接，补进规范）。
- 每条给文件名，别只说「大概没问题」。

---

## 1. 不可越的边界

| 边界 | 具体规则 |
|---|---|
| **零运行时依赖** | `package.json` 的 `dependencies` 必须为空。只用 Node 内置（`fetch` / `node:crypto` / `node:fs`）与 DSH 平台模块（React、UI primitives、schemastery）。新依赖先进 `devDependencies`，且单个超过 30KB 需用户单独确认。 |
| **唯一出网口** | 所有 HTTP（签名 API 与 CDN 下载）只能经 `src/host/lovart/request.ts`。**仓库里不允许出现第二个 `fetch`**。 |
| **agent 不能花钱** | `pending_confirmation` 只能由侧栏的 `POST /lovart/api/jobs/:id/confirm` 确认。**没有任何 agent 工具能走到这条路径**；`confirmCount >= 1` 再确认必须拒绝；确认失败不重试、不唤醒 `run()`。 |
| **P0 不含前端** | P0 只做 `src/host/**` 与 `test/**`，不写 `src/client/**` 的业务代码，不写侧栏 UI。前端从 P1 开始。 |
| **凭据不缓存** | 每次请求前 `ctx.credentials.resolve(ref)`；未配置就报「未配置 Lovart 凭据」，不静默降级。 |
| **cwd 不猜** | `workingDirectory.ensure` → `sessions.get(id).header.cwd` → 报错。**不许落 `process.cwd()`**。 |
| **不写隐藏状态** | 没有 `state.jsonl`、`.lovart-state.json`、文件锁。`LovartMeta` 只在内存，DSH 重启即丢。 |
| **一个能力一个入口** | 同一能力不允许新旧两个入口、两套写法、两条路由并存。旧的删不掉，就别加新的（ADR-0005）。 |

---

## 2. 技术栈与构建

| 项 | 约定 |
|---|---|
| 运行时 | Node ≥ 22.19（DSH 要求） |
| 语言 | TypeScript 5.x，`strict`；上游响应全是 `unknown`，逐层窄化，禁止 `as any` / `as never` |
| 构建 | **tsdown**（rolldown 内核），产物 `lib/index.js`；P1 再加 `lib/client.js` |
| 测试 | **`node:test`**，测试放 `test/`，只测纯逻辑 |
| 签名 | `node:crypto` 的 `createHmac` |
| HTTP | 全局 `fetch`（只在 `request.ts`） |
| UI（P1） | React 18 平台模块，不打包；`@deepseek-ai/dsh-client-ui-primitives` |
| 样式（P1） | 运行时注入 `<style>`，不引 CSS 框架 |
| 配置 | `@deepseek-ai/schemastery`（DSH 内置） |

- `tsdown.config.ts` 双入口一份配置；client 入口在 P1 开，不进 P0。
- `cordis.patch.yml` 只留 better-sidebar 依赖注释；`dsh.client.inject` 写**包名** `dsh-better-sidebar`，`src/client/index.ts` 的 `inject` 写**服务名** `betterSidebar`，两者不许混。
- `package.json` 的 `dsh` 字段、`engines`、`exports` 以规范 §6 C2 为准。

---

## 3. 分层（规范 §8）

**不写文件清单**：要查有哪些文件直接 `ls`。规范只约束「什么代码放哪一层」。

| 层 | 目录 | 只放什么 | 不许放 |
|---|---|---|---|
| 协议层 | `src/host/lovart/` | 签名、请求、信封、端点、模型、prompt、上游类型 | 生命周期、路由、UI |
| 生命周期层 | `src/host/job/` | phase 表、内存 store、槽位队列、单个 job 的 run、落盘 | 协议细节、HTTP 路由 |
| 装配层 | `src/host/` 根 | apply、配置、错误、DSH 端口、工具、路由 | 业务算法 |
| 侧栏 | `src/client/` | tab、面板、调路由、媒体地址、样式 | 直连上游、拿凭据 |
| 测试 | `test/` | 每个已实现模块一个 `*.test.ts` | 占位测试、渲染测试 |

- `src/client/media.ts` 是唯一允许封装 better-sidebar `hostRouteUrl` 的文件，换侧栏只改它。
- 不新增顶层目录；新文件先回答「属于哪一层」，答不出就是分层没想清。

---

## 4. 实现规则

### 4.1 host 装配

`src/host/index.ts` 只做五件事，注册类各套 `ctx.effect`：

1. 建 `Map<JobId, LovartMeta>` 与一份全局 `SlotQueue`（都是值，不需要 dispose）；
2. 注册 `lovart_generate` 与 `lovart_board` 两条工具；
3. 注册 `lovart` skill；
4. `ctx.get('webServer')` 非空才注册 `/lovart/api` 路由；
5. 不写 sweeper —— 每个 job 在自己的 `run()` 里推进。

不写第二个装配点：baseUrl / 凭据解析 / 服务探测都只在这里接一次。

`inject` 只声明 `tools` / `credentials` / `jobs` / `sessions` 四个必需服务；`webServer` / `workingDirectory` 走运行时探测，缺失时降级为纯 agent 模式（注册工具、不注册路由），这是可接受降级，不是静默失败。

### 4.2 协议

- 签名串 = `${METHOD}\n${path}\n${timestamp}`，HMAC-SHA256 取 hex；`X-Timestamp` 每次请求重算。
- 响应先解 `{code, data}` 信封：`code !== 0` 抛 `UpstreamError`（严格 `=== 0`，字符串 `"0"` 也算错）；非 2xx 也先解信封再看 HTTP 码。
- `ratio` / `size` 只进 prompt 文本，不是 API 参数。
- `pending_confirmation` 是**对象**，判定用真值检查，不许用 `=== true`。
- `tool_config` 只在模型有工具名时下发。
- 只有一条工具 `lovart_generate`，立即返回 jobId，不等图。等、查、停用 DSH 的 `job_output` / `job_list` / `job_kill`，不另造工具。
- 路由错误一律 `{error: string}` + 非 2xx，**不返回堆栈**。

### 4.3 落盘

- 目录 `<sessionCwd>/lovart/`，命名 `20261108-121530_一只戴帽子的猫.png`。
- 同名不同内容加 `-2`、`-3`，**不覆盖**。
- 扩展名按 `Content-Type`，兜底 `.png`。

### 4.4 注释

全中文，只解释「为什么」和「不这样写会错」，不复述代码。位置固定三处：

| 位置 | 写什么 |
|---|---|
| 文件头 | 是什么、唯一入口、谁在用、禁止什么 |
| 导出符号 | `/** 一句话语义 */` 紧贴 `export` |
| 函数内 | 隐含前提、上游版本坑、契约出处（如 `规范 §6 C1`） |

禁止：注释掉的代码、`TODO` / `FIXME` / `XXX` / `HACK`、复述代码、装饰分隔线、署名与日期、变更叙事。

---

## 4.5 P0 跨层约定（开工前定死）

这六条按 ADR-0009 落；下面是本项目的具体形状，能写不出来的都已经在类型/入口里。

**错误。** `LovartError` 构造函数 `private`，只能走 `LovartError.invalidInput / upstream / ...` 静态工厂；对外只有 `respond(error): ErrorResponse` 一个出口。新增错误码不补 `statusOf` 的 `switch`，`assertNever` 直接编译不过。状态码固定：`INVALID_INPUT` 400、`CREDENTIALS_MISSING` 409、`UPSTREAM` 502、`CONFLICT` 409、`NOT_FOUND` 404、`CWD_UNKNOWN` / `INTERNAL` 500；未知异常 500 + 「内部错误」。

**出网。** `createLovartClient` 用闭包持有 baseUrl / 凭据 / 超时，只返回 `signedGet` / `signedPost`；调用方拿不到 url、凭据或 timeout 参数，也没有重试参数。POST（含 chat / confirm）失败只报错，绝不重发；GET 的再次尝试由 `run()` 下一轮轮询完成。全局 `fetch` 在 TS 层禁不掉，所以目标是让第二处没必要存在：新增端点只动 `api.ts`。

**状态。** `createStore<T>()` 只导出工厂，不导出实例；实例在 `apply` 内创建，经闭包传给 tool / route / run。没有模块级可变容器，也没有 `globalThis` 单例可抄。

**可选服务。** `resolveWebServer(ctx)` 返回 `WebServerPort | undefined`；`registerRoutes(server: WebServerPort)` 只收非可空值，所以写不出「先注册、再判空」。`workingDirectory` 同样走一个返回 `undefined` 的解析函数；缺 `webServer` 不注册路由，缺 `workingDirectory` 走 sessions header。

**上游窄化。** `parseUpstreamStatus(unknown): UpstreamStatus` 是唯一解析入口，返回判别联合；`phaseFor` 用穷尽 `switch` + `assertNever`，新增上游状态不补 case 就编译不过。未识别状态在解析时抛 `LovartError.upstream`，**不兜底成 `generating`**。

**结果文本。** `formatOutcome(outcome: TerminalOutcome, submittedBy: 'agent' | 'user')` 只接受 `done` / `failed` / `cancelled` 三种终态，调用方写不出「临时拼一句」。`job_output` 与 `detail` 都调它，且只发一次，**不写进 `job.append()`**（那是输出环）。`submittedBy === 'user'`（侧栏提交）时末尾多一句「你不需要做任何事」——通知是 DSH 发的，改不了，只能让模型读到结果就知道该停。

### 4.6 配置、日志、清理、命名（第二批，按 ADR-0009 标级别）

每条标了落点级别；标 ③ 的都写明为什么结构上做不到。

- **配置（①类型 + ②范本）。** 默认值只在 `config.ts` 的 schema 里；`Config` 字段全部必填，`apply` 之后拿到的就是解析结果，下游只收具体 `string` / `number`，没有「再补一次默认」的位置。范本：`config.ts`。
- **日志（③：`console` 是全局对象，TS 禁不掉）。** 只走 `ctx.logger.warn/error`；业务函数收窄成只拿 `logger` 端口，让写日志的第二处没有必要存在。不引日志库、不加 debug 开关；进度写 `job.updateProgress`；日志不出现 access key / secret。范本：`index.ts`。
- **清理（③：`ctx.effect` 是普通调用，不调也能编译过）。** 所有注册都套 `ctx.effect`；`Map` 由 `apply` 持有，不需要额外 dispose；没有第二种清理入口。范本：`index.ts`。
- **命名与导出（①路径别名 + ②范本）。** `tsconfig` 不配 `paths`，别名导入构建时直接失败；入口只有 `src/host/index.ts`（P1 加 `src/client/index.ts`）；文件 lower-kebab-case、只具名导出、相对导入带 `.ts`。范本：`src/host/**`。
- **常量（②范本）。** 只放唯一消费模块：阶段在 `job/phase.ts` 的 `PHASE_TABLE`，模型在 `lovart/models.ts`；仓库里没有 `constants.ts` 可抄。
- **测试（②范本）。** 只测已实现模块，不写占位 `test.skip`；实现哪个模块，同批补 `test/<module>.test.ts`。范本：`test/phase.test.ts`。
- **ADR 时机（③：这是判断，不是类型能表达的）。** 写 ADR 需同时满足 §6.1 三条；`adr.mjs` 的模板只强制「违反时的判据」必填，不判断该不该写。

**生命周期四问。** 每个 flag / promise / resolver / 计数只回答四件事：谁写、谁读、代表哪个 transition、终态后还能不能动。`unblockConfirm`、`confirmCount`、`phase` 都必须能对上；终态（`done` / `failed` / `cancelled`）之后不允许再改 Map、再回调、再发请求。

---

## 5. 测试与检查

- **只建 `test/*.test.ts`**，用 `node:test` + `node:assert/strict`。不给页面、组件、hook 写渲染测试。
- UI 里出现值得测的算法，迁到 host 侧纯函数再测，不给 TSX 加测试。
- **`test/` 只放已实现模块的测试，不写占位 `test.skip`。** 实现哪个模块，同批补 `test/<module>.test.ts`；没有「先建空测试再补」这一步。范本：`test/phase.test.ts`。
- 开发中只跑相关单测；交付前必须全跑。

```bash
npm run typecheck     # 写代码时用：tsc --noEmit
npm run check         # 写完代码跑一次：test → build → 四问回执
npm run test          # 只跑单测（node --test）
npm run build         # 只出产物（tsdown → lib/）
```

**两个阶段，别混。**

| 阶段 | 跑什么 | 说明 |
|---|---|---|
| 写代码时 | `npm run typecheck` | 每改一批扫一眼类型对不对，**不是交付闸** |
| 写完代码 | `npm run check` | `npm test` → `npm run build` → `post-check.mjs`，各跑**一次** |

`npm run check` 里没有 typecheck（那是写码时的事），也没有 ADR / 债务 / 架构索引。它最后一步 `post-check.mjs` 只复述 `tsc` 真实退出码并打印四问原文，不判对错、恒 `exit 0`。

ADR / 债务 / 架构索引同样是独立命令（`npm run adr` / `npm run debt` / `npm run arch`），与代码检查无关，改代码时不必跑。

### 5.1 机器闸判据（硬性）

**只保留官方命令**（`tsc --noEmit` / `tsdown` / `node --test`）；**不新建扫描式机器闸**（ADR-0009）。扫描本身不禁止 —— 禁止的是「靠扫描判代码对错、并据此报错或阻断」。新增扫描脚本前过四问，任一不过就不建：

1. **出事实还是出判决？** 只输出客观事实与线索（真实退出码、谁 import 谁、残留引用在哪、计数与位置）供人／AI 参考 ⇒ 可建；输出「合规／不合规」并要求 AI 照做 ⇒ 不建。
2. **会不会阻断？** 自身恒 `exit 0`、不参与 `typecheck` / `test` / `build` 的通过判定、不接提交钩子 ⇒ 可留；非零退出、拦提交、写进 AGENTS 当「AI 不这样写就报错」⇒ 不建。
3. **能不能绕过去？** 靠正则查「某处不许出现 X」，AI 换个文件写同样实现就能绕过 —— 这是**反向闸**，比没有更糟，不建。真要禁止，按 ADR-0004/0009 让第二处没必要存在，或让写错编译不过。
4. **维护成本算不算得过来？** 每条规则都要配一套解析器与豁免名单，最终变成第二本账；算不过「误报 + 绕行 + 维护」就不建。

---

## 6. ADR 与债务

### 6.1 ADR

- 约定怎么落，按 ADR-0009；AGENTS 只引用，不复述阶梯。
- **写 ADR 需同时满足**：用户裁定或推翻既有结论；类型 / 结构 / 测试都拦不住；不写会让下一个 AI 长出第二套。
- **ADR 正文不可改写**：被取代只改状态，理由迁到新 ADR；禁止把旧结论改成新结论，留下两套都像现行的文本。
- 外部仓库 / 技能的结论先按当前代码复验，标「采用 / 改造后借鉴 / 不借鉴」，不直接搬。
- 新增、改状态、改索引一律走脚本，**禁手写 `README.md` 的索引表**：

```bash
node scripts/adr.mjs list --all
node scripts/adr.mjs add --title "…" --conclusion "…" --user-approved
node scripts/adr.mjs status 0009 --to 已取代 --by 0010 --note "…"
node scripts/adr.mjs index --write
node scripts/adr.mjs audit
```

### 6.2 债务

- 碰到既有代码违反 ADR 或规范：**先登记债，继续手上的活**，不许顺手改、不许只在回答里提一句。
- 唯一账本 `daily/架构日志/债务.md`，唯一写入口 `scripts/debt.mjs`；**禁手写表格行**。
- 摘要 ≤120 字，禁裸 `|`，引号用「」。
- **审计可以结论「无债」**，不许为凑数登记假债。
- **重大删除 / 合并**先在区域日志写四行：位置 / 消费者 / 删除后失去什么 / 最小证伪检查。不建 proof-record JSON、覆盖率地图或可视化报告；证据沿用 ADR-0001 六项 + 债务摘要。
- 区号：

| 区号 | 区域 |
|---|---|
| 01 | host/lovart 协议与出网 |
| 02 | host/job 任务生命周期 |
| 03 | host 装配 / 工具 / 路由 |
| 04 | client 侧栏（P1） |
| 05 | test 测试与验收 |
| 06 | 构建与发布配置 |
| 07 | 文档与治理 |

```bash
node scripts/debt.mjs add --area 01 --summary "…" --class 增债 --rate 中
node scripts/debt.mjs list
node scripts/debt.mjs show TD-01-1
node scripts/debt.mjs resolve TD-01-1 --note "销账证据"
node scripts/debt.mjs audit
```

回答里只给债号（`TD-<区号>-<序号>`），不复述全文。

---

## 7. 沟通

1. 第一行给动作方案：下一步做什么、改哪里、什么结论；不写「让我看看 / 好的 / 我来分析」。
2. 多步任务编号 `1. 2. 3.`，每步一个动作；用任务列表维护进度，同时只有一个 in-progress。
3. 每轮汇报先说「第 N/M 步完成」。
4. 结尾给一个 ≤2 分钟能做的下一步，不写「还需要我做什么吗」「希望有帮助」。
5. 具体到文件、命令、数字：说「改 3 处 / 约 15 分钟」，不说「一会儿 / 一些工作」。
6. 报错就事论事：原因 + 修法，不写「哎呀 / 似乎有问题」。

---

## 8. 交付前（硬性）

**绿 ≠ 对。** `npm run check` 全绿只证明「没踩坏现有检查」，证明不了「没多造第二条路」。
每次回答用户时，必须把下面四问的答案写进回答里，答不出或答成「应该没有」按未完成处理：

1. 这轮动了哪个入口？**旧入口还在吗**？
2. 旧入口如果还在，它的消费者**全部**迁完了吗？没迁完 = 两条线 = **未完成**。
3. 同一能力数出几个入口？同前缀并存（`Xxx` 与 `XxxOr`）或旧入口仍被调用 ⇒ **两条线**。
4. **这段代码，下一个 AI 看得懂吗**？看不懂且没有唯一范本可照抄 ⇒ 不许交付。出现两条线 ⇒ 不许写「已完成 / 已修复 / 已收口」，回去删掉其中一条；读不懂或职责搅乱 ⇒ 按 ADR-0006 把逻辑归到一处再交。

另外按 ADR-0001 逐项给证据：同一能力只剩一个可抄样本、旧签名/旧调用点归零、新模块已进目录树、文档边界有结构或唯一范本约束、每条结论先红过、范围外发现另开债。

**执行纪律（借用 simplify-codebase，压成 5 条）：**

1. 改前先跑 `npm run check` 记基线（`typecheck` 边写边跑）；基线红，先说明哪条是既有失败，不许混进本轮。
2. 一次只改一个所有权边界；删工具 / 路由 / 导出面属于产品决定，先问用户。
3. 结构改动给 undo 路径：改了哪些文件、怎么回退。
4. 检查失败不许放宽检查或删断言；先判断是基线问题、实现不完整，还是候选本身承重。
5. 每道检查分开报；单测绿不等于 build / runtime 绿。不 commit / push 除非明确要求，不碰无关工作区改动。

改了 `src/host/lovart/`、`src/host/job/` 或契约 → 同步规范与受影响的 ADR；范围外的问题只登记债，不在本轮顺手改。

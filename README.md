# dsh-lovart

> **P1 侧栏依赖 `dsh-better-sidebar`。** 未安装时侧栏 tab 不加载；P0 的 agent 工具不受影响。

一个 DSH 插件：把 Lovart 免费排队出图接进侧栏和 agent。

```
agent 说一句话  ──┐
                  ├──→ 同一个任务表 ──→ Lovart ──→ 图落进会话工作区
侧边栏点一下    ──┘
```

## 安装

要求：DSH `0.2.1-rc.1` 及以上，且 profile 里装有 `dsh-better-sidebar`（侧栏 tab 依赖；未装时只有 agent 工具可用）。

```bash
# 从 npm（发布后）
dsh plugin --profile <profile> add dsh-lovart

# 从本地 tarball（npm pack 产物，路径按调用者 cwd 解析）
dsh plugin --profile <profile> add ./dsh-lovart-0.1.0.tgz
```

装完重启 DSH。安装命令会自动把 `dsh-lovart` 写进 profile 的 `dsh.profile.bundles`，
重启后侧栏出现「Lovart」tab，agent 侧获得 `lovart_generate` 工具。

### 本机有多个 pnpm 时

profile 的 `node_modules` 只由**安装它时那个大版本**的 pnpm 管理；版本不一致会报
`ERR_PNPM_UNEXPECTED_STORE`（例如 profile 是 pnpm 11 装的，PATH 上却是 10）。先读出该版本：

```bash
grep -o '"packageManager": "pnpm@[^"]*"' ~/.dsh/profiles/<profile>/node_modules/.modules.yaml
```

然后用**同一版本 pnpm 的绝对路径**，不要依赖 PATH：

- 在 DSH 界面里点安装：在 `~/.dsh/profiles/<profile>/cordis.patch.yml` 指定一次即可（重启 App 生效）：

  ```yaml
  - id: plugin-manager
    config:
      pnpmCommand: /绝对路径/pnpm/bin/pnpm.mjs
  ```

- 在终端安装：直接用同一个可执行文件（`.mjs` 有 shebang；`.cjs` 是壳，不能直接执行）：

  ```bash
  /绝对路径/pnpm/bin/pnpm.mjs --dir ~/.dsh/profiles/<profile> add ./dsh-lovart-0.1.0.tgz
  ```

  裸 pnpm 不会走 DSH 的兼容性检查与自动启用，装完需手动把 `dsh-lovart` 加进 profile
  `package.json` 的 `dsh.profile.bundles`，再重启。

## 当前状态

**P0 / P1 / P2 均已实现。**

- host：签名、唯一出网口、上游轮询、落盘、`lovart_generate` + `lovart_board`、`/lovart/api` 十条路由（含 `/refs` 垫图、`/options`、`/credentials`、`DELETE /jobs/:id`、`POST /jobs/:id/cancel`）。
- client：侧栏 tab（图墙 / 提交 / 垫图 / 参数下拉 / 重跑 / 确认 / 灯箱 / 复制图片 / 每张任务的三点菜单：复制提示词、删除任务），样式运行时注入，媒体地址只经 `client/media.ts`。
- 凭据：未配置时侧栏直接填两个 key，写进 DSH 凭据库（`LOVART_ACCESS_KEY` / `LOVART_SECRET_KEY`）；插件不落盘、不缓存。也可用同名环境变量提供。
- `test/*.test.ts` 覆盖全部纯逻辑模块；`npm run check` 绿才算交付候选。

## 已知损失

- **DSH 重启后任务丢失**。已落盘的图还在。
- **排队模式可能要等 30 分钟以上**。这是免费的代价，不是 bug。

## 命令

```bash
npm install
npm run typecheck   # 写代码时用：tsc --noEmit
npm run check       # 写完代码跑一次：test → build → 四问回执
npm run build       # 只出产物：tsdown → lib/index.js + lib/client.js
npm test            # 只跑单测：node:test
npm run adr         # ADR 体检（独立命令，不进 check）
npm run debt        # 债务体检（独立命令，不进 check）
npm pack            # 打分发用 tarball（只含 files 白名单）
```

## 文档

- 唯一规范：[docs/00-总纲与契约.md](docs/00-总纲与契约.md)（变更记录：[CHANGELOG.md](docs/CHANGELOG.md)）
- 立项与分期（过程文档）：[docs/plan/01-立项与分期-2026-11-08.md](docs/plan/01-立项与分期-2026-11-08.md)
- 工程约束与交付规则：[AGENTS.md](AGENTS.md)
- 架构判据索引：[docs/adr/README.md](docs/adr/README.md)

## 目录

```
src/host/
  index.ts        apply 唯一入口
  config.ts       schemastery 配置
  lovart/         签名、唯一出网口、七个端点、模型、prompt、上游类型
  job/            phase 表、内存 store、run、落盘
  tools.ts        lovart_generate（唯一工具）
  route.ts        /lovart/api
src/client/       侧栏 tab、api、media、styles
test/             node:test
scripts/          ADR / 债务 / 架构索引等治理脚本（不扫描代码）
daily/架构日志/    区域日志与债务账本
```

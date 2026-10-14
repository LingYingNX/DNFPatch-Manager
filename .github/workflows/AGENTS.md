<!-- Managed by agent: keep sections and order; edit content, not structure. Last updated: 2026-09-27 -->

# AGENTS.md — .github/workflows

## Overview

三条流水线：`release.yml`（推送 `v*` 标签时构建并发布 GitHub Release）、`harness-verify.yml`（master 的 push/PR 上校验 AGENTS.md harness 一致性）、`no-duplicate-helpers.yml`（master 的 push/PR 上拒绝重复的路径/状态辅助实现）。

## Key Files

| 文件 | 作用 |
|------|------|
| `release.yml` | windows-latest 上校验 tag 与版本一致，安装 Electron 二进制后 `pnpm run release`，发布后校验 `releases/latest` 指向新标签 |
| `harness-verify.yml` | ubuntu-latest 上运行 `bash scripts/verify-harness.sh` |
| `no-duplicate-helpers.yml` | ubuntu-latest 上运行 `node scripts/check-path-helpers.mjs`，与 `.githooks/pre-commit` 同源 |

## Workflow files

- 发布必须保留 `pnpm exec install-electron` 步骤；`pnpm install --frozen-lockfile` 不保证存在 `node_modules/electron/dist`。
- 发布前保证 `package.json` version、`APP_VERSION`、Git 标签 `vX.Y.Z` 四者一致。
- 同一版本重打包不会触发已有安装的自动更新；修复更新必须递增版本号。
- 发布后必须校验 `releases/latest` 指向新标签：`electron-updater` 稳定通道只查该接口，指针未迁移时客户端检测不到更新。「Verify latest release pointer」步骤负责此项——electron-builder 留下草稿时输出 warning 并放行（草稿需人工补更新说明后发布），已发布但指针未迁移（重试 30 秒）则失败并给出修复命令。该步骤必须带 `GH_TOKEN` 环境变量，否则 runner 上 `gh` 未认证、查询返回空。改动发布流程时不得删除该步骤。
- 该步骤的发布时序必须按「先等 Release 出现、再比对指针」实现：electron-builder 上传资产时才创建 Release（常晚于构建日志），且创建后是**草稿**状态——草稿不出现在 `releases/latest`。早期版本用 `gh api ... 2>$null` 把查询失败吞成空串，空串既不等于 `"true"`（草稿检测失效）也不等于期望标签，于是 v1.2.3、v1.2.5 都把"还没发布完"误报成"指针没迁移"而失败。现在查询失败保留错误输出并显式判定，不得再退回 `2>$null` 写法。
- `package.json` 的 `build.releaseType` 必须保持 `"release"`：electron-builder 缺省 `draft` 会让 release 永不 publish，上传大资产时还可能并发创建两个草稿（exe+latest.yml 一个、blockmap 一个），指针校验必超时标红（v1.2.9、v1.3.0 连续中招，见 `.learnings/ERRORS.md` ERR-20261014-003）。verify 步骤中的草稿分支仅作配置回退时的兜底指引。

## Build & tests

本地等价校验：

```powershell
bash scripts/verify-harness.sh
pnpm typecheck
pnpm test
```

本机 PowerShell 的 `PATH` 可能没有 `bash`；运行 `scripts/verify-harness.sh` 时显式使用 `C:\Program Files\Git\bin\bash.exe`，或先把 `C:\Program Files\Git\bin` 加入 `PATH`。

## Code style & conventions

- 权限最小化：默认 `contents: read`，仅发布任务使用 `contents: write`。
- 步骤名用祈使句，job id 用 kebab-case。
- 不引入 `secrets: inherit`。

## Security & safety

- 不在日志中输出令牌或密钥。
- 发布凭据只通过 GitHub Secrets 注入。

## PR/commit checklist

- [ ] 流水线 YAML 语法有效
- [ ] 版本校验步骤保留
- [ ] 权限块未被放宽

## Patterns to Follow

> 对齐现有 `release.yml` 的 pnpm/Node 版本与缓存配置，不要另起一套。

## When stuck

- 参考 GitHub Actions 文档与仓库内现有工作流。
- harness 失败时先本地跑 `bash scripts/verify-harness.sh` 复现。

## House Rules (project-specific)

- `harness-verify.yml` 只校验文档 harness，不要往里塞构建逻辑。
- 新增工作流或改动现有 workflow 后，同步更新本文件的 Overview 与 Key Files。`verify-harness.sh --level=3` 的 drift 检查会识别「被改动目录下（或其祖先）的 scoped AGENTS.md」已更新，但它只判断**有没有动文档**，不判断**改得对不对**——所以同步仍需人工完成。
- 重复辅助守卫（`no-duplicate-helpers.yml`）的规则与例外定义在 `scripts/check-path-helpers.mjs`；调整允许清单时同步更新其回归测试 `tests/unit/check-path-helpers.test.ts` 与 `src/AGENTS.md` 的对照表。

<!-- FOR AI AGENTS - Human readability is a side effect, not a goal -->
<!-- Managed by agent: keep sections and order; edit content, not structure -->
<!-- Last updated: 2026-10-10 | Last verified: 2026-10-10 -->

# AGENTS.md

> 本文件面向 AI 代理/维护者，不是给人类用户看的用户手册。人类文档见 `docs/`。

**Precedence:** the closest `AGENTS.md` wins; root only holds global defaults. Explicit user prompts override these files.

## 项目概览

DNF 补丁管理器（`dnf-patch-manager-rewrite`）是一个 Windows 桌面 Electron + React + TypeScript 应用，用于管理用户本地 DNF 补丁库（`.npk` 图像/音效与 `.bk2` 视频补丁）。只管理用户已有文件；不做在线下载、社区分发或游戏逻辑修改。

| 项 | 值 |
|----|----|
| 类型 | Electron + React + TypeScript 桌面应用 |
| 包管理器 | pnpm 11.5.2 |
| Node | >= 24 |
| 构建 | electron-vite，产物输出 `out/` |
| 打包 | electron-builder，产物 `dist/`（NSIS 安装包 x64；portable 可选） |
| 测试 | vitest + @testing-library + playwright |
| 代码检查 | biome + tsc |
| CI | GitHub Actions（推送 `v*` 标签时发布） |

## Commands

```powershell
pnpm install --frozen-lockfile   # 安装依赖（锁文件）
pnpm dev                         # 开发（electron-vite dev）
pnpm build                       # 构建 out/
pnpm start                       # 预览构建产物
pnpm typecheck                   # tsc --noEmit
pnpm lint                        # biome check .
pnpm format                      # biome format --write .
pnpm test                        # vitest run
pnpm test:unit                   # vitest run tests/unit
pnpm test:integration            # vitest run --config vitest.integration.config.ts
pnpm test:e2e                    # pnpm build && playwright test
pnpm dist:portable               # 打包 portable 可执行文件
pnpm dist:installer              # 打包 NSIS 安装包（可选安装路径）
pnpm exec install-electron       # 发布/打包前准备 Electron 二进制
pnpm release                     # 构建并发布 GitHub Release（需要 GH_TOKEN）
pnpm verify:portable             # 校验 portable 产物
pnpm verify:packaged             # 校验打包产物
pnpm verify:nsis                 # 校验 NSIS 安装/更新/卸载保留用户数据
pnpm verify:no-dup-helpers       # 拒绝重复的路径/状态辅助实现
pnpm doctor                      # react-doctor 诊断
```

日常启动：直接双击 `启动DNF补丁管理器.bat`；启动器自动对比 `src/`、`package.json`、`electron.vite.config.ts` 与 `out/` 产物的修改时间，源码较新时先执行 `pnpm build` 再启动，因此双击启动总能看到最新源码改动。`--check` 只检查并按需构建不启动，`--repair` 强制重建。仓库 Bash 脚本（如 `pnpm verify:nsis`、`scripts/verify-harness.sh`、`scripts/verify-nsis-preservation.sh`）需显式用 Git Bash（`C:\Program Files\Git\bin\bash.exe`）运行，或在 `PATH` 中临时加入 `C:\Program Files\Git\bin`。

## 目录结构

| 目录 | 职责 |
|------|------|
| `src/main` | Electron 主进程、窗口、`ipc/`、资源协议 |
| `src/preload` | 预加载桥接 |
| `src/renderer` | React UI（`components/`、`styles/`、`workspace/`） |
| `src/shared` | 主进程/渲染进程共享类型 |
| `src/core` | 业务逻辑，按域拆分 |
| `src/core/application` | 跨域用例编排（分类删除、库生命周期） |
| `src/core/assets` | 受管图片资源 |
| `src/core/filesystem` | 文件事务、hash、路径存在性 |
| `src/core/install` | 安装/启用/禁用/迁移/边界 |
| `src/core/library` | 扫描、导入、分类、移动、预览 |
| `src/core/paths` | 库路径解析与相对路径归一化 |
| `src/core/previews` | 补丁/组预览绑定与状态 |
| `src/core/recycle` | 回收站清单与恢复 |
| `src/core/state` | 原子 JSON 存储与 schema |
| `src/core/groups` | 虚拟分组与迁移 |
| `src/core/presets` | 预设 |
| `src/core/appearance` · `src/core/wallpapers` | 外观设置与壁纸 |
| `src/core/concurrency` | async-mutex |
| `tests/` | 单元/集成/端到端测试 |
| `docs/` | 用户手册、项目记忆、ADR、规划/规格、审计 |
| `scripts/` | 产物校验等打包脚本 |

## 工作约定（Global Working Agreements）

### 环境（不能靠推断）

- Shell 是 **Windows PowerShell**。`2>/dev/null`、`head`、`grep`、`sed`、`ls -la` 不适用；改用 `2>$null` / `-ErrorAction SilentlyContinue`、`Select-Object -First N`、`Select-String`、`Get-ChildItem`。
- 路径含中文和空格，始终使用 `-LiteralPath`；控制台/文件 I/O 保持 UTF-8。
- Approval 为 `never`，sandbox 为 `danger-full-access`；以自身判断为唯一护栏。

### 硬性规则

- 不在指定目标之外递归删除或移动；先解析绝对路径。
- **`git push` 必须获得用户当次明确批准**：批准"构建 / 发布 / 替换 Release 资产"不等于批准推送；推送其他会话或他人产生的提交，更要单独说明并获准。`git push --force` 与改写远程历史任何情况下都需要单独批准。
- 不 `git reset --hard`、不未经要求改写远程历史。
- 不改 lockfile、不未经要求升级大版本依赖。
- 不弱化、跳过或删除测试来让它通过。
- 未实际运行通过并展示输出前，不得声称检查通过。
- 未证实项与剩余风险要如实披露；隐瞒即失职。

### Git 与发布

- 默认在 `master` 分支开发和发布；临时分支只在确有隔离需求时创建，清理分支前先列出并得到明确请求。
- 推送边界（与硬性规则同源）：`git push` 前必须本轮用户明确说过"推送 / push"；说"构建""发布""更新 Release 资产"时只做本地构建与资产替换，完成后报告并等用户决定是否推送。多会话并行时，其他会话的提交一律不代推。
- 源码仓库与发布物分离：提交 `src/`、配置、测试和必要脚本；不提交 `node_modules/`、`out/`、`dist/`、`data/`、用户补丁库、日志或本地 `.learnings/`。安装包、`latest.yml`、`.blockmap` 只上传到 GitHub Release。
- 只上传源码时不要顺手改写 `README.md` 或其它说明文件；发布附件不是源码文件。
- 发布前保持 `package.json` 的 `version`、`src/shared/contracts.ts` 的 `APP_VERSION` 与 `APP_RELEASE_NOTES`（应用内更新提示读它）、`src/renderer/components/WindowTitleBar.tsx` 与 `WorkspaceApp.tsx` 中 `?? "<version>"` 的两处兜底字面量、`tests/unit/smoke.test.ts` 的版本断言、`scripts/verify-nsis-preservation.sh` 里的新旧安装包文件名、Git 标签 `vX.Y.Z` 和 Release 中的 `latest.yml` 全部一致——它们是同一个版本的唯一定义点，漏改任一处的后果是标题栏、更新提示或校验脚本读到旧版本。同一版本的重打包不会触发现有安装的自动更新，修复更新必须递增版本号。
- `pnpm install --frozen-lockfile` 不保证存在 `node_modules/electron/dist`；执行 `pnpm dist:installer` 或 `pnpm release` 前，发布环境必须先运行 `pnpm exec install-electron`。GitHub Actions 的发布流程也必须保留这一步。
- `electron-updater` 从 GitHub Release 的安装包和 `latest.yml` 获取更新，不读取仓库源码；NSIS 更新安装目录必须沿用当前运行程序目录。
- 发布（含草稿转正式）后必须确认 GitHub `releases/latest` 接口指向新标签——`electron-updater` 稳定通道只查这个接口，Latest 指针留在旧版本时客户端检测不到更新且无报错。用 API `PATCH /releases/<id>` 发布时必须显式传 `-F make_latest=true`（缺省不自动迁移；与 `draft=false` 合并在同一次 PATCH 里时可能不生效，指针未迁移就单独再发一次 `-F make_latest=true`）；electron-builder 上传 `.exe` 与 `.blockmap` 可能并发创建两个草稿，需删除残缺草稿再发布。`release.yml` 的「Verify latest release pointer」步骤已机器校验此项，手动发布时用 `gh api repos/<owner>/<repo>/releases/latest --jq .tag_name` 核对。
- 自动更新只能用已安装的 NSIS 版本验证；源码目录的 `启动DNF补丁管理器.bat` 属于开发模式，不代表真实更新链路可用。更新日志默认来自 `src/shared/contracts.ts`，检测到新版本后才替换为 GitHub Release 说明。`pnpm dist:installer` 用于验证 NSIS 安装器（包括可选安装路径）；`pnpm verify:portable` 与 `pnpm verify:packaged` 当前只覆盖 portable 产物，不能据此声称 NSIS 安装路径已验证。
- 安装目录内的 `patch-categories`（补丁库）与 `data`（配置）是用户数据，NSIS 更新与卸载必须保留。由 `build/installer-custom.nsh` 实现：`customInit` 在应用内更新时清除注册表 `UninstallString`，使更新跳过卸载步骤、直接覆盖安装（≤1.2.4 的旧卸载器无白名单、会整目录清空，绝不能让它运行，因此无需任何抢搬）；`customRemoveFiles` 在手动卸载时按白名单只删应用文件，经 `package.json` 的 `build.nsis.include` 挂载。改动打包配置或该脚本后，必须运行 `pnpm verify:nsis` 模拟安装→更新→卸载全链路验证用户数据保留。
- 官网（GitHub Pages `https://lingyingnx.github.io/DNFguanliqi/`）以 `gh-pages` 孤儿分支为唯一事实源，`index.html` 与 `assets/` 放**分支根目录**（Pages 源路径为 `/`，放子目录会让根 URL 404，见 `.learnings/ERRORS.md` ERR-20260921-001）。更新流程：改本地 `website/` 工作副本 → `git switch gh-pages` → 同步文件到分支根 → commit + push → Pages 自动重建（约 1–2 分钟）。`website/` 已列入 `.gitignore`，**不得进入 master**：它是本地工作副本而非部署源，`gh-pages` 是孤儿分支（与 master 无共同祖先），合并进 master 会删掉整棵源码树。发新版时同步改页面里的版本号文案与 GitHub 下载链接文件名（`/releases/latest/download/<artifactName>` 写死文件名，产物改名即断链）。

**CI 会拦截的提交**（本地跑 `bash scripts/verify-harness.sh --level=3` 可复现）：触及 `package.json`、`.github/workflows/*` 或 `scripts/*` 时必须同时更新根 `AGENTS.md`——作用域按目录前缀匹配，改 `scripts/` 时更新 `src/AGENTS.md` 不算数；`.github/pull_request_template.md` 必须存在。两者都会让 harness 以退出码 2 失败（drift 检查是 warning，但 warning 同样退出码 2）。pre-commit 以 `--level=3 --staged` 跑同一套检查，drift 在提交前即被拦下；`--staged` 查暂存区而非上一个提交，因为 pre-commit 阶段 `HEAD~1..HEAD` 仍指向旧提交、查它拦不住本次改动。Latest 指针校验（`release.yml`）先等 Release 出现（草稿则 warning 放行）再比对指针；查询失败不得吞成空串，否则会同时绕过草稿检测与标签比对，把"还没发布完"误报成"指针没迁移"。

### 工作范围

- 只改任务点名的部分，不做顺手重构或重排。
- OpenSpec：根目录存在 `openspec/` 时，先运行 `openspec list --json` 和 `openspec list --specs --json`；有未完成 tasks 的 change 用 `openspec-apply-change` 继续，全部完成则提示归档。
- 发明新模式前，先读树内不少于 2 个相似模块再对齐。
- 复用已有辅助；仅当没有现成覆盖时才新增依赖。
- **写路径/状态辅助前先查 `src/AGENTS.md` 的「禁止重复造路径/状态辅助」表**：路径比较、`.npk` 判断、`..` 穿越校验、ENOENT 捕获、状态读取回退都已有唯一共享实现，不得再写本地副本或内联等价表达式。该约束由 `scripts/check-path-helpers.mjs` 机器强制（pre-commit 与 CI 双端拦截，本地可跑 `pnpm verify:no-dup-helpers`）；钩子由 `prepare` 脚本在 `pnpm install` 时自动装上，新克隆后请确认 `git config core.hooksPath` 为 `.githooks`。
- 新增行为补测试时，断言要能捕获回归：可用变异测试自检（改坏实现后确认断言变红），避免写出恒真的断言。
- **建立或改变长期约定后，必须在同一次任务内完成三件事，不要等用户提醒**：① 把约定写进最近的 `AGENTS.md`；② 若可机器校验，加检查脚本并接入 pre-commit 与 CI；③ 新增/改动 CI 文件后同步更新对应 `AGENTS.md`（`.github/workflows/AGENTS.md`）。反例：2026-09 的全库精简消除了 52 处重复，但当时只清理了代码，未写规则也未加检查，用户不得不主动追问才补上。
- 同一错误连续失败 3 次后停下上报：复现、已排除假设、阻塞点。
- **任务收尾时必须自查经验落盘，不要等用户提醒**：排查确认了非显而易见根因的 bug、或用非常规手段绕过环境/工具坑的经历，收尾前写入 `.learnings/ERRORS.md`（格式 `[ERR-YYYYMMDD-XXX]`，含 Summary/Error/Solution/Prevention 与 Recurrence-Count 等字段）。hook 注入的 `<error-detected>` / `<self-improvement-reminder>` 只是提醒信号，落盘动作由本条约束。反例：2026-09-17 修复开关闪烁时只记了环境坑（ERR-20260917-002），主根因（ERR-20260917-003）被用户追问才补上。

- Mem0（MCP）：凭经验作答前先 `search_memory`；只在 git/代码无法推导的耐用结论上用 `add_memory`；新发现推翻旧条目时改写或删除。

## 文档指针（Pointer）

- 手册/项目记忆：`docs/USER_GUIDE.md`、`docs/PROJECT_HISTORY.md`、`docs/PROJECT_MEMORY.md`
- 模块/维护/审计：`docs/FUNCTION_MODULES.md`、`docs/MAINTENANCE.md`、`docs/verification/`
- 架构/ADR/规格/经验：`docs/adr/`、`docs/superpowers/specs/`、`docs/superpowers/plans/`、`.learnings/`

## Scoped AGENTS.md（进入对应目录前必须阅读）

| 目录 | 作用 |
|------|------|
| [src/AGENTS.md](./src/AGENTS.md) | 主进程/预加载/渲染进程/core 的边界与依赖方向 |
| [tests/AGENTS.md](./tests/AGENTS.md) | 测试分层、运行方式与断言约定 |
| [.github/workflows/AGENTS.md](./.github/workflows/AGENTS.md) | CI 与发布流水线约束 |

> 进入上述目录修改文件前，必须先读该目录的 `AGENTS.md`；其规则覆盖根文件。 `CLAUDE.md` / `GEMINI.md` 兼容入口未保留（d863d79 删除占位文件），agent-rules 的 `validate-structure.sh` 报 symlink 错误属预期例外，不要再生成。

## 任务边界

Ponytail 已由插件 hook 激活，强度以 `/ponytail [lite|full|ultra|off]` 为准。写代码前按"懒惰阶梯"优先复用、少造：先看是否已有、标准库是否覆盖、已装依赖是否解决，再写最小可行代码。Bug 修复做根因而非症状；不过度设计、不预造抽象。

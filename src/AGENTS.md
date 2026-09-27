<!-- Managed by agent: keep sections and order; edit content, not structure. Last updated: 2026-09-27 -->

# AGENTS.md — src

## Overview

Electron 主进程、预加载桥、渲染进程 React UI 与共享类型。生产代码不得反向依赖 `tests/`。

## Key Files

| 路径 | 职责 |
|------|------|
| `src/main/` | Electron 窗口、生命周期、`ipc/` 处理器、资源协议 |
| `src/preload/` | `contextBridge` 暴露给渲染进程的 `DnfApi` |
| `src/renderer/` | React 界面（`components/`、`styles/`、`workspace/`） |
| `src/core/` | 按业务域拆分的逻辑，不得依赖 renderer 组件 |
| `src/core/paths/relative-path.ts` | 主进程侧相对路径工具（父路径、`.npk` 判断、`win32.normalize` 身份） |
| `src/shared/path-key.ts` | 主/渲染进程共用的纯字符串路径键（`pathKey`、`isPathWithin`） |
| `src/shared/relative-path-guard.ts` | 拒绝绝对路径与 `..` 穿越的校验器，供各契约 schema 组合 |
| `src/shared/` | 主进程/渲染进程共享契约与 schema |

## Setup & environment

- Node >= 24，包管理器 pnpm 11.5.2。
- 路径含中文与空格，脚本与文档中始终使用 `-LiteralPath`。

## Build & tests

```powershell
pnpm typecheck
pnpm lint
pnpm vitest run tests/renderer/<name>.test.tsx
pnpm build
```

## Code style & conventions

- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`；不要用 `any` 或非空断言。
- Biome 是唯一格式化/检查入口，禁止手工调整格式对抗它。
- React 组件使用函数组件与 `React.JSX.Element` 返回类型；只读 props 用 `readonly`。
- 渲染进程不得直接 `import` Electron；所有原生能力走 preload 暴露的 API。
- 复用 `src/shared/` 已有契约与 `src/core/` 已有服务，不新增重复抽象。
- 新增行为必须补对应测试，不弱化或删除既有断言。

## Security & safety

- IPC 请求必须先过 schema 校验，再触达文件系统。
- 破坏性文件操作必须在解析后的绝对路径内，且遵守事务/回收站约束。
- 不在渲染进程暴露文件系统路径或凭据。

## PR/commit checklist

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm exec biome check <改动文件>` 通过
- [ ] 相关测试通过，并附命令输出
- [ ] 未改动与任务无关的模块

## Patterns to Follow

> 优先参考仓库内真实实现，不要照搬通用模板。

## When stuck

- 先读 `docs/ARCHITECTURE.md` 与 `docs/FUNCTION_MODULES.md`。
- 再读同域至少 2 个相似模块，对齐后再动手。

## House Rules (project-specific)

- 改 `src/shared/contracts.ts` 的 `APP_VERSION` 时，必须同步 `package.json` 版本与 Git 标签。
- 外观相关 CSS 变量由 `src/renderer/workspace/useAppearance.ts` 统一写入，不要在组件里另起变量名。
- 分类排序：`scanCategory` / `scanCategoryTree` 的 `savedOrders` 是显示顺序的唯一输入。改名、新建或固化同级顺序前必须传入 `categoryOrder.getAll()` 的结果；未记录的分类会回落到 `byName`，不能只改顺序记录而不迁移或固化。回归测试要覆盖“从未排序过”和“陈旧且不完整记录”两类场景（见 ERR-20260920-004 / ERR-20260920-005）。

## 禁止重复造路径/状态辅助（简化前必读）

路径与状态读取的辅助函数已在 2026-09 收敛为共享实现，**新增或改写这些逻辑前必须先 import 现有函数，不得再写本地副本或内联等价表达式**。

必须复用的函数（写代码前先查这里）：

| 需求 | 唯一实现 | 注意 |
|------|----------|------|
| 路径比较键（大小写不敏感） | `shared/path-key.ts` 的 `pathKey` | 只换分隔符，**不**折叠 `..`/`.`/重复分隔符 |
| 判断子路径 | 同上 `isPathWithin` / `isPathWithinKey` | 不要手写 `startsWith(parent + "\\")` |
| 拒绝绝对路径与 `..` 穿越 | `shared/relative-path-guard.ts` 的 `isSafeRelativePath` | 契约 schema 组合用，勿各自内联正则 |
| 扩展名判断 `.npk` | `core/paths/relative-path.ts` 的 `isNpkPath` | 勿写 `win32.extname(x).toLocaleLowerCase() === ".npk"` |
| 父级相对路径 | 同上 `parentRelativePath` | 顶层项归一化为 `""` |
| 去掉 `./` 前缀 | 同上 `normalizeRelativePath` | 不转小写，调用方自行决定 |
| 已存在路径的身份比较 | 同上 `normalizedPathKey`（`win32.normalize` 后转小写） | 会折叠 `..`/`.`，与 `pathKey` **语义不同，不可互换** |
| 捕获 ENOENT | `core/filesystem/path-exists.ts` 的 `isNotFoundError` | 勿写 `error.code === "ENOENT"` 内联判断 |
| 判断路径是否存在 | 同上 `pathExists` | 勿写本地 `exists()`（`legacy-group-migration.ts` 曾有此副本，因改换函数名而逃过检查脚本） |
| 状态读取回退默认值 | `core/state/atomic-json-store.ts` 的 `readOrFallback` | 勿重写 `STATE_MISSING` 分支 |
| 回收站相对路径越界校验 | `core/recycle/recycle-items.ts` 的 `resolveRecyclePath` | 回收站根与库根不同，**不要**改用 `resolveLibraryPath` |
| 判断是否为工作区项目拖拽 | `renderer/workspace/item-drag.ts` 的 `isWorkspaceItemsDrag` | 勿写本地副本（曾在 `ItemWorkspace`/`CategoryTree` 各有一份） |

约束：

- **`pathKey` 与 `normalizedPathKey` 不可互换**：前者是纯字符串键（保留 `a//b`、`./a`、`a/../b` 原样），后者走 `win32.normalize` 会折叠。混用会静默改变去重与匹配行为；已有单测锁定该差异（`tests/unit/relative-path.test.ts`）。
- 允许保留的例外：`group-marker.ts` 与 `group-service.ts` 的 ENOENT 判断用更窄的 `error instanceof Error` 形式，比 `isNotFoundError` 限制更严，合并会放宽输入范围，故有意保留。同理 `AppearanceDialog` 的 `hexToHsv`/`hsvToHex` 与 `CategorySidebar` 的 `hexToHue`/`hueToHex` 存在 ±1 度取整差异，**不得合并**。
- 新增共享辅助前先在本文件与 `src/shared/`、`src/core/paths/` 搜索；确认不存在才新增，并在本表登记。
- **检查脚本按函数名匹配，改名副本是已知盲区**：`scripts/check-path-helpers.mjs` 只拦截"同名 function 重复声明"与固定的内联表达式。把 `pathExists` 抄成 `exists`、把 `isWorkspaceItemsDrag` 抄成 `isLibraryItemsDrag` 都能通过 CI。因此重构时不要只依赖 `pnpm verify:no-dup-helpers` 的绿灯，要按本表逐个语义核对。
- 修改上表任一函数时，同步跑 `pnpm vitest run tests/unit/path-key.test.ts tests/unit/relative-path.test.ts tests/unit/relative-path-guard.test.ts`。

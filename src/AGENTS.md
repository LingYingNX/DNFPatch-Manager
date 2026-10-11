<!-- Managed by agent: keep sections and order; edit content, not structure. Last updated: 2026-10-10 -->

# AGENTS.md — src

## Overview

Electron 主进程、预加载桥、渲染进程 React UI 与共享类型。补丁库支持 `.npk`（图像/音效）与 `.bk2`（视频）两类。生产代码不得反向依赖 `tests/`。

## Key Files

| 路径 | 职责 |
|------|------|
| `src/main/` | Electron 窗口、生命周期、`ipc/` 处理器、资源协议 |
| `src/main/library-schemes.ts` | 自定义 scheme（`dnf-asset:` / `dnf-library:`）与特权声明，须与 `renderer/index.html` 的 CSP 同源 |
| `src/main/library/video-preview-generator.ts` | BK2 预览生成：探测本机外部转换器，产出同名 JPG 封面与 MP4 |
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

## 视频补丁（BK2）

`.bk2` 与 `.npk` 在库里同权，但**安装路由不同**：BK2 只能装到 `video`，NPK 按 `NpkPatchKind`（`image` / `sound` / `video`）分流到 `ImagePacks2` / `SoundPacks`。判定入口统一走 `classifyNpk`（`core/install/npk-type.ts`）。

- **拖入端与扫描端必须共用同一判定**：`isLibraryPatchPath` 是拖拽、导入、扫描、移动、分组、删除、重命名、回收、预设与安装源校验的唯一扩展名口径。任一环节另写 NPK-only 判断，就会出现“拖不进也扫不出”或“扫得出拖不进”的不对称（ERR-20261009-001）。
- **预览只在拖入路径生成是错的**：手动复制进库的 BK2 也要在扫描时补齐封面/MP4，每个补丁每进程只尝试一次，生成完成后再通知渲染进程刷新（ERR-20261009-005）。
- **转换器是外部工具，且是命令分发器**：`radvideo64.exe` / `Bink2ForUnreal.exe` 必须写成 `<exe> BinkConv <输入> <输出> [/开关]`，漏掉 `BinkConv` 会立刻静默 `exit=1` 且无产物（ERR-20261009-002）。转换与抽帧都要等产物稳定后显式结束进程树，`radvideo64.exe` 转换完仍驻留（ERR-20261009-003）。
- **中文路径必须先搬进 ASCII 工作目录**：`bink2nvenc.exe` 只能打开纯 ASCII 路径，中文路径直接 `BinkOpen failed: Error opening file.`。见 `resolveWorkspaceRoot`。
- **`--start N --count M` 组合不可靠**：不同 N 会产出 byte 相同的结果；封面抽帧一律走 `radvideo64.exe` 的单帧 JPG，不用它抽帧。JPG 导出器对 `/Z2000` 这类开关会静默放弃产物（ERR-20261010-001）。
- **视频能否播放取决于 CSP**：`<video>` 走 `media-src`，`src/renderer/index.html` 的 CSP 未列出 `dnf-library:` 时元素渲染出来但永远拿不到帧（表现为悬停一个黑框，ERR-20261009-004）。改动 scheme 或 CSP 需同步 `tests/unit/media-scheme-contracts.test.ts`。
- **同名 MP4 预览随补丁一起走**：回收、清空、单条删除、重命名、移动时都要连带处理同名 MP4，否则会留下孤儿预览。
- 转换器不入库（`tools/bink2nvenc/` 已在 `.gitignore`）：RAD 官方许可禁止再分发，运行期探测本机已有工具，探测不到就静默跳过，不影响导入。

## 禁止重复造路径/状态辅助（简化前必读）

路径与状态读取的辅助函数已在 2026-09 收敛为共享实现，**新增或改写这些逻辑前必须先 import 现有函数，不得再写本地副本或内联等价表达式**。

必须复用的函数（写代码前先查这里）：

| 需求 | 唯一实现 | 注意 |
|------|----------|------|
| 路径比较键（大小写不敏感） | `shared/path-key.ts` 的 `pathKey` | 只换分隔符，**不**折叠 `..`/`.`/重复分隔符 |
| 判断子路径 | 同上 `isPathWithin` / `isPathWithinKey` | 不要手写 `startsWith(parent + "\\")` |
| 拒绝绝对路径与 `..` 穿越 | `shared/relative-path-guard.ts` 的 `isSafeRelativePath` | 契约 schema 组合用，勿各自内联正则 |
| 扩展名判断 `.npk` | `core/paths/relative-path.ts` 的 `isNpkPath` | 仅用于“必须是 NPK”的严格场景；**补丁库内含 `.bk2`，一律改用下一行** |
| 补丁库扩展名（`.npk` / `.bk2`） | `shared/library-patch-extensions.ts` 的 `isLibraryPatchPath` / `isVideoPatchPath` / `libraryPatchExtension` / `libraryPatchBaseName` | 库导入、扫描、移动、分组、删除、重命名与安装源校验统一复用；不得另写 basename 或扩展名辅助 |
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

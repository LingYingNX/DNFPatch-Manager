<!-- Managed by agent: keep sections and order, edit content, not structure. Last updated: 2026-10-09 -->

# AGENTS.md — tests

## Overview

测试按层拆分：`unit/` 与 `renderer/` 走默认 jsdom 配置、`integration/` 走 node 配置与真实 core 服务、`e2e/` 用 Playwright。

## Key Files

| 路径 | 用途 |
|------|------|
| `tests/unit/` | 纯函数与契约（默认 jsdom 环境） |
| `tests/integration/` | core 服务与 IPC 契约集成（node） |
| `tests/renderer/` | React 组件与工作区行为（jsdom） |
| `tests/e2e/` | 打包后应用端到端（Playwright） |
| `tests/renderer/fake-api.ts` | 渲染层测试用的假 `DnfApi`，改契约需同步 |

## Setup & environment

- `vitest.config.ts` 默认 jsdom；`vitest.integration.config.ts` 为 node 并只收集 `tests/integration/`。
- `clearMocks` 与 `restoreMocks` 已开启；测试间不得共享可变状态。
- 涉及中文路径/文件的用例必须用真实路径写法，不要硬编码盘符假设。
- Windows PowerShell 的 `PATH` 可能没有 `bash`；`tests/unit/verify-harness-drift.test.ts` 的 `spawnSync("bash", ...)` 会返回 `ENOENT`，表现为 `stdout` 为 `undefined`。先临时加入 `C:\Program Files\Git\bin` 或用 Git Bash 运行，不要改断言掩盖环境问题（ERR-20260924-001）。

## Running tests

```powershell
pnpm test
pnpm test:unit
pnpm test:integration
pnpm vitest run tests/renderer/<name>.test.tsx
pnpm test:e2e
```

## Test organization

- 文件名与被测对象对应：`<feature>.test.ts` / `<component>.test.tsx`。
- 断言用户可见行为，不锁内部实现细节。
- 外部依赖（网络、文件系统、时间）必须 mock 或隔离。
- 回归测试要能在这个 bug 上变红，修复后变绿。

## Code style & conventions

- 测试名描述期望行为，不写 `should work`。
- 优先 `screen.getByRole` 等语义查询，少用 test id。
- 时间相关行为用 fake timers，并确保恢复真实计时器。

## Security & safety

- 不在 fixture 中写真实凭据、令牌或用户数据。
- 不写入用户真实补丁库路径；测试使用临时目录。

## PR/commit checklist

- [ ] 目标测试通过并附输出
- [ ] 新行为有对应断言
- [ ] 无遗留 `[DEBUG-*]` 调试代码

## Patterns to Follow

> 参考 `tests/renderer/appearance-settings.test.tsx` 与 `tests/integration/category-style.test.ts` 的现有写法。

## When stuck

- 先确认 config 选对了环境（jsdom 还是 node）。
- 再确认是否漏了 `fake-api.ts` 的契约同步。

## House Rules (project-specific)

- 修改 `DnfApi` 契约后，必须同步 `tests/renderer/fake-api.ts`。
- 不要用 `pnpm lint` 的全量结果掩盖单文件问题；针对性跑 `biome check <文件>`。
- **CSS 计算样式断言只能放 `tests/e2e/`**：jsdom 不做样式计算，`getComputedStyle` 的 `box-shadow`/`border-color` 在 renderer 测试里恒为空值，写在那里等于恒真断言。渲染层测交互与 DOM 结构，视觉终值（线框、光晕、过渡后颜色）用 Playwright + Electron 在 e2e 断言。
- e2e 断言带 `transition` 的属性时必须 `expect.poll` 到终值，直接 `evaluate` 会采到过渡中间值（如 alpha 0.824）造成假红。
- e2e 启动 Electron 一律带独立 `--user-data-dir=`（等号形式），否则用户开着应用时单实例锁会挤掉测试实例（见 `.learnings/ERRORS.md` ERR-20260917-002）。

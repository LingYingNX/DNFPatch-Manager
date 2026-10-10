import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * 回归测试：drift 检查必须能在 pre-commit 阶段拦住「改了 build/CI 文件
 * 却没同步 AGENTS.md」。
 *
 * 这个守卫的存在意义来自两次真实事故（见 .learnings/ERRORS.md
 * ERR-20260922-001）：改 biome.json 与改 scripts/* 时都忘了同步根 AGENTS.md，
 * 而 pre-commit 当时只跑 --level=1、drift 属 level 3，两次都漏到 CI 才报红。
 *
 * 关键点是 --staged 必须查**暂存区**而非 HEAD~1..HEAD：pre-commit 阶段
 * HEAD~1..HEAD 仍指向上一个提交，查它既拦不住本次改动、也可能误报。
 */
const projectRoot = resolve(import.meta.dirname, "../..");
const harness = join(projectRoot, "scripts", "verify-harness.sh");

let sandbox: string;

function git(args: readonly string[], cwd: string): void {
  const result = spawnSync("git", [...args], { cwd, encoding: "utf8", shell: false });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
}

function runHarness(args: readonly string[], cwd: string) {
  const result = spawnSync("bash", [harness, ...args], { cwd, encoding: "utf8", shell: false });
  if (result.error?.code === "ENOENT") {
    // bash 不在 PATH（Windows 常见）时给出明确根因，而不是让断言
    // 在 undefined 上抛出误导性的 AssertionError（ERR-20260924-001）。
    throw new Error(
      "bash not found on PATH. On Windows add C:\\Program Files\\Git\\bin to PATH before running this test (ERR-20260924-001).",
    );
  }
  return result;
}

/** 建一个最小 git 仓库：harness 需要 AGENTS.md、docs/ARCHITECTURE.md 等结构。 */
async function createRepo(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "dnf-harness-drift-"));
  git(["init", "-q"], directory);
  git(["config", "user.email", "test@example.com"], directory);
  git(["config", "user.name", "Test"], directory);

  await writeFile(join(directory, "AGENTS.md"), "# AGENTS.md\n\n## Commands\n", "utf8");
  // prepare 脚本与 harness-verify.yml 是 level 2/3 的必需结构：前者须含
  // hooksPath、后者须含 harness-verify 关键词，否则报 error/warning（退出码
  // 非 0）盖过 drift 的 warning（退出码 2），就测不出目标行为。
  await writeFile(
    join(directory, "package.json"),
    '{ "name": "fixture", "scripts": { "prepare": "git config core.hooksPath .githooks" } }\n',
    "utf8",
  );
  await writeFile(join(directory, "README.md"), "# fixture\n", "utf8");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(directory, "docs"), { recursive: true });
  await writeFile(join(directory, "docs", "ARCHITECTURE.md"), "# arch\n", "utf8");
  await mkdir(join(directory, "scripts"), { recursive: true });
  await writeFile(join(directory, "scripts", "placeholder.sh"), "#!/usr/bin/env sh\n", "utf8");
  await mkdir(join(directory, ".github", "workflows"), { recursive: true });
  await writeFile(
    join(directory, ".github", "workflows", "harness-verify.yml"),
    "name: Harness Verification\nsteps:\n  - run: bash scripts/verify-harness.sh\n",
    "utf8",
  );
  await writeFile(join(directory, ".github", "workflows", "x.yml"), "name: x\n", "utf8");
  await writeFile(join(directory, ".github", "pull_request_template.md"), "## checklist\n", "utf8");
  await mkdir(join(directory, ".githooks"), { recursive: true });
  await writeFile(join(directory, ".githooks", "pre-commit"), "#!/usr/bin/env sh\n", "utf8");

  git(["add", "-A"], directory);
  git(["commit", "-q", "-m", "init"], directory);
  return directory;
}

beforeAll(async () => {
  sandbox = await createRepo();
});

afterAll(async () => {
  await rm(sandbox, { force: true, recursive: true, maxRetries: 5, retryDelay: 200 });
});

describe("harness drift guard", () => {
  it("flags a staged script change that leaves AGENTS.md untouched", async () => {
    await writeFile(
      join(sandbox, "scripts", "placeholder.sh"),
      "#!/usr/bin/env sh\necho hi\n",
      "utf8",
    );
    git(["add", "scripts/placeholder.sh"], sandbox);

    const result = runHarness(["--level=3", "--staged", "--format=text"], sandbox);

    // drift 是 warning，但 harness 的退出逻辑是 WARNINGS>0 → exit 2。
    expect(result.stdout).toContain("Potential drift");
    expect(result.status).toBe(2);
  });

  it("flags a staged workflow change that leaves AGENTS.md untouched", async () => {
    git(["reset", "-q"], sandbox);
    await writeFile(join(sandbox, ".github", "workflows", "x.yml"), "name: x\non: push\n", "utf8");
    git(["add", ".github/workflows/x.yml"], sandbox);

    const result = runHarness(["--level=3", "--staged", "--format=text"], sandbox);

    expect(result.stdout).toContain("Potential drift");
    expect(result.status).toBe(2);
  });

  it("passes once AGENTS.md is staged alongside the build change", async () => {
    await writeFile(join(sandbox, "AGENTS.md"), "# AGENTS.md\n\n## Commands\n\nupdated\n", "utf8");
    git(["add", "AGENTS.md"], sandbox);

    const result = runHarness(["--level=3", "--staged", "--format=text"], sandbox);

    expect(result.stdout).toContain("No drift detected");
    expect(result.status).toBe(0);
  });

  it("keeps commit-range mode working for CI when --staged is absent", async () => {
    git(["commit", "-q", "-m", "script change"], sandbox);

    // 不带 --staged 时看 HEAD~1..HEAD：上一次提交同时改了 scripts 与 AGENTS.md，
    // 因此不应报 drift。这验证 CI 路径未被 --staged 改动破坏。
    const result = runHarness(["--level=3", "--format=text"], sandbox);

    expect(result.stdout).toContain("No drift detected");
    expect(result.status).toBe(0);
  });

  it("flags a commit that changed build files without AGENTS.md", async () => {
    await writeFile(join(sandbox, "package.json"), '{ "name": "fixture", "v": 2 }\n', "utf8");
    git(["add", "package.json"], sandbox);
    git(["commit", "-q", "-m", "touch package.json only"], sandbox);

    const result = runHarness(["--level=3", "--format=text"], sandbox);

    expect(result.stdout).toContain("Potential drift");
    expect(result.status).toBe(2);
  });
});

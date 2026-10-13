import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("preserves corrupted state and exposes a read-only workspace", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-recovery-e2e-"));
  const dataRoot = join(runtimeRoot, "data");
  const libraryRoot = join(runtimeRoot, "patch-categories");
  const settings = join(dataRoot, "settings.json");
  const corruptedBytes = "{ broken settings";
  await Promise.all([
    mkdir(dataRoot, { recursive: true }),
    mkdir(libraryRoot, { recursive: true }),
  ]);
  await writeFile(settings, corruptedBytes);
  await writeFile(join(libraryRoot, "view-only.npk"), "view-only-payload");
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });

  try {
    const page = await application.firstWindow();
    await expect(page.locator(".recovery-banner")).toContainText("settings.json");
    await expect(page.getByRole("button", { name: "view-only.npk", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "导入补丁" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "选择游戏目录" })).toHaveCount(0);
    expect(await readFile(settings, "utf8")).toBe(corruptedBytes);
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

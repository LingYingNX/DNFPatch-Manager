import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("toast close button dismisses the notice while settings dialog is open", async () => {
  test.setTimeout(60_000);
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-toast-e2e-"));
  const gameRoot = join(runtimeRoot, "game");
  await mkdir(join(gameRoot, "ImagePacks2"), { recursive: true });
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });
  try {
    const page = await application.firstWindow();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole("main", { name: "补丁工作区" }).waitFor();
    await page.getByRole("button", { name: "设置" }).click();
    await page.getByRole("textbox", { name: "游戏目录" }).fill(gameRoot);
    await page.getByRole("textbox", { name: "游戏目录" }).press("Enter");
    const alert = page.getByRole("alert").filter({ hasText: "请设置到游戏根目录" });
    await expect(alert).toBeVisible();
    await page.getByRole("button", { name: "关闭提示" }).click();
    await expect(alert).toHaveCount(0);
  } finally {
    if (application.windows().length > 0) await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

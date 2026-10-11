import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("keeps patch cards without preview images on the shared preview surface", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-preview-placeholder-e2e-"));
  await mkdir(join(runtimeRoot, "patch-categories"), { recursive: true });
  await writeFile(join(runtimeRoot, "patch-categories", "A.npk"), "patch");

  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });

  try {
    const page = await application.firstWindow();
    await page.getByRole("main", { name: "补丁工作区" }).waitFor();
    const preview = page
      .getByRole("button", { name: "A.npk", exact: true })
      .locator(".item-preview");

    await expect(preview.locator(".item-preview-image")).toHaveCount(0);
    // 空预览与有图卡片共用同一块 --color-elevated 预览面，不再是纯黑凹槽；
    // 「这张卡没有预览图」由卡片中央的占位图标表达。
    await expect(preview).toHaveCSS("background-color", "rgb(30, 32, 41)");
    await expect(preview.locator(":scope > svg")).toHaveCount(1);
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

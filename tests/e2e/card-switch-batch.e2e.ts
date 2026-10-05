import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

/**
 * 卡片右下角开关在批量选中时作用于整个选区：拨任一选中卡片的开关，
 * 所有选中卡片同步启用/停用，且选区保持不变，可以接着整体关回去。
 */
test("toggles every selected card from a single card switch", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-switch-batch-e2e-"));
  const libraryRoot = join(runtimeRoot, "patch-categories");
  const gameRoot = join(runtimeRoot, "game");
  await mkdir(join(libraryRoot, "分类"), { recursive: true });
  await mkdir(join(gameRoot, "ImagePacks2"), { recursive: true });
  await mkdir(join(gameRoot, "SoundPacks"), { recursive: true });
  await Promise.all([
    writeFile(join(libraryRoot, "分类", "a.npk"), "a-payload"),
    writeFile(join(libraryRoot, "分类", "b.npk"), "b-payload"),
    writeFile(join(libraryRoot, "分类", "c.npk"), "c-payload"),
  ]);

  // --user-data-dir（等号形式）让单实例锁与用户正在运行的应用隔离，避免 e2e 实例被挤出。
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });
  try {
    const page = await application.firstWindow();
    await page.getByRole("main", { name: "补丁工作区" }).waitFor();

    // 未设定游戏目录时启用会被 GAME_DIRECTORY_REQUIRED 拦下。
    await page.getByRole("button", { name: "设置" }).click();
    const directoryInput = page.getByRole("textbox", { name: "游戏目录" });
    await directoryInput.fill(gameRoot);
    await directoryInput.press("Enter");
    await page.waitForTimeout(1000);
    await page.locator(".dialog-backdrop-dismiss").click();

    await page.getByRole("button", { name: "分类", exact: true }).click();
    const first = page.getByRole("button", { name: "a.npk", exact: true });
    await first.waitFor();

    await first.click();
    await page
      .getByRole("button", { name: "b.npk", exact: true })
      .click({ modifiers: ["Control"] });
    await page
      .getByRole("button", { name: "c.npk", exact: true })
      .click({ modifiers: ["Control"] });
    const selectedCards = page.locator('.item-card[aria-pressed="true"]');
    await expect(selectedCards).toHaveCount(3);

    // 真正的 input 被 CSS 隐藏（宽高 0 + opacity 0），可点的是 .slider。
    const firstSwitch = page.locator(".item-card-shell", { has: first }).locator(".slider");

    await firstSwitch.click();
    for (const name of ["a.npk", "b.npk", "c.npk"]) {
      await expect(page.getByRole("checkbox", { name: `停用 ${name}` })).toBeChecked();
    }
    // 选区必须保留，否则下一次点击会退化成只改这一张。
    await expect(selectedCards).toHaveCount(3);

    await firstSwitch.click();
    for (const name of ["a.npk", "b.npk", "c.npk"]) {
      await expect(page.getByRole("checkbox", { name: `启用 ${name}` })).not.toBeChecked();
    }
    await expect(selectedCards).toHaveCount(3);
  } finally {
    await application.close();
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

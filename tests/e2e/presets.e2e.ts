import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

async function configureGameDirectory(
  application: Awaited<ReturnType<typeof electron.launch>>,
  gameRoot: string,
) {
  await application.evaluate(({ dialog }, selectedPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
  }, gameRoot);
  const page = await application.firstWindow();
  await expect
    .poll(() => page.evaluate(() => window.dnf.selectGameDirectory()))
    .toMatchObject({ ok: true, value: { gameDirectory: gameRoot } });
  return page;
}

async function createPresetFromRootPatches(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof electron.launch>>["firstWindow"]>>,
): Promise<void> {
  await page.getByRole("button", { name: "coat.npk", exact: true }).click();
  await page
    .getByRole("button", { name: "sword.npk", exact: true })
    .click({ modifiers: ["Control"] });
  await page.getByRole("button", { name: "sword.npk", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "加入预设", exact: true }).click();
  await page.getByRole("textbox", { name: "预设名称" }).fill("测试预设");
  await page.getByRole("button", { name: "创建预设", exact: true }).click();
  await expect(page.getByRole("button", { name: "预设", exact: true })).toContainText("1");
  await expect(page.locator(".toast-viewport")).toHaveCount(0);
}

test("persists, additively installs, and deletes a preset without deleting NPK files", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-presets-e2e-"));
  const libraryRoot = join(runtimeRoot, "patch-categories");
  const dataRoot = join(runtimeRoot, "data");
  const gameRoot = join(runtimeRoot, "game");
  const coatPath = join(libraryRoot, "coat.npk");
  const swordPath = join(libraryRoot, "sword.npk");
  const unrelatedPath = join(gameRoot, "unrelated.npk");
  // 游戏根目录校验要求 ImagePacks2 / SoundPacks / video 三个子目录全部存在
  await Promise.all([
    mkdir(join(libraryRoot, "Armor"), { recursive: true }),
    mkdir(dataRoot, { recursive: true }),
    mkdir(join(gameRoot, "ImagePacks2"), { recursive: true }),
    mkdir(join(gameRoot, "SoundPacks"), { recursive: true }),
    mkdir(join(gameRoot, "video"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(coatPath, "coat-payload"),
    writeFile(swordPath, "sword-payload"),
    writeFile(join(libraryRoot, "Armor", "nested.npk"), "nested-payload"),
  ]);
  const launch = () =>
    electron.launch({
      args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
      cwd: runtimeRoot,
    });
  const application = await launch();

  try {
    const page = await configureGameDirectory(application, gameRoot);
    await Promise.all([
      writeFile(unrelatedPath, "unrelated-payload"),
      writeFile(
        join(dataRoot, "installation-state.json"),
        JSON.stringify({
          formatVersion: 1,
          records: [
            {
              sourceRelativePath: "unrelated.npk",
              sourceHash: "0".repeat(64),
              targetPath: unrelatedPath,
              targetHash: "0".repeat(64),
              enabledAt: "2026-07-22T00:00:00.000Z",
              transactionId: "a2021aa5-e024-4106-a0a3-f0874d4c9ec9",
            },
          ],
        }),
      ),
    ]);
    await createPresetFromRootPatches(page);
    await expect(access(join(dataRoot, "presets.json"))).resolves.toBeUndefined();

    await application.close();
    const restarted = await launch();
    try {
      const restartedPage = await restarted.firstWindow();
      const sidebar = restartedPage.getByRole("navigation", { name: "补丁分类" });
      await sidebar.getByRole("button", { name: "预设", exact: true }).click();
      await expect(
        restartedPage.getByRole("button", { name: "查看预设 测试预设", exact: true }),
      ).toBeVisible();
      await restartedPage
        .locator("label.preset-switch")
        .filter({
          has: restartedPage.getByRole("checkbox", { name: "启用预设 测试预设", exact: true }),
        })
        .click();
      await expect(
        restartedPage.getByRole("checkbox", { name: "停用预设 测试预设", exact: true }),
      ).toBeChecked();
      await expect.poll(() => exists(join(gameRoot, "ImagePacks2", "coat.npk"))).toBe(true);
      await expect.poll(() => exists(join(gameRoot, "ImagePacks2", "sword.npk"))).toBe(true);
      await expect(readFile(unrelatedPath, "utf8")).resolves.toBe("unrelated-payload");
      await expect(readFile(join(gameRoot, "ImagePacks2", "coat.npk"), "utf8")).resolves.toBe(
        "coat-payload",
      );
      await expect(readFile(join(gameRoot, "ImagePacks2", "sword.npk"), "utf8")).resolves.toBe(
        "sword-payload",
      );

      await restartedPage.getByRole("button", { name: "删除预设 测试预设", exact: true }).click();
      await restartedPage.getByRole("button", { name: "确认删除", exact: true }).click();
      await expect(
        restartedPage.getByRole("button", { name: "查看预设 测试预设", exact: true }),
      ).toHaveCount(0);
      await expect(access(coatPath)).resolves.toBeUndefined();
      await expect(access(swordPath)).resolves.toBeUndefined();
    } finally {
      await restarted.close();
    }
  } finally {
    if (application.windows().length > 0) await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("reports missing preset references while installing existing items", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-presets-missing-e2e-"));
  const libraryRoot = join(runtimeRoot, "patch-categories");
  const gameRoot = join(runtimeRoot, "game");
  const coatPath = join(libraryRoot, "coat.npk");
  const swordPath = join(libraryRoot, "sword.npk");
  await Promise.all([
    mkdir(libraryRoot, { recursive: true }),
    mkdir(join(gameRoot, "ImagePacks2"), { recursive: true }),
    mkdir(join(gameRoot, "SoundPacks"), { recursive: true }),
    mkdir(join(gameRoot, "video"), { recursive: true }),
  ]);
  await Promise.all([writeFile(coatPath, "coat-payload"), writeFile(swordPath, "sword-payload")]);
  const launch = () =>
    electron.launch({
      args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
      cwd: runtimeRoot,
    });
  const application = await launch();

  try {
    const page = await configureGameDirectory(application, gameRoot);
    await createPresetFromRootPatches(page);
    await rm(swordPath);
    await application.close();
    const restarted = await launch();
    try {
      const restartedPage = await restarted.firstWindow();
      const sidebar = restartedPage.getByRole("navigation", { name: "补丁分类" });
      await sidebar.getByRole("button", { name: "预设", exact: true }).click();
      await expect(restartedPage.getByText("缺失 1 项")).toBeVisible();
      await restartedPage.getByRole("button", { name: "查看预设 测试预设" }).click();
      await expect(restartedPage.getByText("sword.npk")).toBeVisible();
      await restartedPage
        .locator("label.preset-switch")
        .filter({
          has: restartedPage.getByRole("checkbox", { name: "启用预设 测试预设", exact: true }),
        })
        .click();
      await expect.poll(() => exists(join(gameRoot, "ImagePacks2", "coat.npk"))).toBe(true);
      await expect.poll(() => exists(join(gameRoot, "ImagePacks2", "sword.npk"))).toBe(false);
      await expect(restartedPage.getByRole("status")).toContainText("跳过缺失：sword.npk");
    } finally {
      await restarted.close();
    }
  } finally {
    if (application.windows().length > 0) await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

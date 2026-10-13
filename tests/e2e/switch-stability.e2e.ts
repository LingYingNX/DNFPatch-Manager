import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, type Page, test } from "@playwright/test";

async function dropFiles(page: Page, filePaths: readonly string[]): Promise<void> {
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.dataset["e2eDropInput"] = "true";
    input.multiple = true;
    input.type = "file";
    input.hidden = true;
    document.body.append(input);
  });
  await page.locator('input[data-e2e-drop-input="true"]').setInputFiles(filePaths);
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('input[data-e2e-drop-input="true"]');
    const workspace = document.querySelector<HTMLElement>('main[aria-label="补丁工作区"]');
    if (input === null || workspace === null) throw new Error("Drop test setup is incomplete");
    const dataTransfer = new DataTransfer();
    for (const file of Array.from(input.files ?? [])) dataTransfer.items.add(file);
    workspace.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }),
    );
    input.remove();
  });
}

test("keeps unrelated card switches enabled while one toggle is busy", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-switch-stability-e2e-"));
  const sourceRoot = join(runtimeRoot, "sources");
  const gameRoot = join(runtimeRoot, "game");
  // 游戏目录校验要求 ImagePacks2 / SoundPacks / video 三个子目录全部存在
  await Promise.all([
    mkdir(join(gameRoot, "ImagePacks2"), { recursive: true }),
    mkdir(join(gameRoot, "SoundPacks"), { recursive: true }),
    mkdir(join(gameRoot, "video"), { recursive: true }),
    mkdir(sourceRoot, { recursive: true }),
  ]);
  await writeFile(join(sourceRoot, "coat.npk"), "coat-payload");
  await writeFile(join(sourceRoot, "sword.npk"), "sword-payload");
  // --user-data-dir（等号形式）让单实例锁与用户正在运行的应用隔离，避免 e2e 实例被挤出
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });

  try {
    const page = await application.firstWindow();
    await page.getByRole("main", { name: "补丁工作区" }).waitFor();
    await application.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
    }, gameRoot);
    await expect
      .poll(() => page.evaluate(() => window.dnf.selectGameDirectory()))
      .toMatchObject({ ok: true, value: { gameDirectory: gameRoot } });
    await dropFiles(page, [join(sourceRoot, "coat.npk"), join(sourceRoot, "sword.npk")]);
    await expect(page.getByRole("button", { name: "coat.npk", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "sword.npk", exact: true })).toBeVisible();

    const switches = page.locator(".item-grid .item-card-shell > label.switch");
    await expect(switches).toHaveCount(2);

    // 记录另一个开关 input 的 disabled 属性变化历史；一次 toggle 期间它必须保持 enabled
    await switches
      .nth(1)
      .locator("input")
      .evaluate((element) => {
        const input = element as HTMLInputElement & { __disabledLog?: string[] };
        input.__disabledLog = [];
        new MutationObserver(() => {
          input.__disabledLog?.push(`disabled=${input.disabled}`);
        }).observe(element, { attributes: true, attributeFilter: ["disabled"] });
      });

    await switches.nth(0).locator(".slider").click({ force: true });
    // 点击后对应补丁应翻转为启用（aria-label 由 启用 变为 停用）
    const firstInput = switches.nth(0).locator("input");
    await expect
      .poll(async () => firstInput.getAttribute("aria-label"), { timeout: 5_000 })
      .toMatch(/^停用/u);
    await page.waitForTimeout(100);

    const disabledLog = await switches
      .nth(1)
      .locator("input")
      .evaluate(
        (element) => (element as HTMLInputElement & { __disabledLog?: string[] }).__disabledLog,
      );
    expect(disabledLog).toEqual([]);
    await expect(switches.nth(1).locator("input")).not.toBeDisabled();
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

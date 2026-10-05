import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

async function dropFile(page: import("@playwright/test").Page, filePath: string): Promise<void> {
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.dataset["e2eDropInput"] = "true";
    input.type = "file";
    input.hidden = true;
    document.body.append(input);
  });
  await page.locator('input[data-e2e-drop-input="true"]').setInputFiles(filePath);
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

test("persists the selected game directory across restart and toggles a real patch", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-game-directory-e2e-"));
  const sourceRoot = join(runtimeRoot, "sources");
  const gameRoot = join(runtimeRoot, "game");
  const secondGameRoot = join(runtimeRoot, "game-2");
  const screenshotRoot = join(projectRoot, ".scratch");
  await Promise.all([
    mkdir(sourceRoot, { recursive: true }),
    mkdir(gameRoot, { recursive: true }),
    mkdir(secondGameRoot, { recursive: true }),
    mkdir(screenshotRoot, { recursive: true }),
  ]);
  await writeFile(join(sourceRoot, "coat.npk"), "coat-payload");
  const sourcePath = join(sourceRoot, "coat.npk");
  const launch = () => electron.launch({ args: [projectRoot], cwd: runtimeRoot });
  const application = await launch();

  try {
    await application.evaluate(
      ({ dialog }, paths) => {
        let callCount = 0;
        dialog.showOpenDialog = async () => {
          callCount += 1;
          const selections = [paths.gameRoot, paths.secondGameRoot];
          return {
            canceled: false,
            filePaths: [selections[callCount - 1] ?? paths.secondGameRoot],
          };
        };
      },
      { gameRoot, secondGameRoot },
    );
    const page = await application.firstWindow();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole("main", { name: "补丁工作区" }).waitFor();
    await page.getByRole("button", { name: "设置" }).click();
    const directoryInput = page.getByRole("textbox", { name: "游戏目录" });
    await page.getByRole("button", { name: "浏览", exact: true }).click();
    await expect(directoryInput).toHaveValue(gameRoot);
    await page.locator(".dialog-backdrop-dismiss").click();
    await expect(page.locator(".app-toolbar")).toHaveCount(0);
    await page.screenshot({ path: join(screenshotRoot, "task-8-game-directory-1280.png") });

    await dropFile(page, sourcePath);
    await expect(page.getByRole("button", { name: "coat.npk", exact: true })).toBeVisible();
    await expect(page.locator(".toast-viewport")).toHaveCount(0);
    await page
      .locator("label.switch")
      .filter({ has: page.getByRole("checkbox", { name: "启用 coat.npk", exact: true }) })
      .click();
    await expect(page.getByRole("checkbox", { name: "停用 coat.npk", exact: true })).toBeChecked();
    await expect(readFile(join(gameRoot, "coat.npk"), "utf8")).resolves.toBe("coat-payload");
    await page.getByRole("button", { name: "设置" }).click();
    await page.getByRole("button", { name: "浏览", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("请先停用所有补丁，再更换游戏目录");
    await page.locator(".dialog-backdrop-dismiss").click();

    await application.close();
    const restarted = await launch();
    try {
      const restartedPage = await restarted.firstWindow();
      await restartedPage.getByRole("button", { name: "设置" }).click();
      await expect(restartedPage.getByRole("textbox", { name: "游戏目录" })).toHaveValue(gameRoot);
      await restartedPage.locator(".dialog-backdrop-dismiss").click();
      await rm(join(gameRoot, "coat.npk"));
      await restartedPage
        .locator("label.switch")
        .filter({
          has: restartedPage.getByRole("checkbox", { name: "停用 coat.npk", exact: true }),
        })
        .click();
      await expect(
        restartedPage.getByRole("checkbox", { name: "启用 coat.npk", exact: true }),
      ).not.toBeChecked();
      await expect(restartedPage.locator(".toast-viewport")).toHaveCount(0);
      await expect(access(join(gameRoot, "coat.npk"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await restarted.close();
    }
  } finally {
    if (application.windows().length > 0) await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("selects patch cards by dragging from empty workspace space", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-workspace-selection-e2e-"));
  const libraryRoot = join(runtimeRoot, "patch-categories");
  await mkdir(libraryRoot, { recursive: true });
  await Promise.all([
    writeFile(join(libraryRoot, "coat.npk"), "coat-payload"),
    writeFile(join(libraryRoot, "sword.npk"), "sword-payload"),
    writeFile(join(libraryRoot, "shield.npk"), "shield-payload"),
  ]);
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });

  try {
    const page = await application.firstWindow();
    await page.setViewportSize({ width: 1280, height: 720 });
    const workspace = page.locator("main.patch-workspace");
    const cards = page.locator(".item-grid .item-card");
    await expect(cards).toHaveCount(3);

    const workspaceBox = await workspace.boundingBox();
    const firstCardBox = await cards.nth(0).boundingBox();
    const secondCardBox = await cards.nth(1).boundingBox();
    expect(workspaceBox).not.toBeNull();
    expect(firstCardBox).not.toBeNull();
    expect(secondCardBox).not.toBeNull();
    if (workspaceBox === null || firstCardBox === null || secondCardBox === null) {
      throw new Error("Workspace or cards did not expose visible bounding boxes");
    }

    const startX = Math.max(workspaceBox.x + 2, firstCardBox.x - 12);
    const startY = firstCardBox.y - 12;
    const endX = secondCardBox.x + secondCardBox.width + 12;
    const endY = secondCardBox.y + secondCardBox.height + 12;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(endX, endY, { steps: 8 });
    await expect(page.locator(".selection-box")).toBeVisible();
    await page.mouse.up();

    await expect(cards.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(cards.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(cards.nth(2)).toHaveAttribute("aria-pressed", "false");
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

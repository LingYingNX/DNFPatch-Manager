import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("keeps the BK2 hover video the same size as the NPK hover image in list view", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-list-hover-preview-e2e-"));
  const libraryRoot = join(runtimeRoot, "patch-categories");
  await mkdir(libraryRoot, { recursive: true });
  await Promise.all([
    writeFile(join(libraryRoot, "coat.npk"), "coat-payload"),
    writeFile(join(libraryRoot, "coat.png"), ONE_PIXEL_PNG),
    writeFile(join(libraryRoot, "clip.bk2"), "clip-payload"),
    writeFile(join(libraryRoot, "clip.png"), ONE_PIXEL_PNG),
    writeFile(join(libraryRoot, "clip.mp4"), "clip-video-payload"),
  ]);
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });

  try {
    const page = await application.firstWindow();
    await page.getByRole("main", { name: "补丁工作区" }).waitFor();
    await page.getByRole("button", { name: "列表视图" }).click();

    const zoomWidth = async (itemName: string, zoomSelector: string): Promise<number> => {
      const card = page.getByRole("button", { name: itemName, exact: true });
      const shell = card.locator("xpath=..");
      // 悬停区默认 opacity: 0 且 pointer-events: none，先悬停卡片本体让它变可命中。
      await card.hover();
      await shell.locator(".item-preview-hover-zone").hover();
      const zoom = shell.locator(zoomSelector);
      await expect
        .poll(() =>
          zoom.evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity)),
        )
        .toBeGreaterThan(0.99);
      const box = await zoom.boundingBox();
      if (box === null) {
        throw new Error(`${itemName} hover preview did not expose a visible bounding box`);
      }
      await page.mouse.move(0, 0);
      return box.width;
    };

    // 两个宽度分别落在不同的 @container 分支，确保每个分支里视频与图片都成对收窄。
    for (const viewportWidth of [1280, 800]) {
      await page.setViewportSize({ width: viewportWidth, height: 720 });
      const shellWidth = await page
        .locator(".item-list .item-card-shell")
        .first()
        .evaluate((element) => element.getBoundingClientRect().width);
      const imageWidth = await zoomWidth("coat.npk", ".item-preview-hover-image");
      const videoWidth = await zoomWidth("clip.bk2", ".item-preview-hover-video");

      expect(imageWidth).toBeGreaterThan(0);
      // 列表行是整屏宽，放大位若沿用网格的 200cqw 会铺到约两倍行宽——这正是 BK2 曾经的样子。
      expect(videoWidth).toBeLessThan(shellWidth);
      expect(Math.abs(videoWidth - imageWidth)).toBeLessThan(1);
    }
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

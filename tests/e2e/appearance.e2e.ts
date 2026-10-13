import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("imports and renders the supplied wallpaper across supported viewports", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-appearance-e2e-"));
  const suppliedWallpaper = join(projectRoot, "[wi0a] 91489374.png");
  const wallpaperPath = existsSync(suppliedWallpaper)
    ? suppliedWallpaper
    : join(projectRoot, "前端", "screenshots", "cover.png");
  const screenshotRoot = join(projectRoot, ".scratch", "appearance");
  await mkdir(screenshotRoot, { recursive: true });
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });

  try {
    await application.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
    }, wallpaperPath);
    const page = await application.firstWindow();
    await page.getByRole("button", { name: "调整外观" }).click();
    const appearanceDialog = page.getByRole("dialog", { name: "调整外观" });
    const opacity = page.getByRole("slider", { name: "透明度" });
    // exact：卡片缩放滑块的 aria-label 是「补丁卡片缩放」，子串匹配会同时命中两个 slider
    const scale = page.getByRole("slider", { name: "缩放", exact: true });
    const positionY = page.getByRole("slider", { name: "上下移动" });
    await opacity.press("End");
    await scale.press("Home");
    await positionY.press("Home");
    await expect
      .poll(() =>
        page.evaluate(() => ({
          opacity: document.documentElement.style.getPropertyValue("--wallpaper-opacity"),
          scale: document.documentElement.style.getPropertyValue("--wallpaper-scale"),
          positionY: document.documentElement.style.getPropertyValue("--wallpaper-position-y"),
        })),
      )
      .toEqual({ opacity: "1", scale: "0.5", positionY: "0%" });
    await page.getByRole("button", { name: "选择壁纸 1" }).click();
    await expect(page.locator('.appearance-wallpaper-item[data-active="true"]')).toHaveCount(1);
    await expect(page.getByRole("img", { name: "壁纸 1" })).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.style.getPropertyValue("--wallpaper-image")),
      )
      .toContain("dnf-asset://wallpaper/");
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.style.getPropertyValue("--wallpaper-opacity")),
      )
      .toBe("0.5");
    expect(
      await page.evaluate(() => ({
        sidebar: getComputedStyle(document.querySelector(".category-sidebar") as HTMLElement)
          .backgroundColor,
        workspace: getComputedStyle(
          document.querySelector(
            ".placeholder-workspace, .patch-workspace, .preset-workspace",
          ) as HTMLElement,
        ).backgroundColor,
      })),
    ).toEqual({ sidebar: "rgba(0, 0, 0, 0)", workspace: "rgba(0, 0, 0, 0)" });
    const temperature = page.getByRole("slider", { name: "色温" });
    const positionX = page.getByRole("slider", { name: "左右移动" });
    await expect
      .poll(() =>
        page.evaluate(() => ({
          opacity: document.documentElement.style.getPropertyValue("--wallpaper-opacity"),
          scale: document.documentElement.style.getPropertyValue("--wallpaper-scale"),
          blur: document.documentElement.style.getPropertyValue("--wallpaper-blur"),
          positionY: document.documentElement.style.getPropertyValue("--wallpaper-position-y"),
        })),
      )
      .toEqual({ opacity: "0.5", scale: "1", blur: "0px", positionY: "50%" });
    for (let index = 0; index < 25; index += 1) {
      await temperature.press("ArrowRight");
      await positionX.press("ArrowRight");
      await positionY.press("ArrowLeft");
    }
    await expect
      .poll(() =>
        page.evaluate(() => ({
          temperature: document.documentElement.style.getPropertyValue(
            "--wallpaper-temperature-filter",
          ),
          positionX: document.documentElement.style.getPropertyValue("--wallpaper-position-x"),
          positionY: document.documentElement.style.getPropertyValue("--wallpaper-position-y"),
        })),
      )
      .toEqual({
        temperature: "sepia(0.175) hue-rotate(-9deg)",
        positionX: "75%",
        positionY: "25%",
      });
    const wallpaperStyle = await page.evaluate(() => {
      const appShell = document.querySelector(".app-shell");
      if (appShell === null) throw new Error("app shell missing");
      const wallpaper = getComputedStyle(appShell, "::before");
      return {
        backgroundPosition: wallpaper.backgroundPosition,
        backgroundRepeat: wallpaper.backgroundRepeat,
        backgroundSize: wallpaper.backgroundSize,
        top: Number.parseFloat(wallpaper.top),
        bottom: Number.parseFloat(wallpaper.bottom),
        transformX: new DOMMatrixReadOnly(wallpaper.transform).m41,
        transformY: new DOMMatrixReadOnly(wallpaper.transform).m42,
      };
    });
    expect(wallpaperStyle).toEqual(
      expect.objectContaining({
        backgroundPosition: "50% 50%",
        backgroundRepeat: "no-repeat",
        backgroundSize: "cover",
      }),
    );
    expect(wallpaperStyle.top).toBeLessThan(0);
    expect(wallpaperStyle.bottom).toBeLessThan(0);
    expect(wallpaperStyle.transformX).toBeLessThan(0);
    expect(wallpaperStyle.transformY).toBeGreaterThan(0);
    expect(
      await page
        .locator('.appearance-wallpaper-item[data-slot="0"] img')
        .evaluate((image: HTMLImageElement) => getComputedStyle(image).objectFit),
    ).toBe("contain");
    const slotList = page.locator(".appearance-wallpaper-slots");
    await expect(slotList.locator('[data-slot="0"]')).toHaveCount(1);
    await expect(slotList.locator('[data-slot="1"] .appearance-wallpaper-placeholder')).toHaveCount(
      1,
    );
    await expect(slotList.locator('[data-slot="1"] .appearance-wallpaper-delete')).toHaveCount(0);
    const firstSlot = slotList.locator('[data-slot="0"]');
    const firstSlotBox = await firstSlot.boundingBox();
    expect(firstSlotBox).not.toBeNull();
    expect((firstSlotBox?.height ?? 0) / (firstSlotBox?.width ?? 1)).toBeCloseTo(9 / 16, 2);
    await expect
      .poll(() => slotList.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.mouse.move(0, 0);
    await expect(firstSlot.locator(".appearance-wallpaper-actions")).toHaveCSS("opacity", "0");
    await firstSlot.hover();
    await expect(firstSlot.locator(".appearance-wallpaper-actions")).toHaveCSS("opacity", "1");
    expect(
      await page
        .locator(".dialog-backdrop")
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ).toBe("rgba(0, 0, 0, 0)");
    const wallpaperDialogBox = await appearanceDialog.boundingBox();
    await page.getByRole("button", { name: "外观主题" }).click();
    const themeDialogBox = await appearanceDialog.boundingBox();
    expect(themeDialogBox).not.toBeNull();
    expect(wallpaperDialogBox).not.toBeNull();
    expect(themeDialogBox?.width).toBe(wallpaperDialogBox?.width);
    expect(themeDialogBox?.height).toBe(wallpaperDialogBox?.height);
    await page.locator(".appearance-theme-card").nth(1).click();
    await expect
      .poll(() =>
        page.evaluate(() => ({
          theme: document.documentElement.dataset["theme"],
          sidebar: getComputedStyle(document.querySelector(".category-sidebar") as HTMLElement)
            .backdropFilter,
          workspace: getComputedStyle(
            document.querySelector(
              ".placeholder-workspace, .patch-workspace, .preset-workspace",
            ) as HTMLElement,
          ).backdropFilter,
        })),
      )
      .toEqual({ theme: "glass", sidebar: "none", workspace: "none" });
    await page.getByRole("button", { name: "字体外观" }).click();
    await expect(page.getByRole("combobox")).toHaveCount(0);
    // 字体外观改成「目标标签页 + 取色器」后，两个颜色目标仍应各有一个标签页
    await expect(page.locator(".appearance-font-tab")).toHaveCount(2);
    await expect(page.locator(".appearance-font-color-picker")).toBeVisible();
    // 字体外观��版回归：颜色设置不得被挤出可视区，右栏无边框，全框只剩一根竖线
    await page.setViewportSize({ width: 1280, height: 720 });
    const fontColors = page.locator(".appearance-font-colors");
    await expect
      .poll(() => fontColors.evaluate((element) => element.scrollHeight - element.clientHeight))
      .toBeLessThanOrEqual(1);
    const hexRowBox = await page.locator(".appearance-font-color-value").boundingBox();
    const fontPanelBox = await page.locator(".appearance-font-panel").boundingBox();
    expect(hexRowBox).not.toBeNull();
    expect(fontPanelBox).not.toBeNull();
    expect((hexRowBox?.y ?? 0) + (hexRowBox?.height ?? 0)).toBeLessThanOrEqual(
      (fontPanelBox?.y ?? 0) + (fontPanelBox?.height ?? 0),
    );
    expect(
      await page
        .locator(".appearance-font-panel")
        .evaluate((element) => getComputedStyle(element).borderTopWidth),
    ).toBe("0px");
    await expect(page.locator(".appearance-font-divider")).toHaveCount(0);
    expect(
      await page
        .locator(".appearance-nav")
        .evaluate((element) => getComputedStyle(element).borderRightWidth),
    ).toBe("1px");
    await page.getByRole("button", { name: "静态壁纸" }).click();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.screenshot({ path: join(screenshotRoot, "settings-1280x720.png") });
    await page.mouse.click(5, 5);
    await expect(appearanceDialog).not.toBeVisible();

    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1440, height: 900 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      await expect
        .poll(() =>
          page.evaluate(() => ({
            client: document.documentElement.clientWidth,
            scroll: document.documentElement.scrollWidth,
          })),
        )
        .toEqual({ client: viewport.width, scroll: viewport.width });
      await page.screenshot({
        path: join(screenshotRoot, `wallpaper-${viewport.width}x${viewport.height}.png`),
      });
    }
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

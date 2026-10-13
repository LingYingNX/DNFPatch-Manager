import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("supports the custom title bar window controls", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-window-titlebar-e2e-"));
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });

  const isMaximized = () =>
    application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMaximized());
  const isMinimized = () =>
    application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMinimized());

  try {
    const page = await application.firstWindow();
    const dragRegion = page.getByTestId("window-titlebar-drag-region");
    const controls = page.locator(".window-controls");
    const minimizeButton = page.getByRole("button", { name: "最小化", exact: true });
    const maximizeButton = page.getByRole("button", { name: "最大化", exact: true });
    const closeButton = page.getByRole("button", { name: "关闭", exact: true });

    await expect(page.getByRole("main", { name: "补丁工作区" })).toBeVisible();
    await expect(dragRegion).toBeVisible();
    await expect(page.getByText("作者：铃音奈绪")).toBeVisible();
    await expect(minimizeButton).toBeVisible();
    await expect(maximizeButton).toBeVisible();
    await expect(closeButton).toBeVisible();

    const regionStyles = await dragRegion.evaluate((element) => ({
      appRegion: getComputedStyle(element).getPropertyValue("-webkit-app-region"),
      userSelect: getComputedStyle(element).userSelect,
    }));
    const controlStyles = await controls.evaluate((element) =>
      getComputedStyle(element).getPropertyValue("-webkit-app-region"),
    );
    const titlebarBackground = await page
      .locator(".window-titlebar")
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(regionStyles.appRegion).toBe("drag");
    expect(regionStyles.userSelect).toBe("none");
    expect(controlStyles).toBe("no-drag");
    expect(titlebarBackground).toContain("rgba");

    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const closeBox = await closeButton.boundingBox();
    const titlebarBox = await page.locator(".window-titlebar").boundingBox();
    expect(closeBox).not.toBeNull();
    expect(titlebarBox).not.toBeNull();
    if (closeBox === null || titlebarBox === null) {
      throw new Error("Title bar controls did not expose visible bounds");
    }
    expect(Math.abs(viewport.width - closeBox.x - closeBox.width)).toBeLessThan(1);
    expect(Math.abs(closeBox.y - titlebarBox.y)).toBeLessThan(1);
    expect(Math.abs(closeBox.height - titlebarBox.height)).toBeLessThan(1);
    const controlDimensions = await controls.locator("button").evaluateAll((buttons) =>
      buttons.map((button) => {
        const styles = getComputedStyle(button);
        return {
          borderTopLeftRadius: styles.borderTopLeftRadius,
          height: styles.height,
          width: styles.width,
        };
      }),
    );
    expect(controlDimensions.map(({ width }) => width)).toEqual(["40px", "40px", "40px"]);
    expect(controlDimensions.map(({ height }) => height)).toEqual(["36px", "36px", "36px"]);
    expect(controlDimensions.map(({ borderTopLeftRadius }) => borderTopLeftRadius)).toEqual([
      "0px",
      "0px",
      "0px",
    ]);

    for (const button of [minimizeButton, maximizeButton]) {
      const controlHoverBackground = await button.evaluate((element) => {
        const probe = document.createElement("span");
        element.append(probe);
        probe.style.backgroundColor =
          "color-mix(in srgb, var(--color-primary) 24%, var(--color-elevated))";
        const background = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return background;
      });
      await button.hover();
      await expect
        .poll(() => button.evaluate((element) => getComputedStyle(element).backgroundColor))
        .toBe(controlHoverBackground);
    }

    expect(await isMaximized()).toBe(false);
    await maximizeButton.click();
    await expect(page.getByRole("button", { name: "还原", exact: true })).toBeVisible();
    await expect.poll(isMaximized).toBe(true);

    await page.getByRole("button", { name: "还原", exact: true }).click();
    await expect(maximizeButton).toBeVisible();
    await expect.poll(isMaximized).toBe(false);

    await dragRegion.dblclick();
    await expect(page.getByRole("button", { name: "还原", exact: true })).toBeVisible();
    await expect.poll(isMaximized).toBe(true);

    await page.getByRole("button", { name: "还原", exact: true }).click();
    await expect(maximizeButton).toBeVisible();
    await expect.poll(isMaximized).toBe(false);

    await minimizeButton.click();
    await expect.poll(isMinimized).toBe(true);
    await application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.restore();
      window?.focus();
    });
    await expect(minimizeButton).toBeVisible();

    await closeButton.click({ noWaitAfter: true }).catch((error: unknown) => {
      if (
        !(error instanceof Error) ||
        !error.message.includes("page, context or browser has been closed")
      ) {
        throw error;
      }
    });
    await expect.poll(() => application.windows().length).toBe(0);
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }

  expect(application.windows()).toHaveLength(0);
});

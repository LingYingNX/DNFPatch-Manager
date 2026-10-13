import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("opens the real patch workspace with the typed desktop API", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-patch-manager-e2e-"));
  const pageErrors: string[] = [];
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });

  try {
    const page = await application.firstWindow();
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const windowChrome = await application.evaluate(({ BrowserWindow, Menu }) => ({
      menu: Menu.getApplicationMenu(),
      title: BrowserWindow.getAllWindows()[0]?.getTitle() ?? null,
    }));
    expect(windowChrome.menu).toBeNull();
    expect(windowChrome.title).toBe("");
    await expect(page).toHaveTitle("");
    await expect(page.getByRole("main", { name: "补丁工作区" })).toBeVisible();
    await expect(page.getByRole("region", { name: "空补丁库" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "选择 NPK 文件" })).toHaveCount(0);
    await expect(page.getByText("桌面接口不可用，请重新启动应用。")).toHaveCount(0);
    await expect(page.getByText("扫描补丁库失败，磁盘内容未被修改。")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => typeof window.dnf)).toBe("object");
    expect(pageErrors).toEqual([]);
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true });
  }
});

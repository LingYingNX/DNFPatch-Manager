import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("keeps the custom category order after renaming a folder", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-rename-order-e2e-"));
  const libraryRoot = join(runtimeRoot, "patch-categories");
  // 目录名与默认名称排序相反，便于区分"保持自定义顺序"与"退回按名称排序"。
  await mkdir(join(libraryRoot, "Zeta"), { recursive: true });
  await mkdir(join(libraryRoot, "Alpha"), { recursive: true });
  await mkdir(join(libraryRoot, "Middle"), { recursive: true });

  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });
  try {
    const page = await application.firstWindow();
    await page.getByRole("main", { name: "补丁工作区" }).waitFor();

    const sidebar = page.getByRole("navigation", { name: "补丁分类" });
    const rowOrder = async (): Promise<readonly string[]> =>
      sidebar
        .locator(".category-tree .category-row")
        .evaluateAll((rows) =>
          rows
            .map((row) => (row.textContent ?? "").replace(/\s+/gu, " ").trim())
            .filter((text) => /^(Zeta|Alpha|Middle|Renamed)\d*$/u.test(text)),
        );

    await expect(sidebar.getByRole("button", { name: "Zeta", exact: true })).toBeVisible();
    const defaultOrder = await rowOrder();
    // 空分类不再渲染计数徽标（25186d4 起），行文本就是分类名
    expect(defaultOrder).toEqual(["Alpha", "Middle", "Zeta"]);

    // 写入自定义顺序 Zeta 在前，与名称排序相反。
    const saved = await page.evaluate(() =>
      window.dnf.setCategoryOrder({
        parentRelativePath: "",
        orderedChildRelativePaths: ["Zeta", "Alpha", "Middle"],
      }),
    );
    expect(saved).toMatchObject({ ok: true });
    // 直接调 IPC 绕过了渲染层的重新扫描，重载后从磁盘读回自定义顺序。
    await page.reload();
    await page.getByRole("main", { name: "补丁工作区" }).waitFor();
    await expect.poll(async () => (await rowOrder())[0]).toBe("Zeta");
    const customOrder = await rowOrder();
    expect(customOrder).toEqual(["Zeta", "Alpha", "Middle"]);

    // 重命名 Zeta -> Renamed：应停在原位，而不是按名称重新插入。
    await sidebar.getByRole("button", { name: "Zeta", exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "重命名" }).click();
    const input = page.getByRole("textbox", { name: "重命名 Zeta" });
    await input.fill("Renamed");
    await input.press("Enter");

    await expect(sidebar.getByRole("button", { name: "Renamed", exact: true })).toBeVisible();
    await expect.poll(async () => (await rowOrder())[0]).toBe("Renamed");
    const afterRename = await rowOrder();
    expect(afterRename).toEqual(["Renamed", "Alpha", "Middle"]);
  } finally {
    await application.close();
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

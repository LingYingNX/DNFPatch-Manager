import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const HOVER_RING = "rgb(183, 214, 255) 0px 0px 0px 1px inset";
const SELECTED_RING = "rgb(160, 107, 255) 0px 0px 0px 1.6px inset";

type RowRing = {
  readonly background: string;
  readonly boxShadow: string;
};

async function rowRing(locator: import("@playwright/test").Locator): Promise<RowRing> {
  return locator.evaluate((node) => {
    const computed = getComputedStyle(node);
    return { background: computed.backgroundColor, boxShadow: computed.boxShadow };
  });
}

test("keeps folder rows to a border ring: hover light blue, selected purple", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-category-ring-e2e-"));
  const libraryRoot = join(runtimeRoot, "patch-categories");
  await mkdir(join(libraryRoot, "分类A"), { recursive: true });
  await mkdir(join(libraryRoot, "分类B"), { recursive: true });

  // --user-data-dir（等号形式）让单实例锁与用户正在运行的应用隔离，避免 e2e 实例被挤出。
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });
  try {
    const page = await application.firstWindow();
    await page.getByRole("main", { name: "补丁工作区" }).waitFor();
    const folder = page.getByRole("button", { name: "分类A", exact: true });
    await folder.waitFor();

    // 悬停只画一圈浅蓝细线，不再用背景填充整行。
    // box-shadow 带 120ms 过渡，轮询到终值再断言，避免采样落在过渡中间。
    await folder.hover();
    await expect
      .poll(() => rowRing(folder))
      .toEqual({
        background: "rgba(0, 0, 0, 0)",
        boxShadow: HOVER_RING,
      });

    // 选中改为紫色加粗线框；1.6px 走 box-shadow 是因为 Blink 会把 border-width 取整到 1px。
    await folder.click();
    await expect(folder).toHaveClass(/selected/u);
    await expect
      .poll(() => rowRing(folder))
      .toEqual({
        background: "rgba(0, 0, 0, 0)",
        boxShadow: SELECTED_RING,
      });

    // 重命名沿用同一圈紫色线框，并像 Windows 一样全选整个名字，直接输入即可覆盖。
    await folder.click({ button: "right" });
    await page.getByRole("menuitem", { name: "重命名" }).click();
    const input = page.getByRole("textbox", { name: "重命名 分类A" });
    await expect(input).toBeVisible();
    await expect
      .poll(() => rowRing(page.locator(".category-row-editing")))
      .toEqual({
        background: "rgba(0, 0, 0, 0)",
        boxShadow: SELECTED_RING,
      });
    await expect(input).toHaveJSProperty("selectionStart", 0);
    await expect(input).toHaveJSProperty("selectionEnd", "分类A".length);
  } finally {
    await application.close();
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

test("keeps the selected ring when the sidebar or workspace blank space is pressed", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-category-ring-blank-e2e-"));
  const libraryRoot = join(runtimeRoot, "patch-categories");
  await mkdir(join(libraryRoot, "分类A"), { recursive: true });
  await mkdir(join(libraryRoot, "分类B"), { recursive: true });

  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });
  try {
    const page = await application.firstWindow();
    const workspace = page.getByRole("main", { name: "补丁工作区" });
    await workspace.waitFor();
    const folder = page.getByRole("button", { name: "分类A", exact: true });
    await folder.waitFor();

    // 侧栏留白：分类行下面的空白区（不是行、不是按钮）。
    await folder.click();
    await expect(folder).toHaveClass(/selected/u);
    const sidebar = page.getByRole("navigation", { name: "补丁分类" });
    const sidebarBox = await sidebar.boundingBox();
    if (sidebarBox === null) throw new Error("Sidebar did not expose coordinates");
    await page.mouse.click(
      sidebarBox.x + sidebarBox.width / 2,
      sidebarBox.y + sidebarBox.height - 12,
    );
    await expect(folder).toHaveClass(/selected/u);
    // 环的实际画法由上面的用例覆盖；这里只确认它仍然保持选中环。
    await expect.poll(() => rowRing(folder).then((ring) => ring.boxShadow)).toBe(SELECTED_RING);

    // 主区留白：分类里没有补丁，空状态占满主区，点它同样是点空白。
    await folder.click();
    await expect(folder).toHaveClass(/selected/u);
    const workspaceBox = await workspace.boundingBox();
    if (workspaceBox === null) throw new Error("Workspace did not expose coordinates");
    await page.mouse.click(workspaceBox.x + 12, workspaceBox.y + workspaceBox.height - 12);
    await expect(folder).toHaveClass(/selected/u);

    // 再次点击同一分类仍保持选中。
    await folder.click();
    await expect(folder).toHaveClass(/selected/u);
  } finally {
    await application.close();
    await rm(runtimeRoot, { recursive: true, force: true });
  }
});

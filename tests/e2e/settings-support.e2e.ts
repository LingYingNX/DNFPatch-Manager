import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("renders the community entries within the settings dialog", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-settings-support-e2e-"));
  const screenshotRoot = join(projectRoot, ".scratch", "settings-support");
  await mkdir(screenshotRoot, { recursive: true });
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });

  try {
    const page = await application.firstWindow();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole("button", { name: "设置" }).click();
    await page.getByRole("tab", { name: "关于软件" }).click();

    const dialog = page.getByRole("dialog", { name: "设置" });
    const supportCard = dialog.locator('.settings-support-card[data-support="afdian"]');
    const bilibiliCard = dialog.locator('.settings-support-card[data-support="bilibili"]');
    const supportButton = dialog.getByRole("button", { name: "去赞助" });
    const bilibiliButton = dialog.getByRole("button", { name: "去关注" });
    // "支持与社区" 标题已随设置面板改版移除（见 tests/renderer/appearance-settings.test.tsx
    // 对其 not.toBeInTheDocument 的断言），改为断言实际渲染的支持入口。
    await expect(dialog.getByRole("button", { name: "软件反馈" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "项目地址" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "QQ群交流" })).toBeVisible();
    await expect(dialog.getByText("请作者喝杯咖啡 ☕")).toBeVisible();
    await expect(
      dialog.getByText(
        "本软件完全免费且开源。如果您觉得它有帮助，欢迎前往爱发电给予我持续维护的动力！",
      ),
    ).toBeVisible();
    await expect(dialog.getByText("哔哩哔哩主页")).toBeVisible();
    await expect(dialog.getByText("关注最新动态、视频教程与更新发布")).toBeVisible();
    await expect(supportButton).toBeVisible();
    await expect(bilibiliCard).toBeVisible();
    await expect(bilibiliButton).toBeVisible();

    const changelog = dialog.locator(".settings-changelog-box");
    await changelog.scrollIntoViewIfNeeded();
    const changelogMetrics = await changelog.evaluate((element) => ({
      clientHeight: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
      scrollHeight: element.scrollHeight,
    }));
    expect(changelogMetrics.overflowY).toBe("auto");
    expect(changelogMetrics.scrollHeight).toBeGreaterThan(changelogMetrics.clientHeight);

    const [dialogBox, supportCardBox, bilibiliCardBox, supportButtonBox, bilibiliButtonBox] =
      await Promise.all([
        dialog.boundingBox(),
        supportCard.boundingBox(),
        bilibiliCard.boundingBox(),
        supportButton.boundingBox(),
        bilibiliButton.boundingBox(),
      ]);
    expect(dialogBox).not.toBeNull();
    expect(supportCardBox).not.toBeNull();
    expect(bilibiliCardBox).not.toBeNull();
    expect(supportButtonBox).not.toBeNull();
    expect(bilibiliButtonBox).not.toBeNull();
    if (
      dialogBox === null ||
      supportCardBox === null ||
      bilibiliCardBox === null ||
      supportButtonBox === null ||
      bilibiliButtonBox === null
    ) {
      throw new Error("Settings support entry did not expose visible bounds");
    }
    expect(supportCardBox.x).toBeGreaterThanOrEqual(dialogBox.x);
    expect(supportCardBox.x + supportCardBox.width).toBeLessThanOrEqual(
      dialogBox.x + dialogBox.width,
    );
    expect(supportButtonBox.x + supportButtonBox.width).toBeLessThanOrEqual(
      supportCardBox.x + supportCardBox.width,
    );
    expect(bilibiliButtonBox.x + bilibiliButtonBox.width).toBeLessThanOrEqual(
      bilibiliCardBox.x + bilibiliCardBox.width,
    );
    expect(supportCardBox.height).toBe(bilibiliCardBox.height);
    expect(supportButtonBox.x).toBe(bilibiliButtonBox.x);
    expect(supportButtonBox.width).toBe(bilibiliButtonBox.width);

    await page.screenshot({ path: join(screenshotRoot, "settings-support-1280x720.png") });
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

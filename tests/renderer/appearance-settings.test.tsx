import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/renderer/App";
import { createFakeApi, WORKSPACE_SNAPSHOT } from "./fake-api";

const tokensCss = readFileSync(resolve(process.cwd(), "src/renderer/styles/tokens.css"), "utf8");
const layoutCss = readFileSync(resolve(process.cwd(), "src/renderer/styles/layout.css"), "utf8");

describe("appearance settings", () => {
  afterEach(cleanup);
  it("separates directory settings from the appearance controls", async () => {
    render(<App api={createFakeApi(WORKSPACE_SNAPSHOT)} />);

    fireEvent.click(await screen.findByRole("button", { name: "设置" }));

    const settingsDialog = screen.getByRole("dialog", { name: "设置" });
    expect(within(settingsDialog).getByRole("tab", { name: "常规设置" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(within(settingsDialog).getByText("游戏目录")).toBeInTheDocument();
    fireEvent.click(within(settingsDialog).getByRole("tab", { name: "关于软件" }));
    expect(
      within(settingsDialog).queryByRole("heading", { name: "支持与社区" }),
    ).not.toBeInTheDocument();
    expect(within(settingsDialog).getByRole("button", { name: "软件反馈" })).toBeInTheDocument();
    expect(within(settingsDialog).getByRole("button", { name: "项目地址" })).toBeInTheDocument();
    expect(within(settingsDialog).getByRole("button", { name: "QQ群交流" })).toBeInTheDocument();
    expect(within(settingsDialog).getByText("请作者喝杯咖啡 ☕")).toBeInTheDocument();
    expect(within(settingsDialog).getByText("哔哩哔哩主页")).toBeInTheDocument();
    expect(within(settingsDialog).getByRole("button", { name: "去赞助" })).toBeInTheDocument();
    expect(within(settingsDialog).getByRole("button", { name: "去关注" })).toBeInTheDocument();
    expect(within(settingsDialog).getByRole("heading", { name: "软件更新" })).toBeInTheDocument();
    expect(within(settingsDialog).getByText("更新说明")).toBeInTheDocument();
    expect(within(settingsDialog).getByText("当前版本 v1.1.0")).toBeInTheDocument();
    expect(
      within(settingsDialog).queryByRole("progressbar", { name: "更新进度" }),
    ).not.toBeInTheDocument();
    expect(within(settingsDialog).getByText(/已检测到新版本/u)).toBeInTheDocument();
    expect(
      settingsDialog.querySelector(".settings-update-progress-placeholder"),
    ).not.toBeInTheDocument();
    expect(within(settingsDialog).queryAllByRole("slider")).toHaveLength(0);
    expect(screen.queryByRole("dialog", { name: "调整外观" })).not.toBeInTheDocument();

    fireEvent.click(within(settingsDialog).getByRole("button", { name: "关闭对话框" }));
    fireEvent.click(screen.getByRole("button", { name: "调整外观" }));

    const appearanceDialog = screen.getByRole("dialog", { name: "调整外观" });
    expect(within(appearanceDialog).getAllByRole("slider")).toHaveLength(8);
    expect(
      within(appearanceDialog).getAllByRole("button", { name: /^选择壁纸 \d$/u }),
    ).toHaveLength(5);
    expect(
      within(appearanceDialog).queryAllByRole("button", { name: /^删除壁纸 \d$/u }),
    ).toHaveLength(0);
    expect(within(appearanceDialog).getAllByTestId("wallpaper-placeholder")).toHaveLength(5);

    fireEvent.click(within(appearanceDialog).getByRole("button", { name: "外观主题" }));
    expect(within(appearanceDialog).getByRole("region", { name: "外观主题" })).toBeInTheDocument();
    expect(within(appearanceDialog).queryByText("选择应用外观主题")).not.toBeInTheDocument();
    expect(within(appearanceDialog).queryByText("界面颜色")).not.toBeInTheDocument();
    expect(within(appearanceDialog).queryAllByRole("slider")).toHaveLength(0);
  });

  it("opens the official support links from settings", async () => {
    const api = createFakeApi(WORKSPACE_SNAPSHOT);
    const openExternalUrl = vi.fn(api.openExternalUrl);
    render(<App api={{ ...api, openExternalUrl }} />);

    fireEvent.click(await screen.findByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("tab", { name: "关于软件" }));
    fireEvent.click(screen.getByRole("button", { name: "软件反馈" }));
    await waitFor(() =>
      expect(openExternalUrl).toHaveBeenLastCalledWith({
        url: "https://docs.qq.com/smartsheet/DRXZyb2N2eUFmWHVC",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "项目地址" }));
    await waitFor(() =>
      expect(openExternalUrl).toHaveBeenLastCalledWith({
        url: "https://github.com/LingYingNX/DNFguanliqi",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "QQ群交流" }));
    await waitFor(() =>
      expect(openExternalUrl).toHaveBeenLastCalledWith({
        url: "https://qm.qq.com/q/ZxPw28W7eg",
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "去赞助" }));
    await waitFor(() =>
      expect(openExternalUrl).toHaveBeenLastCalledWith({ url: "https://afdian.com/a/naixu" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "去关注" }));
    await waitFor(() =>
      expect(openExternalUrl).toHaveBeenLastCalledWith({
        url: "https://space.bilibili.com/41344302",
      }),
    );
  });

  it("checks for a new version and tracks the download flow", async () => {
    render(<App api={createFakeApi(WORKSPACE_SNAPSHOT)} />);

    fireEvent.click(await screen.findByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("tab", { name: "关于软件" }));

    const settingsDialog = screen.getByRole("dialog", { name: "设置" });
    fireEvent.click(within(settingsDialog).getByRole("button", { name: "检查更新" }));

    expect(
      await screen.findByRole("status", { name: /发现新版本.*v9\.9\.9/u }),
    ).toBeInTheDocument();
    expect(within(settingsDialog).queryByText(/最新版本/u)).not.toBeInTheDocument();
    expect(
      within(settingsDialog).getByText("新增项目地址与QQ群交流入口，优化软件更新提示。"),
    ).toBeInTheDocument();
    expect(screen.queryByText("当前版本发行说明")).not.toBeInTheDocument();
    fireEvent.click(within(settingsDialog).getByRole("button", { name: "立即更新" }));
    const progress = within(settingsDialog).getByRole("progressbar", { name: "更新进度" });
    await waitFor(() => expect(progress).toHaveValue(100));
    expect(within(settingsDialog).getByRole("button", { name: "重启安装" })).toBeInTheDocument();
  });

  it("hides the update notice when no update is available", async () => {
    const api = createFakeApi(WORKSPACE_SNAPSHOT);
    const check = async () => ({
      ok: true as const,
      value: {
        currentVersion: "1.1.0",
        latestVersion: "1.1.0",
        updateAvailable: false,
        releaseNotes: [],
      },
    });
    const noUpdateApi = { ...api, update: { ...api.update, check } };

    render(<App api={noUpdateApi} />);

    fireEvent.click(await screen.findByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("tab", { name: "关于软件" }));

    const settingsDialog = screen.getByRole("dialog", { name: "设置" });
    fireEvent.click(within(settingsDialog).getByRole("button", { name: "检查更新" }));

    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(within(settingsDialog).getByText("当前版本 v1.1.0")).toBeInTheDocument();
    expect(within(settingsDialog).getByText("当前版本发行说明")).toBeInTheDocument();
    expect(within(settingsDialog).queryByText(/最新版本/u)).not.toBeInTheDocument();
    // 已是最新版时右上角版本徽章已表达该信息，卡片内不再重复提示状态行。
    expect(within(settingsDialog).queryByText("当前版本已是最新版")).not.toBeInTheDocument();
    expect(within(settingsDialog).queryByText("点击检查更新获取最新版本")).not.toBeInTheDocument();
    // 状态区整块收起，让"检查更新/立即更新"紧贴说明框，不再隔着空白。
    expect(settingsDialog.querySelector(".settings-update-progress-stack")).toBeNull();
    expect(settingsDialog.querySelector(".settings-update-actions")).not.toBeNull();
    expect(
      settingsDialog.querySelector(".settings-update-progress-placeholder"),
    ).not.toBeInTheDocument();
    expect(within(settingsDialog).getByRole("button", { name: "立即更新" })).toBeDisabled();
  });

  it("keeps the update-available notice until it is dismissed", async () => {
    render(<App api={createFakeApi(WORKSPACE_SNAPSHOT)} />);

    fireEvent.click(await screen.findByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("tab", { name: "关于软件" }));
    const settingsDialog = screen.getByRole("dialog", { name: "设置" });

    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(within(settingsDialog).getByRole("button", { name: "检查更新" }));
      });
      expect(screen.getByRole("status", { name: /发现新版本.*v9\.9\.9/u })).toBeInTheDocument();

      // 发现新版本不能自动消失：启动检查可能比窗口晚出现，自动淡出会让用户错过。
      act(() => vi.advanceTimersByTime(8000));
      expect(screen.getByRole("status", { name: /发现新版本.*v9\.9\.9/u })).toBeInTheDocument();

      act(() => {
        fireEvent.click(screen.getByRole("button", { name: "关闭更新提示" }));
      });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("auto-hides the up-to-date notice after five seconds", async () => {
    const api = createFakeApi(WORKSPACE_SNAPSHOT);
    const check = async () => ({
      ok: true as const,
      value: {
        currentVersion: "1.1.0",
        latestVersion: "1.1.0",
        updateAvailable: false,
        releaseNotes: [],
      },
    });
    render(<App api={{ ...api, update: { ...api.update, check } }} />);

    fireEvent.click(await screen.findByRole("button", { name: "设置" }));
    fireEvent.click(screen.getByRole("tab", { name: "关于软件" }));
    const settingsDialog = screen.getByRole("dialog", { name: "设置" });

    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(within(settingsDialog).getByRole("button", { name: "检查更新" }));
      });
      expect(screen.getByRole("status", { name: /当前已是最新版/u })).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(5500));
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries the automatic startup check when it fails", async () => {
    const api = createFakeApi(WORKSPACE_SNAPSHOT);
    let attempts = 0;
    const failingCheck = async () => {
      attempts += 1;
      return {
        ok: false as const,
        error: { code: "UPDATE_CHECK_FAILED", message: "检查更新失败" },
      };
    };

    vi.useFakeTimers();
    try {
      render(<App api={{ ...api, update: { ...api.update, check: failingCheck } }} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(attempts).toBe(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(attempts).toBe(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(attempts).toBe(3);
      // 两次重试都失败后不再无限重试。
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });
      expect(attempts).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the close control in the content toolbar and closes on backdrop click", async () => {
    render(<App api={createFakeApi(WORKSPACE_SNAPSHOT)} />);

    fireEvent.click(await screen.findByRole("button", { name: "调整外观" }));

    const appearanceDialog = screen.getByRole("dialog", { name: "调整外观" });
    const resetButton = within(appearanceDialog).getByRole("button", { name: "恢复默认" });
    const closeButton = within(appearanceDialog).getByRole("button", { name: "关闭对话框" });
    expect(closeButton.parentElement).toBe(resetButton.parentElement);

    fireEvent.click(appearanceDialog);
    expect(screen.getByRole("dialog", { name: "调整外观" })).toBeInTheDocument();

    const backdrop = appearanceDialog.parentElement;
    expect(backdrop).not.toBeNull();
    const backdropDismiss = backdrop?.querySelector<HTMLButtonElement>(".dialog-backdrop-dismiss");
    expect(backdropDismiss).not.toBeNull();
    fireEvent.click(backdropDismiss as HTMLButtonElement);
    expect(screen.queryByRole("dialog", { name: "调整外观" })).not.toBeInTheDocument();
  });

  it("applies appearance values to CSS variables immediately", async () => {
    const api = createFakeApi(WORKSPACE_SNAPSHOT);
    const update = vi.fn(api.updateAppearance);
    render(<App api={{ ...api, updateAppearance: update }} />);
    fireEvent.click(await screen.findByRole("button", { name: "调整外观" }));

    fireEvent.change(screen.getByRole("slider", { name: /透明度/u }), {
      target: { value: "62" },
    });

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(document.documentElement.style.getPropertyValue("--wallpaper-opacity")).toBe("0.62");
  });

  it("applies temperature and position controls to persisted values and CSS variables", async () => {
    const api = createFakeApi(WORKSPACE_SNAPSHOT);
    const update = vi.fn(api.updateAppearance);
    render(<App api={{ ...api, updateAppearance: update }} />);
    fireEvent.click(await screen.findByRole("button", { name: "调整外观" }));

    fireEvent.change(screen.getByRole("slider", { name: /色温/u }), {
      target: { value: "75" },
    });
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ temperature: 50 })),
    );
    expect(
      document.documentElement.style.getPropertyValue("--wallpaper-temperature-filter"),
    ).toContain("sepia");

    fireEvent.change(screen.getByRole("slider", { name: /对比度/u }), {
      target: { value: "0" },
    });
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ contrast: 0 })),
    );
    expect(document.documentElement.style.getPropertyValue("--appearance-contrast")).toBe("50%");

    fireEvent.change(screen.getByRole("slider", { name: /左右移动/u }), {
      target: { value: "75" },
    });
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ positionX: 75 })),
    );
    expect(document.documentElement.style.getPropertyValue("--wallpaper-position-x")).toBe("75%");
    expect(
      Number.parseFloat(document.documentElement.style.getPropertyValue("--wallpaper-offset-x")),
    ).toBeLessThan(-8);

    fireEvent.change(screen.getByRole("slider", { name: /上下移动/u }), {
      target: { value: "25" },
    });
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ positionY: 25 })),
    );
    expect(document.documentElement.style.getPropertyValue("--wallpaper-position-y")).toBe("25%");
    expect(
      Number.parseFloat(document.documentElement.style.getPropertyValue("--wallpaper-offset-y")),
    ).toBeGreaterThan(8);
  });

  it("imports wallpaper from the blank slot area and adjusts sliders with the wheel", async () => {
    const api = createFakeApi(WORKSPACE_SNAPSHOT);
    const importWallpaper = vi.fn(api.importWallpaper);
    const update = vi.fn(api.updateAppearance);
    render(<App api={{ ...api, importWallpaper, updateAppearance: update }} />);
    fireEvent.click(await screen.findByRole("button", { name: "调整外观" }));

    expect(screen.getByRole("slider", { name: /透明度/u })).toHaveValue("50");
    expect(screen.getByRole("slider", { name: /模糊度/u })).toHaveValue("0");
    expect(screen.getByRole("slider", { name: /饱和度/u })).toHaveValue("50");

    fireEvent.click(screen.getByRole("button", { name: "选择壁纸 1" }));
    expect(importWallpaper).toHaveBeenCalledWith({ slot: 0 });
    expect(await screen.findByRole("img", { name: "壁纸 1" })).toHaveAttribute(
      "src",
      "dnf-asset://wallpaper/imported-wallpaper.jpg",
    );

    fireEvent.wheel(screen.getByRole("slider", { name: /饱和度/u }), { deltaY: -100 });
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ saturation: 104 })),
    );

    fireEvent.wheel(screen.getByRole("slider", { name: /模糊度/u }), { deltaY: -100 });
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ blur: 1 })),
    );
  });

  it("renders a thumbnail for a populated wallpaper slot", async () => {
    const api = createFakeApi(WORKSPACE_SNAPSHOT);
    const initial = await api.getAppearance();
    if (!initial.ok) throw new Error("appearance fixture failed");
    const getAppearance = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        ...initial.value,
        wallpaper: {
          slots: ["7709850.jpg", null, null, null, null] as [
            string | null,
            string | null,
            string | null,
            string | null,
            string | null,
          ],
          activeSlot: 0,
        },
      },
    });
    render(<App api={{ ...api, getAppearance }} />);

    fireEvent.click(await screen.findByRole("button", { name: "调整外观" }));

    expect(await screen.findByRole("img", { name: "壁纸 1" })).toHaveAttribute(
      "src",
      "dnf-asset://wallpaper/7709850.jpg",
    );
    expect(
      within(screen.getByRole("dialog", { name: "调整外观" })).getAllByTestId(
        "wallpaper-placeholder",
      ),
    ).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: "删除壁纸 1" })).toHaveLength(1);
  });

  it("persists a selected theme and restores wallpaper defaults", async () => {
    const api = createFakeApi(WORKSPACE_SNAPSHOT);
    const update = vi.fn(api.updateAppearance);
    render(<App api={{ ...api, updateAppearance: update }} />);
    fireEvent.click(await screen.findByRole("button", { name: "调整外观" }));

    fireEvent.click(screen.getByRole("button", { name: "外观主题" }));
    expect(
      screen
        .getAllByRole("button")
        .filter((button) => button.className.includes("appearance-theme-card")),
    ).toHaveLength(3);
    expect(screen.queryByText("界面颜色")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "透明玻璃" }));
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "glass" })),
    );
    fireEvent.click(screen.getByRole("button", { name: "高对比度" }));
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "high-contrast" })),
    );

    fireEvent.click(screen.getByRole("button", { name: "静态壁纸" }));
    fireEvent.change(screen.getByRole("slider", { name: /透明度/u }), {
      target: { value: "62" },
    });
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));

    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({ opacity: 50, theme: "high-contrast" }),
      ),
    );
  });

  it("lets users configure navigation and patch-card colors", async () => {
    const api = createFakeApi(WORKSPACE_SNAPSHOT);
    const update = vi.fn(api.updateAppearance);
    render(<App api={{ ...api, updateAppearance: update }} />);
    fireEvent.click(await screen.findByRole("button", { name: "调整外观" }));

    fireEvent.click(screen.getByRole("button", { name: "字体外观" }));

    expect(screen.getByTestId("navigation-font-color-picker")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "导航栏透明度" })).toBeInTheDocument();
    expect(
      within(screen.getByTestId("navigation-font-color-picker")).getByRole("textbox"),
    ).toHaveValue("#F2F4F8FF");
    expect(screen.getByRole("tab", { name: /补丁卡片/ })).toBeInTheDocument();
    expect(screen.queryByText("实时预览")).not.toBeInTheDocument();

    fireEvent.change(
      within(screen.getByTestId("navigation-font-color-picker")).getByRole("textbox"),
      { target: { value: "#12AB34" } },
    );
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({ navigationFontColor: "#12AB33FF" }),
      ),
    );
    fireEvent.click(screen.getByRole("tab", { name: /补丁卡片/ }));
    expect(screen.getByTestId("patch-card-font-color-picker")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "补丁卡片透明度" })).toBeInTheDocument();
    fireEvent.change(
      within(screen.getByTestId("patch-card-font-color-picker")).getByRole("textbox"),
      { target: { value: "#34AB12" } },
    );
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({ patchCardFontColor: "#33AB12FF" }),
      ),
    );
    expect(document.documentElement.style.getPropertyValue("--navigation-font-color")).toBe(
      "#12AB33FF",
    );
    expect(document.documentElement.style.getPropertyValue("--patch-card-font-color")).toBe(
      "#33AB12FF",
    );
    expect(document.documentElement.style.getPropertyValue("--color-text-primary")).toBe("");
    expect(tokensCss).toMatch(/:root\s*\{[\s\S]*color:\s*var\(--color-text-primary\);/u);
    expect(layoutCss).toContain(".sidebar-system-nav :where(.category-row > span)");
    expect(layoutCss).not.toMatch(
      /\.category-tree\s*\{[^}]*color:\s*var\(--navigation-font-color\)/u,
    );
  });

  it("supports manual hex editing in the font color wheel", async () => {
    const api = createFakeApi(WORKSPACE_SNAPSHOT);
    const update = vi.fn(api.updateAppearance);
    render(<App api={{ ...api, updateAppearance: update }} />);
    const appearanceButton = document.querySelector<HTMLElement>(".sidebar-appearance-button");
    expect(appearanceButton).not.toBeNull();
    await waitFor(() => expect(document.documentElement.dataset["theme"]).toBe("halo"));
    fireEvent.click(appearanceButton as HTMLElement);
    const appearanceDialog = screen.getByRole("dialog");
    const appearanceTabs =
      appearanceDialog.querySelectorAll<HTMLButtonElement>(".appearance-nav-button");
    fireEvent.click(appearanceTabs[2] as HTMLButtonElement);

    const picker = screen.getByTestId("navigation-font-color-picker");
    const colorInput = picker.querySelector<HTMLInputElement>('input[type="text"]');
    expect(colorInput).not.toBeNull();
    fireEvent.change(colorInput as HTMLInputElement, { target: { value: "#12AB3" } });
    expect(colorInput).toHaveValue("#12AB3");
    fireEvent.blur(colorInput as HTMLInputElement);
    await waitFor(() => expect(colorInput?.value).toMatch(/^#[A-F0-9]{8}$/u));
    fireEvent.change(colorInput as HTMLInputElement, { target: { value: "#12AB34" } });
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({ navigationFontColor: "#12AB33FF" }),
      ),
    );
  });

  it("resets each font color to its default", async () => {
    const api = createFakeApi(WORKSPACE_SNAPSHOT);
    const update = vi.fn(api.updateAppearance);
    render(<App api={{ ...api, updateAppearance: update }} />);
    fireEvent.click(await screen.findByRole("button", { name: "调整外观" }));
    fireEvent.click(screen.getByRole("button", { name: "字体外观" }));

    const navigationPicker = screen.getByTestId("navigation-font-color-picker");
    fireEvent.change(within(navigationPicker).getByRole("textbox"), {
      target: { value: "#12AB34" },
    });
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({ navigationFontColor: "#12AB33FF" }),
      ),
    );

    fireEvent.click(within(navigationPicker).getByRole("button", { name: "重置颜色和透明度" }));
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({ navigationFontColor: "#F2F4F8FF" }),
      ),
    );

    fireEvent.click(screen.getByRole("tab", { name: /补丁卡片/ }));
    const patchCardPicker = screen.getByTestId("patch-card-font-color-picker");
    fireEvent.change(within(patchCardPicker).getByRole("textbox"), {
      target: { value: "#34AB12" },
    });
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({ patchCardFontColor: "#33AB12FF" }),
      ),
    );

    fireEvent.click(within(patchCardPicker).getByRole("button", { name: "重置颜色和透明度" }));
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({ patchCardFontColor: "#F2F4F8FF" }),
      ),
    );
  });

  it("resets font colors to the effective default in high contrast", async () => {
    const api = createFakeApi(WORKSPACE_SNAPSHOT);
    const update = vi.fn(api.updateAppearance);
    render(<App api={{ ...api, updateAppearance: update }} />);
    fireEvent.click(await screen.findByRole("button", { name: "调整外观" }));
    fireEvent.click(screen.getByRole("button", { name: "外观主题" }));
    const appearanceDialog = screen.getByRole("dialog", { name: "调整外观" });
    const themeCards =
      appearanceDialog.querySelectorAll<HTMLButtonElement>(".appearance-theme-card");
    fireEvent.click(themeCards[2] as HTMLButtonElement);
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "high-contrast" })),
    );

    fireEvent.click(screen.getByRole("button", { name: "字体外观" }));
    const picker = screen.getByTestId("navigation-font-color-picker");
    fireEvent.click(within(picker).getByRole("button", { name: "重置颜色和透明度" }));
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({ navigationFontColor: "#FFFFFFFF" }),
      ),
    );
  });

  it("keeps high-contrast text readable when a font color is selected", async () => {
    const api = createFakeApi(WORKSPACE_SNAPSHOT);
    const update = vi.fn(api.updateAppearance);
    render(<App api={{ ...api, updateAppearance: update }} />);
    const appearanceButton = document.querySelector<HTMLElement>(".sidebar-appearance-button");
    expect(appearanceButton).not.toBeNull();
    await waitFor(() => expect(document.documentElement.dataset["theme"]).toBe("halo"));
    fireEvent.click(appearanceButton as HTMLElement);

    const appearanceDialog = screen.getByRole("dialog");
    const appearanceTabs =
      appearanceDialog.querySelectorAll<HTMLButtonElement>(".appearance-nav-button");
    fireEvent.click(appearanceTabs[0] as HTMLButtonElement);
    const themeCards =
      appearanceDialog.querySelectorAll<HTMLButtonElement>(".appearance-theme-card");
    fireEvent.click(themeCards[2] as HTMLButtonElement);
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "high-contrast" })),
    );

    fireEvent.click(appearanceTabs[2] as HTMLButtonElement);
    const colorInput = appearanceDialog.querySelector<HTMLInputElement>('input[type="text"]');
    expect(colorInput).not.toBeNull();
    fireEvent.change(colorInput as HTMLInputElement, { target: { value: "#101010" } });
    await waitFor(() =>
      expect(update).toHaveBeenLastCalledWith(
        expect.objectContaining({ navigationFontColor: "#0F0F0FFF" }),
      ),
    );
    await waitFor(() =>
      expect(document.documentElement.style.getPropertyValue("--navigation-font-color")).toBe(
        "#FFFFFFFF",
      ),
    );
    expect(document.documentElement.style.getPropertyValue("--patch-card-font-color")).toBe(
      "#FFFFFFFF",
    );
  });
});

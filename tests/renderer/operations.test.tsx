import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/renderer/App";
import type { DnfApi } from "../../src/shared/ipc-contracts";
import type { CategorySnapshot } from "../../src/shared/library-dto";
import { createFakeApi, WORKSPACE_SNAPSHOT } from "./fake-api";

afterEach(cleanup);

function itemButton(name: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(name, "u") });
}

const NESTED_WORKSPACE_SNAPSHOT: CategorySnapshot = {
  ...WORKSPACE_SNAPSHOT,
  childCategories: [
    {
      name: "Category A",
      relativePath: "Category A",
      patchCount: 0,
      childCategories: [
        { name: "Nested", relativePath: "Category A\\Nested", patchCount: 0, childCategories: [] },
      ],
    },
  ],
};

const ROOT_TREE_WORKSPACE_SNAPSHOT: CategorySnapshot = {
  ...NESTED_WORKSPACE_SNAPSHOT,
  childCategories: [
    ...NESTED_WORKSPACE_SNAPSHOT.childCategories,
    { name: "Other", relativePath: "Other", patchCount: 0, childCategories: [] },
  ],
};

function withPatchRelativePath(snapshot: CategorySnapshot, relativePath: string): CategorySnapshot {
  return {
    ...snapshot,
    patches: snapshot.patches.map((patch) =>
      patch.name === "coat.npk" ? { ...patch, relativePath } : patch,
    ),
  };
}

describe("workspace operations", () => {
  it("shows no native hover tooltip on patch cards", async () => {
    render(<App api={createFakeApi(WORKSPACE_SNAPSHOT)} />);
    await screen.findByText("coat.npk");

    const card = itemButton("coat.npk");
    expect(card).not.toHaveAttribute("title");
    expect(card).toHaveAccessibleName("coat.npk");
  });

  it("toggles a card without selecting it", async () => {
    let enabledRequest: Parameters<DnfApi["enableItems"]>[0] | undefined;
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      enableItems: async (request) => {
        enabledRequest = request;
        return { ok: true, value: { installedCount: 1 } };
      },
    };
    render(<App api={api} />);
    await screen.findByText("coat.npk");

    fireEvent.click(screen.getByRole("checkbox", { name: "启用 sword.npk" }));

    await waitFor(() =>
      expect(enabledRequest).toEqual({ items: [{ kind: "patch", relativePath: "sword.npk" }] }),
    );
    expect(itemButton("sword.npk")).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps the current cards visible while enabling refreshes the workspace", async () => {
    let enabledRequest: Parameters<DnfApi["enableItems"]>[0] | undefined;
    let releaseRefresh: (() => void) | undefined;
    let refreshFinished = false;
    let scanCount = 0;
    const baseApi = createFakeApi(WORKSPACE_SNAPSHOT);
    const api: DnfApi = {
      ...baseApi,
      scan: async (request) => {
        scanCount += 1;
        if (scanCount === 1) return baseApi.scan(request);
        await new Promise<void>((resolve) => {
          releaseRefresh = resolve;
        });
        const result = await baseApi.scan(request);
        refreshFinished = true;
        return result;
      },
      enableItems: async (request) => {
        enabledRequest = request;
        return { ok: true, value: { installedCount: 1 } };
      },
    };
    render(<App api={api} />);
    await screen.findByText("coat.npk");

    fireEvent.click(screen.getByRole("checkbox", { name: "启用 sword.npk" }));

    await waitFor(() =>
      expect(enabledRequest).toEqual({ items: [{ kind: "patch", relativePath: "sword.npk" }] }),
    );
    expect(itemButton("sword.npk")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "正在读取补丁库" })).not.toBeInTheDocument();

    releaseRefresh?.();
    await waitFor(() => expect(refreshFinished).toBe(true));
  });

  it("shows the patch context menu in the requested order", async () => {
    render(<App api={createFakeApi(WORKSPACE_SNAPSHOT)} />);
    await screen.findByText("coat.npk");

    fireEvent.contextMenu(itemButton("coat.npk"));

    const menu = screen.getByRole("menu");
    const labels = within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.querySelector(".item-context-menu-label")?.textContent);
    expect(labels).toEqual(["停用", "移动", "打组", "加入预设", "重命名", "源文件", "删除"]);
    expect(
      Array.from(menu.querySelectorAll(".item-context-menu-shortcut")).map(
        (shortcut) => shortcut.textContent,
      ),
    ).toEqual(["Ctrl+G", "F2", "Del"]);
    expect(menu.querySelector(".item-context-menu-separator")).not.toBeNull();
    expect(within(menu).getByRole("menuitem", { name: "打组" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Control+G",
    );
    expect(within(menu).getByRole("menuitem", { name: "重命名" })).toHaveAttribute(
      "aria-keyshortcuts",
      "F2",
    );
    expect(within(menu).getByRole("menuitem", { name: "删除" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Delete",
    );
    expect(menu.querySelectorAll(".item-context-menu-pill")).toHaveLength(1);
    expect(menu.querySelector(".item-context-menu-item")?.className).not.toContain("hover");
  });

  it("enables every selected patch when one selected card switch is turned on", async () => {
    let enabledRequest: Parameters<DnfApi["enableItems"]>[0] | undefined;
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      enableItems: async (request) => {
        enabledRequest = request;
        return { ok: true, value: { installedCount: request.items.length } };
      },
    };
    render(<App api={api} />);
    await screen.findByText("coat.npk");
    // coat.npk 已启用、sword.npk 未启用，两条一起选中后拨任一开关。
    fireEvent.click(itemButton("coat.npk"));
    fireEvent.click(itemButton("sword.npk"), { ctrlKey: true });

    fireEvent.click(screen.getByRole("checkbox", { name: "启用 sword.npk" }));

    // 已启用的 coat.npk 不进请求，只有真正需要变更的 sword.npk 被提交。
    await waitFor(() =>
      expect(enabledRequest).toEqual({ items: [{ kind: "patch", relativePath: "sword.npk" }] }),
    );
  });

  it("labels the context menu entry by the card state and toggles the whole selection", async () => {
    let disabledRequest: Parameters<DnfApi["disableItems"]>[0] | undefined;
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      disableItems: async (request) => {
        disabledRequest = request;
        return { ok: true, value: { removedCount: request.items.length } };
      },
    };
    render(<App api={api} />);
    await screen.findByText("coat.npk");

    // coat.npk 已启用、sword.npk 未启用：右键已启用的那张，条目应显示「停用」。
    fireEvent.click(itemButton("coat.npk"));
    fireEvent.click(itemButton("sword.npk"), { ctrlKey: true });
    fireEvent.contextMenu(itemButton("coat.npk"));

    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "停用" })).toBeEnabled();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "停用" }));

    // 与卡片开关一致：作用于整个选区，但已处于目标状态的条目不进请求
    // （sword.npk 本就未启用，停用它无需落盘）。
    await waitFor(() =>
      expect(disabledRequest).toEqual({
        items: [{ kind: "patch", relativePath: "coat.npk" }],
      }),
    );
  });

  it("enables a single unenabled card from the context menu", async () => {
    let enabledRequest: Parameters<DnfApi["enableItems"]>[0] | undefined;
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      enableItems: async (request) => {
        enabledRequest = request;
        return { ok: true, value: { installedCount: request.items.length } };
      },
    };
    render(<App api={api} />);
    await screen.findByText("coat.npk");

    fireEvent.contextMenu(itemButton("sword.npk"));

    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: "启用" })).toBeEnabled();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "启用" }));

    await waitFor(() =>
      expect(enabledRequest).toEqual({ items: [{ kind: "patch", relativePath: "sword.npk" }] }),
    );
  });

  it("disables every selected patch when one selected card switch is turned off", async () => {
    let disabledRequest: Parameters<DnfApi["disableItems"]>[0] | undefined;
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      disableItems: async (request) => {
        disabledRequest = request;
        return { ok: true, value: { removedCount: request.items.length } };
      },
    };
    render(<App api={api} />);
    await screen.findByText("coat.npk");
    fireEvent.click(itemButton("coat.npk"));
    fireEvent.click(itemButton("sword.npk"), { ctrlKey: true });

    fireEvent.click(screen.getByRole("checkbox", { name: "停用 coat.npk" }));

    await waitFor(() =>
      expect(disabledRequest).toEqual({ items: [{ kind: "patch", relativePath: "coat.npk" }] }),
    );
  });

  it("keeps a single card switch to that card when nothing is selected", async () => {
    let enabledRequest: Parameters<DnfApi["enableItems"]>[0] | undefined;
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      enableItems: async (request) => {
        enabledRequest = request;
        return { ok: true, value: { installedCount: request.items.length } };
      },
    };
    render(<App api={api} />);
    await screen.findByText("coat.npk");

    // 未选中任何卡片时拨开关，只应影响这一张，且不因此改变选中态。
    fireEvent.click(screen.getByRole("checkbox", { name: "启用 sword.npk" }));

    await waitFor(() =>
      expect(enabledRequest).toEqual({ items: [{ kind: "patch", relativePath: "sword.npk" }] }),
    );
  });

  it("opens the selected patch source file from its context menu", async () => {
    const requests: Array<{ readonly relativePath: string }> = [];
    const api = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      revealPatch: async (request: { readonly relativePath: string }) => {
        requests.push(request);
        return { ok: true as const, value: { revealed: true as const } };
      },
    };
    render(<App api={api} />);
    await screen.findByText("coat.npk");

    fireEvent.contextMenu(itemButton("coat.npk"));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "源文件" }));

    await waitFor(() => expect(requests).toEqual([{ relativePath: "coat.npk" }]));
  });

  it("limits move submenu to categories", async () => {
    render(<App api={createFakeApi(WORKSPACE_SNAPSHOT)} />);
    await screen.findByText("coat.npk");
    fireEvent.contextMenu(itemButton("coat.npk"));
    const menu = screen.getByRole("menu");
    const moveSubmenu = menu.querySelector(".item-context-submenu");
    expect(moveSubmenu).not.toBeNull();
    if (moveSubmenu === null) return;
    fireEvent.mouseEnter(moveSubmenu);
    const targetPanel = moveSubmenu.querySelector(".item-context-submenu-panel");
    expect(targetPanel).not.toBeNull();
    if (!(targetPanel instanceof HTMLElement)) return;
    expect(
      within(targetPanel)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["分类A"]);
  });

  it("collapses the expanded move submenu when hovering a leaf sibling item", async () => {
    render(<App api={createFakeApi(WORKSPACE_SNAPSHOT)} />);
    await screen.findByText("coat.npk");
    fireEvent.contextMenu(itemButton("coat.npk"));

    const menu = screen.getByRole("menu");
    const moveSubmenu = menu.querySelector(".item-context-submenu");
    expect(moveSubmenu).not.toBeNull();
    if (moveSubmenu === null) return;
    fireEvent.mouseEnter(moveSubmenu);
    expect(moveSubmenu.querySelector(".item-context-submenu-panel")).not.toBeNull();

    fireEvent.mouseEnter(within(menu).getByRole("menuitem", { name: "源文件" }));

    expect(menu.querySelector(".item-context-submenu-panel")).toBeNull();
  });

  it("includes nested categories in the move submenu", async () => {
    render(<App api={createFakeApi(NESTED_WORKSPACE_SNAPSHOT)} />);
    await screen.findByText("coat.npk");
    fireEvent.contextMenu(itemButton("coat.npk"));
    const moveSubmenu = screen.getByRole("menu").querySelector(".item-context-submenu");
    expect(moveSubmenu).not.toBeNull();
    if (moveSubmenu === null) return;
    fireEvent.mouseEnter(moveSubmenu);
    const targetPanel = moveSubmenu.querySelector(".item-context-submenu-panel");
    expect(targetPanel).not.toBeNull();
    if (!(targetPanel instanceof HTMLElement)) return;
    const nestedSubmenu = targetPanel.querySelector(".item-context-submenu");
    expect(nestedSubmenu).not.toBeNull();
    if (nestedSubmenu === null) return;
    fireEvent.mouseEnter(nestedSubmenu);
    expect(
      within(targetPanel)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["Category A", "Nested"]);
  });

  it("keeps every root category available from a nested category", async () => {
    const baseApi = createFakeApi(ROOT_TREE_WORKSPACE_SNAPSHOT);
    const api: DnfApi = {
      ...baseApi,
      scan: async ({ relativePath }) =>
        relativePath === "Category A"
          ? {
              ok: true,
              value: withPatchRelativePath(ROOT_TREE_WORKSPACE_SNAPSHOT, "Category A\\coat.npk"),
            }
          : baseApi.scan({ includeDescendants: false, relativePath }),
    };
    render(<App api={api} />);
    await screen.findByText("coat.npk");
    fireEvent.click(screen.getByRole("button", { name: "Category A" }));
    await screen.findByText("coat.npk");
    fireEvent.contextMenu(itemButton("coat.npk"));

    const menu = screen.getByRole("menu");
    const moveSubmenu = menu.querySelector(".item-context-submenu");
    expect(moveSubmenu).not.toBeNull();
    if (moveSubmenu === null) return;
    fireEvent.mouseEnter(moveSubmenu);
    const targetPanel = moveSubmenu.querySelector(".item-context-submenu-panel");
    expect(targetPanel).not.toBeNull();
    if (!(targetPanel instanceof HTMLElement)) return;

    expect(within(targetPanel).getByRole("menuitem", { name: "Category A" })).toBeEnabled();
    expect(within(targetPanel).getByRole("menuitem", { name: "Other" })).toBeEnabled();

    const categorySubmenu = targetPanel.querySelector(".item-context-submenu");
    expect(categorySubmenu).not.toBeNull();
    if (categorySubmenu === null) return;
    fireEvent.mouseEnter(categorySubmenu);
    expect(within(targetPanel).getByRole("menuitem", { name: "Nested" })).toBeEnabled();
  });

  it("keeps the parent category enabled when moving a descendant patch", async () => {
    const baseApi = createFakeApi(ROOT_TREE_WORKSPACE_SNAPSHOT);
    const api: DnfApi = {
      ...baseApi,
      scan: async ({ includeDescendants, relativePath }) =>
        relativePath === "Category A" && includeDescendants
          ? {
              ok: true,
              value: withPatchRelativePath(
                ROOT_TREE_WORKSPACE_SNAPSHOT,
                "Category A\\Nested\\coat.npk",
              ),
            }
          : baseApi.scan({ includeDescendants: false, relativePath }),
    };
    render(<App api={api} />);
    await screen.findByText("coat.npk");
    fireEvent.click(screen.getByRole("button", { name: "Category A" }));
    await screen.findByText("coat.npk");
    fireEvent.click(screen.getByRole("checkbox", { name: "包含子分类" }));
    await screen.findByRole("button", { name: /coat\.npk.*Category A\\Nested/u });

    fireEvent.contextMenu(itemButton("coat.npk"));
    const moveSubmenu = screen.getByRole("menu").querySelector(".item-context-submenu");
    expect(moveSubmenu).not.toBeNull();
    if (moveSubmenu === null) return;
    fireEvent.mouseEnter(moveSubmenu);
    const targetPanel = moveSubmenu.querySelector(".item-context-submenu-panel");
    expect(targetPanel).not.toBeNull();
    if (!(targetPanel instanceof HTMLElement)) return;

    const parentTarget = within(targetPanel).getByRole("menuitem", { name: "Category A" });
    expect(parentTarget).toBeEnabled();
    expect(parentTarget).toHaveClass("has-children");
    const categorySubmenu = targetPanel.querySelector(".item-context-submenu");
    expect(categorySubmenu).not.toBeNull();
    if (categorySubmenu === null) return;
    fireEvent.mouseEnter(categorySubmenu);
    expect(within(targetPanel).getByRole("menuitem", { name: "Nested" })).toBeEnabled();
  });

  it("keeps the current category selectable in the move submenu", async () => {
    const baseApi = createFakeApi(WORKSPACE_SNAPSHOT);
    const api: DnfApi = {
      ...baseApi,
      scan: async ({ relativePath }) =>
        relativePath === "分类A"
          ? {
              ok: true,
              value: withPatchRelativePath(WORKSPACE_SNAPSHOT, "分类A\\coat.npk"),
            }
          : baseApi.scan({ includeDescendants: false, relativePath }),
    };
    render(<App api={api} />);
    await screen.findByText("coat.npk");
    fireEvent.click(screen.getByRole("button", { name: "分类A" }));
    await screen.findByText("coat.npk");
    fireEvent.contextMenu(itemButton("coat.npk"));
    const menu = screen.getByRole("menu");
    const moveSubmenu = menu.querySelector(".item-context-submenu");
    expect(moveSubmenu).not.toBeNull();
    if (moveSubmenu === null) return;
    fireEvent.mouseEnter(moveSubmenu);
    const targetPanel = moveSubmenu.querySelector(".item-context-submenu-panel");
    expect(targetPanel).not.toBeNull();
    if (!(targetPanel instanceof HTMLElement)) return;
    expect(within(targetPanel).getByRole("menuitem", { name: "分类A" })).toBeEnabled();
  });

  it("moves directly to a category from the hover submenu", async () => {
    let moveRequest: Parameters<DnfApi["moveItems"]>[0] | undefined;
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      moveItems: async (request) => {
        moveRequest = request;
        return { ok: true, value: { relativePaths: ["分类A\\coat.npk"] } };
      },
    };
    render(<App api={api} />);
    await screen.findByText("coat.npk");
    fireEvent.contextMenu(itemButton("coat.npk"));
    const menu = screen.getByRole("menu");
    const moveSubmenu = menu.querySelector(".item-context-submenu");
    expect(moveSubmenu).not.toBeNull();
    if (moveSubmenu === null) return;
    fireEvent.mouseEnter(moveSubmenu);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "分类A" }));

    await waitFor(() =>
      expect(moveRequest).toEqual({
        items: [{ kind: "patch", sourceRelativePath: "coat.npk" }],
        targetDirectoryRelativePath: "分类A",
      }),
    );
  });

  it("shows group navigation and dissolve actions in the group menu", async () => {
    const scanRequests: Array<Parameters<DnfApi["scan"]>[0]> = [];
    const scanGroupRequests: Array<Parameters<DnfApi["scanGroup"]>[0]> = [];
    let dissolveRequest: Parameters<DnfApi["dissolveGroup"]>[0] | undefined;
    const baseApi = createFakeApi(WORKSPACE_SNAPSHOT);
    const api: DnfApi = {
      ...baseApi,
      scan: async (request) => {
        scanRequests.push(request);
        return baseApi.scan(request);
      },
      scanGroup: async (request) => {
        scanGroupRequests.push(request);
        return baseApi.scanGroup(request);
      },
      dissolveGroup: async (request) => {
        dissolveRequest = request;
        return { ok: true, value: { id: request.groupId } };
      },
    };
    render(<App api={api} />);
    await screen.findByText("套装");
    fireEvent.contextMenu(itemButton("套装"));

    const menu = screen.getByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual(["启用", "移动", "进入组", "解散组", "加入预设", "重命名", "删除"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "进入组" }));

    await waitFor(() =>
      expect(scanGroupRequests.at(-1)).toEqual({
        groupId: "0552babf-49b5-4390-96a7-1846a0c1e9f8",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "返回组" }));
    await waitFor(() => expect(scanRequests.at(-1)?.relativePath).toBe(""));
    expect(screen.queryByRole("button", { name: "返回组" })).not.toBeInTheDocument();
    fireEvent.contextMenu(itemButton("套装"));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "解散组" }));

    await waitFor(() =>
      expect(dissolveRequest).toEqual({ groupId: "0552babf-49b5-4390-96a7-1846a0c1e9f8" }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("creates a default-named group directly from the keyboard shortcut", async () => {
    let groupRequest: Parameters<DnfApi["createGroup"]>[0] | undefined;
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      createGroup: async (request) => {
        groupRequest = request;
        return {
          ok: true,
          value: { id: "0552babf-49b5-4390-96a7-1846a0c1e9f8", categoryRelativePath: "" },
        };
      },
    };
    render(<App api={api} />);
    await screen.findByText("coat.npk");
    fireEvent.click(itemButton("coat.npk"));
    fireEvent.click(itemButton("sword.npk"), { ctrlKey: true });

    fireEvent.keyDown(screen.getByRole("main", { name: "补丁工作区" }), {
      key: "g",
      ctrlKey: true,
    });
    await waitFor(() =>
      expect(groupRequest).toEqual({
        categoryRelativePath: "",
        patchRelativePaths: ["coat.npk", "sword.npk"],
        groupName: "自定义",
      }),
    );
    expect(screen.queryByRole("textbox", { name: "组名称" })).not.toBeInTheDocument();

    fireEvent.keyDown(itemButton("sword.npk"), { key: "Delete" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("enables the selected item and refreshes the workspace", async () => {
    let enabledRequest: Parameters<DnfApi["enableItems"]>[0] | undefined;
    let scanCount = 0;
    const api = createFakeApi(WORKSPACE_SNAPSHOT);
    const trackedApi: DnfApi = {
      ...api,
      scan: async (request) => {
        scanCount += 1;
        return api.scan(request);
      },
      enableItems: async (request) => {
        enabledRequest = request;
        return { ok: true, value: { installedCount: 1 } };
      },
    };
    render(<App api={trackedApi} />);
    await screen.findByText("sword.npk");

    fireEvent.click(screen.getByRole("checkbox", { name: "启用 sword.npk" }));

    await waitFor(() => expect(scanCount).toBeGreaterThan(1));
    expect(enabledRequest).toEqual({ items: [{ kind: "patch", relativePath: "sword.npk" }] });
    // 标题栏的"发现新版本"启动提示也是 role="status"，操作提示断言只看工作区内部。
    expect(within(screen.getByRole("main")).queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps group and patch enablement on each card switch", async () => {
    const enabledRequests: Array<Parameters<DnfApi["enableItems"]>[0]> = [];
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      enableItems: async (request) => {
        enabledRequests.push(request);
        return { ok: true, value: { installedCount: 1 } };
      },
    };
    render(<App api={api} />);
    await screen.findByText("套装");

    fireEvent.click(screen.getByRole("checkbox", { name: "启用 套装" }));

    await waitFor(() =>
      expect(enabledRequests).toEqual([
        { items: [{ kind: "group", groupId: "0552babf-49b5-4390-96a7-1846a0c1e9f8" }] },
      ]),
    );
  });

  it("renames a patch inline from its context menu", async () => {
    let moveRequest: Parameters<DnfApi["moveItem"]>[0] | undefined;
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      moveItem: async (request) => {
        moveRequest = request;
        return { ok: true, value: { relativePath: "coat-new.npk" } };
      },
    };
    render(<App api={api} />);
    await screen.findByText("coat.npk");
    fireEvent.contextMenu(itemButton("coat.npk"));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "重命名" }));
    const renameInput = screen.getByRole("textbox", { name: "重命名 coat.npk" });
    expect(renameInput).toHaveValue("coat");
    fireEvent.change(renameInput, {
      target: { value: "coat-new" },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "重命名 coat.npk" }), {
      key: "Enter",
    });

    await waitFor(() =>
      expect(moveRequest).toEqual({
        kind: "patch",
        sourceRelativePath: "coat.npk",
        targetDirectoryRelativePath: "",
        newName: "coat-new.npk",
      }),
    );
  });

  it("moves a selected group to a real category", async () => {
    let moveRequest: Parameters<DnfApi["moveItems"]>[0] | undefined;
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      moveItems: async (request) => {
        moveRequest = request;
        return { ok: true, value: { relativePaths: ["分类A\\套装"] } };
      },
    };
    render(<App api={api} />);
    await screen.findByText("套装");
    fireEvent.contextMenu(itemButton("套装"));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "移动" }));
    fireEvent.change(screen.getByRole("combobox", { name: "目标位置" }), {
      target: { value: "分类A" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认移动" }));

    await waitFor(() =>
      expect(moveRequest).toEqual({
        items: [{ kind: "group", groupId: "0552babf-49b5-4390-96a7-1846a0c1e9f8" }],
        targetDirectoryRelativePath: "分类A",
      }),
    );
  });

  it("opens group rename inline with F2", async () => {
    render(<App api={createFakeApi(WORKSPACE_SNAPSHOT)} />);
    await screen.findByText("套装");

    fireEvent.keyDown(itemButton("套装"), { key: "F2" });

    expect(screen.getByRole("textbox", { name: "重命名 套装" })).toHaveValue("套装");
  });

  it("commits group rename when clicking the workspace blank area", async () => {
    let moveRequest: Parameters<DnfApi["moveItem"]>[0] | undefined;
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      moveItem: async (request) => {
        moveRequest = request;
        return { ok: true, value: { relativePath: "新套装" } };
      },
    };
    render(<App api={api} />);
    await screen.findByText("套装");

    fireEvent.keyDown(itemButton("套装"), { key: "F2" });
    const renameInput = screen.getByRole("textbox", { name: "重命名 套装" });
    fireEvent.change(renameInput, { target: { value: "新套装" } });
    fireEvent.pointerDown(screen.getByRole("main", { name: "补丁工作区" }), {
      button: 0,
      clientX: 20,
      clientY: 20,
    });

    await waitFor(() =>
      expect(moveRequest).toEqual({
        kind: "group",
        groupId: "0552babf-49b5-4390-96a7-1846a0c1e9f8",
        targetDirectoryRelativePath: "",
        newName: "新套装",
      }),
    );
  });

  it("does not refresh or call single-item commands when an atomic batch move fails", async () => {
    let scanCount = 0;
    let singleMoveCount = 0;
    let batchRequest: Parameters<DnfApi["moveItems"]>[0] | undefined;
    const baseApi = createFakeApi(WORKSPACE_SNAPSHOT);
    const api: DnfApi = {
      ...baseApi,
      scan: async (request) => {
        scanCount += 1;
        return baseApi.scan(request);
      },
      moveItem: async () => {
        singleMoveCount += 1;
        return { ok: true, value: { relativePath: "分类A\\coat.npk" } };
      },
      moveItems: async (request) => {
        batchRequest = request;
        return { ok: false, error: { code: "TARGET_CONFLICT", message: "目标已存在" } };
      },
    };
    render(<App api={api} />);
    await screen.findByText("coat.npk");
    fireEvent.click(itemButton("coat.npk"));
    fireEvent.click(itemButton("sword.npk"), { ctrlKey: true });
    fireEvent.contextMenu(itemButton("sword.npk"));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "移动" }));
    fireEvent.change(screen.getByRole("combobox", { name: "目标位置" }), {
      target: { value: "分类A" },
    });

    fireEvent.click(screen.getByRole("button", { name: "确认移动" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("目标已存在"));
    expect(batchRequest).toEqual({
      items: [
        { kind: "patch", sourceRelativePath: "coat.npk" },
        { kind: "patch", sourceRelativePath: "sword.npk" },
      ],
      targetDirectoryRelativePath: "分类A",
    });
    expect(singleMoveCount).toBe(0);
    expect(scanCount).toBe(1);
  });

  it("cancels inline rename with Escape", async () => {
    render(<App api={createFakeApi(WORKSPACE_SNAPSHOT)} />);
    await screen.findByText("coat.npk");
    fireEvent.keyDown(itemButton("coat.npk"), { key: "F2" });
    const rename = screen.getByRole("textbox", { name: "重命名 coat.npk" });
    fireEvent.change(rename, { target: { value: "coat-new.npk" } });
    fireEvent.keyDown(rename, { key: "Escape" });

    expect(screen.queryByRole("textbox", { name: "重命名 coat.npk" })).not.toBeInTheDocument();
  });

  it("creates a default-named group from the context menu without a dialog", async () => {
    let groupRequest: Parameters<DnfApi["createGroup"]>[0] | undefined;
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      createGroup: async (request) => {
        groupRequest = request;
        return {
          ok: true,
          value: { id: "0552babf-49b5-4390-96a7-1846a0c1e9f8", categoryRelativePath: "" },
        };
      },
    };
    render(<App api={api} />);
    await screen.findByText("coat.npk");
    fireEvent.click(itemButton("coat.npk"));
    fireEvent.click(itemButton("sword.npk"), { ctrlKey: true });

    fireEvent.contextMenu(itemButton("sword.npk"));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "打组" }));

    await waitFor(() =>
      expect(groupRequest).toEqual({
        categoryRelativePath: "",
        patchRelativePaths: ["coat.npk", "sword.npk"],
        groupName: "自定义",
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // 标题栏的"发现新版本"启动提示也是 role="status"，操作提示断言只看工作区内部。
    expect(within(screen.getByRole("main")).queryByRole("status")).not.toBeInTheDocument();
  });

  it("recycles selected items without a confirmation dialog", async () => {
    const recycled: Array<Parameters<DnfApi["recycleItems"]>[0]> = [];
    let recycleCountRefreshes = 0;
    let singleCalls = 0;
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      recycleItem: async () => {
        singleCalls += 1;
        return { ok: true, value: { id: "a2021aa5-e024-4106-a0a3-f0874d4c9ec9" } };
      },
      recycleItems: async (request) => {
        recycled.push(request);
        return { ok: true, value: { ids: ["a2021aa5-e024-4106-a0a3-f0874d4c9ec9"] } };
      },
      listRecycle: async () => {
        recycleCountRefreshes += 1;
        return createFakeApi(WORKSPACE_SNAPSHOT).listRecycle();
      },
    };
    render(<App api={api} />);
    await screen.findByText("sword.npk");
    fireEvent.contextMenu(itemButton("sword.npk"));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "删除" }));

    await waitFor(() =>
      expect(recycled).toEqual([{ items: [{ kind: "patch", relativePath: "sword.npk" }] }]),
    );
    await waitFor(() => expect(recycleCountRefreshes).toBeGreaterThan(0));
    expect(singleCalls).toBe(0);
  });

  it("blocks recycling an installed patch with an explanatory dialog", async () => {
    const recycled: Array<Parameters<DnfApi["recycleItems"]>[0]> = [];
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      recycleItems: async (request) => {
        recycled.push(request);
        return { ok: true, value: { ids: request.items.map(() => crypto.randomUUID()) } };
      },
    };
    render(<App api={api} />);
    await screen.findByText("coat.npk");
    fireEvent.contextMenu(itemButton("coat.npk"));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "删除" }));

    expect(await screen.findByRole("dialog")).toHaveTextContent("补丁已安装，请先关闭再删除。");
    expect(recycled).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "知道了" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/renderer/App";
import type { DnfApi, RecycleEntryDto } from "../../src/shared/ipc-contracts";
import { createFakeApi, WORKSPACE_SNAPSHOT } from "./fake-api";

afterEach(cleanup);

const RECYCLED_COAT: RecycleEntryDto = {
  id: "a2021aa5-e024-4106-a0a3-f0874d4c9ec9",
  kind: "patch",
  originalRelativePath: "分类A\\coat.npk",
  recycledRelativePath: "a2021aa5-e024-4106-a0a3-f0874d4c9ec9\\coat.npk",
  recycledAt: "2026-07-18T00:00:00.000Z",
  size: 2048,
};

const RECYCLED_ITEMS: readonly RecycleEntryDto[] = [
  RECYCLED_COAT,
  {
    id: "b3121aa5-e024-4106-a0a3-f0874d4c9ec9",
    kind: "patch",
    originalRelativePath: "分类A\\hat.npk",
    recycledRelativePath: "b3121aa5-e024-4106-a0a3-f0874d4c9ec9\\hat.npk",
    recycledAt: "2026-07-18T00:00:00.000Z",
    size: 1024,
  },
  {
    id: "c4121aa5-e024-4106-a0a3-f0874d4c9ec9",
    kind: "patch",
    originalRelativePath: "分类A\\boot.npk",
    recycledRelativePath: "c4121aa5-e024-4106-a0a3-f0874d4c9ec9\\boot.npk",
    recycledAt: "2026-07-18T00:00:00.000Z",
    size: 512,
  },
];

describe("recycle bin", () => {
  it("opens the independent recycle-bin workspace from the category sidebar", async () => {
    render(
      <App
        api={{
          ...createFakeApi(WORKSPACE_SNAPSHOT),
          listRecycle: async () => ({
            ok: true,
            value: {
              items: [
                {
                  id: "a2021aa5-e024-4106-a0a3-f0874d4c9ec9",
                  kind: "patch",
                  originalRelativePath: "分类A\\coat.npk",
                  recycledRelativePath: "a2021aa5-e024-4106-a0a3-f0874d4c9ec9\\coat.npk",
                  recycledAt: "2026-07-18T00:00:00.000Z",
                  size: 2048,
                },
              ],
            },
          }),
        }}
      />,
    );
    await screen.findByText("coat.npk");

    fireEvent.click(screen.getByRole("button", { name: "回收站" }));

    expect(screen.getByRole("main", { name: "回收站" })).toBeInTheDocument();
    expect(screen.queryByRole("fieldset", { name: "启用状态" })).not.toBeInTheDocument();
    expect(await screen.findByText("1")).toBeInTheDocument();
    expect(screen.queryByText("1 个项目")).not.toBeInTheDocument();
  }, 15_000);

  it("deletes a selected recycled item permanently", async () => {
    const deletedIds: string[] = [];
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      listRecycle: async () => ({
        ok: true,
        value: {
          items: [
            {
              id: "a2021aa5-e024-4106-a0a3-f0874d4c9ec9",
              kind: "patch",
              originalRelativePath: "分类A\\coat.npk",
              recycledRelativePath: "a2021aa5-e024-4106-a0a3-f0874d4c9ec9\\coat.npk",
              recycledAt: "2026-07-18T00:00:00.000Z",
              size: 2048,
            },
          ],
        },
      }),
      deleteRecycleItems: async ({ ids }) => {
        deletedIds.push(...ids);
        return { ok: true, value: { deletedIds: [...ids] } };
      },
    };
    render(<App api={api} />);
    await screen.findByText("coat.npk");
    fireEvent.click(screen.getByRole("button", { name: "回收站" }));
    expect(await screen.findByText("分类A\\coat.npk")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: /清空回收站/ })).toBeEnabled();
    fireEvent.click(screen.getByText("分类A\\coat.npk"));
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    await waitFor(() => expect(deletedIds).toEqual(["a2021aa5-e024-4106-a0a3-f0874d4c9ec9"]));
  });

  it("restores a recycled item back to its original path", async () => {
    const restoredIds: string[] = [];
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      listRecycle: async () => ({ ok: true, value: { items: [RECYCLED_COAT] } }),
      restoreItem: async ({ id }) => {
        restoredIds.push(id);
        return { ok: true, value: { relativePath: RECYCLED_COAT.originalRelativePath } };
      },
    };
    render(<App api={api} />);
    await screen.findByText("coat.npk");
    fireEvent.click(screen.getByRole("button", { name: "回收站" }));
    await screen.findByText("分类A\\coat.npk");

    fireEvent.click(screen.getByRole("button", { name: "恢复" }));

    await waitFor(() => expect(restoredIds).toEqual([RECYCLED_COAT.id]));
  });

  it("renders no context menu until one is requested", async () => {
    render(<App api={createFakeApi(WORKSPACE_SNAPSHOT)} />);
    await screen.findByText("coat.npk");
    fireEvent.click(screen.getByRole("button", { name: "回收站" }));
    await screen.findByRole("main", { name: "回收站" });

    // 空 actions 的 ContextMenu 没有 CSS 空态隐藏规则，会以 fixed 定位常驻窗口左上角。
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("disables the clear button while the delete request is in flight", async () => {
    let release: (() => void) | undefined;
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      listRecycle: async () => ({
        ok: true,
        value: { items: [RECYCLED_COAT] },
      }),
      deleteRecycleItems: async ({ ids }) => {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return { ok: true, value: { deletedIds: [...ids] } };
      },
    };
    render(<App api={api} />);
    await screen.findByText("coat.npk");
    fireEvent.click(screen.getByRole("button", { name: "回收站" }));
    await screen.findByText("分类A\\coat.npk");

    const clearButton = screen.getByRole("button", { name: /清空回收站/ });
    fireEvent.click(clearButton);

    await waitFor(() => expect(clearButton).toBeDisabled());
    release?.();
    await waitFor(() => expect(clearButton).toBeEnabled());
  });

  it("keeps the range anchor after a box selection", async () => {
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      listRecycle: async () => ({ ok: true, value: { items: RECYCLED_ITEMS } }),
    };
    render(<App api={api} />);
    await screen.findByText("coat.npk");
    fireEvent.click(screen.getByRole("button", { name: "回收站" }));
    await screen.findByText("分类A\\coat.npk");

    const rows = Array.from(document.querySelectorAll<HTMLElement>(".recycle-row"));
    expect(rows).toHaveLength(3);
    rows.forEach((row, index) => {
      row.getBoundingClientRect = () => new DOMRect(20 + index * 120, 20, 100, 40);
    });
    const list = document.querySelector<HTMLElement>(".recycle-bin-list");
    expect(list).not.toBeNull();
    if (list === null) return;

    // 框选只覆盖前两行，锚点应落在框选范围的最后一项。
    fireEvent.pointerDown(list, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(list, { clientX: 200, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(list, { pointerId: 1 });
    expect(selectedRowLabels()).toEqual(["分类A\\coat.npk", "分类A\\hat.npk"]);

    // 锚点若被清空，Shift+点击会退化成单选并丢掉框选结果。
    fireEvent.click(screen.getByText("分类A\\boot.npk"), { shiftKey: true });

    expect(selectedRowLabels()).toEqual(["分类A\\hat.npk", "分类A\\boot.npk"]);

    function selectedRowLabels(): string[] {
      return Array.from(
        document.querySelectorAll<HTMLElement>('.recycle-row[data-selected="true"]'),
      ).map((row) => row.querySelector("strong")?.textContent ?? "");
    }
  });
});

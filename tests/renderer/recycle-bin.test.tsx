import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/renderer/App";
import type { DnfApi } from "../../src/shared/ipc-contracts";
import { createFakeApi, WORKSPACE_SNAPSHOT } from "./fake-api";

afterEach(cleanup);

describe("recycle bin", () => {
  it("opens the independent recycle-bin workspace from the category sidebar", async () => {
    render(<App api={createFakeApi(WORKSPACE_SNAPSHOT)} />);
    await screen.findByText("coat.npk");

    fireEvent.click(screen.getByRole("button", { name: "回收站" }));

    expect(screen.getByRole("heading", { name: "回收站" })).toBeInTheDocument();
    expect(screen.getByRole("main", { name: "回收站" })).toBeInTheDocument();
    expect(screen.queryByRole("fieldset", { name: "启用状态" })).not.toBeInTheDocument();
  }, 15_000);

  it("restores an item and requires confirmation before emptying the recycle bin", async () => {
    let restoredId: string | undefined;
    let emptied = false;
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
            },
          ],
        },
      }),
      restoreItem: async ({ id }) => {
        restoredId = id;
        return { ok: true, value: { relativePath: "分类A\\coat.npk" } };
      },
      emptyRecycle: async () => {
        emptied = true;
        return { ok: true, value: { removedCount: 1 } };
      },
    };
    render(<App api={api} />);
    await screen.findByText("coat.npk");
    fireEvent.click(screen.getByRole("button", { name: "回收站" }));
    expect(await screen.findByText("分类A\\coat.npk")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "恢复" }));
    await waitFor(() => expect(restoredId).toBe("a2021aa5-e024-4106-a0a3-f0874d4c9ec9"));
    expect(emptied).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "清空回收站" }));
    expect(screen.getByText("确定清空全部回收项目？")).toBeInTheDocument();
    expect(emptied).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "确认清空" }));
    await waitFor(() => expect(emptied).toBe(true));
  });
});

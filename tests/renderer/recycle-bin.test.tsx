import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/renderer/App";
import type { DnfApi } from "../../src/shared/ipc-contracts";
import { createFakeApi, WORKSPACE_SNAPSHOT } from "./fake-api";

afterEach(cleanup);

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
});

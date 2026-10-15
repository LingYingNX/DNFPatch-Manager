import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/renderer/App";
import type { DnfApi } from "../../src/shared/ipc-contracts";
import { createFakeApi, WORKSPACE_SNAPSHOT } from "./fake-api";

afterEach(cleanup);

describe("category commands", () => {
  it("keeps category rename and deletion out of the sidebar", async () => {
    render(<App api={createFakeApi(WORKSPACE_SNAPSHOT)} />);
    await screen.findByText("coat.npk");

    expect(screen.queryByRole("button", { name: "重命名分类" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除分类" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建文件夹" })).toBeEnabled();
  });

  it("creates the folder at the root even while a category is selected", async () => {
    let request: Parameters<DnfApi["createCategory"]>[0] | undefined;
    let created = false;
    const nestedSnapshot = {
      ...WORKSPACE_SNAPSHOT,
      childCategories: [
        ...(WORKSPACE_SNAPSHOT.childCategories ?? []),
        {
          name: "新建文件夹",
          relativePath: "新建文件夹",
          patchCount: 0,
          childCategories: [],
        },
      ],
    };
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      createCategory: async (input) => {
        request = input;
        created = true;
        return { ok: true, value: { relativePath: "新建文件夹" } };
      },
      scan: async ({ relativePath }) => ({
        ok: true,
        value: relativePath === "" && created ? nestedSnapshot : WORKSPACE_SNAPSHOT,
      }),
    };
    render(<App api={api} />);
    const category = await screen.findByRole("button", { name: "分类A" });
    fireEvent.click(category);
    await waitFor(() => expect(category).toHaveClass("selected"));

    fireEvent.click(screen.getByRole("button", { name: "新建文件夹" }));

    await waitFor(() => expect(request).toEqual({ parentRelativePath: "", name: "新建文件夹" }));
    expect(await screen.findByRole("textbox", { name: "重命名 新建文件夹" })).toBeInTheDocument();
  });

  it("creates the category at the library root when no category is selected", async () => {
    let request: Parameters<DnfApi["createCategory"]>[0] | undefined;
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      createCategory: async (input) => {
        request = input;
        return { ok: true, value: { relativePath: input.name } };
      },
    };
    render(<App api={api} />);
    await screen.findByText("coat.npk");

    fireEvent.click(screen.getByRole("button", { name: "新建文件夹" }));

    await waitFor(() => expect(request).toEqual({ parentRelativePath: "", name: "新建文件夹" }));
  });

  it("avoids a root-level folder name already in use", async () => {
    let request: Parameters<DnfApi["createCategory"]>[0] | undefined;
    const api: DnfApi = {
      ...createFakeApi({
        ...WORKSPACE_SNAPSHOT,
        childCategories: [
          { name: "新建文件夹", relativePath: "新建文件夹", patchCount: 0, childCategories: [] },
        ],
      }),
      createCategory: async (input) => {
        request = input;
        return { ok: true, value: { relativePath: input.name } };
      },
    };
    const { container } = render(<App api={api} />);
    await screen.findByText("coat.npk");

    // 侧栏加号按钮：分类行也叫「新建文件夹」，只能按位置取。
    const addButton = container.querySelector(".sidebar-commands button");
    expect(addButton).not.toBeNull();
    fireEvent.click(addButton as HTMLButtonElement);

    // 根级已有同名目录时必须顺延到「新建文件夹 2」，否则后端会以 TARGET_CONFLICT 拒绝。
    await waitFor(() => expect(request).toEqual({ parentRelativePath: "", name: "新建文件夹 2" }));
  });

  it("keeps destructive category commands hidden for a selected category", async () => {
    render(<App api={createFakeApi(WORKSPACE_SNAPSHOT)} />);
    const category = await screen.findByRole("button", { name: "分类A" });
    fireEvent.click(category);
    await waitFor(() => expect(category).toHaveClass("selected"));

    expect(screen.queryByRole("button", { name: "重命名分类" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除分类" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建文件夹" })).toBeEnabled();
  });

  it("deletes an empty category directly from the Delete key", async () => {
    let request: Parameters<DnfApi["deleteCategory"]>[0] | undefined;
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      deleteCategory: async (input) => {
        request = input;
        return { ok: true, value: { relativePath: input.relativePath } };
      },
    };
    render(<App api={api} />);
    const category = await screen.findByRole("button", { name: "分类A" });
    fireEvent.click(category);
    await waitFor(() => expect(category).toHaveClass("selected"));

    fireEvent.keyDown(category, { key: "Delete" });

    await waitFor(() => expect(request).toEqual({ relativePath: "分类A", confirmed: true }));
    expect(screen.queryByRole("dialog", { name: "删除分类" })).not.toBeInTheDocument();
  });

  it("warns before attempting to delete a non-empty category", async () => {
    let request: Parameters<DnfApi["deleteCategory"]>[0] | undefined;
    const api: DnfApi = {
      ...createFakeApi({
        ...WORKSPACE_SNAPSHOT,
        childCategories: [
          { name: "分类A", relativePath: "分类A", patchCount: 1, childCategories: [] },
        ],
      }),
      deleteCategory: async (input) => {
        request = input;
        return { ok: true, value: { relativePath: input.relativePath } };
      },
    };
    render(<App api={api} />);
    const category = await screen.findByRole("button", { name: "分类A" });
    fireEvent.click(category);
    await waitFor(() => expect(category).toHaveClass("selected"));

    fireEvent.keyDown(category, { key: "Delete" });

    const dialog = await screen.findByRole("dialog", { name: "警告" });
    expect(dialog).toHaveTextContent("当前目录下还有补丁文件，是否确认删除");
    expect(request).toBeUndefined();
    fireEvent.click(within(dialog).getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(request).toEqual({ relativePath: "分类A", confirmed: true }));
  });

  it("deletes the folder targeted by the context menu", async () => {
    let request: Parameters<DnfApi["deleteCategory"]>[0] | undefined;
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      deleteCategory: async (input) => {
        request = input;
        return { ok: true, value: { relativePath: input.relativePath } };
      },
    };
    render(<App api={api} />);
    const category = await screen.findByRole("button", { name: "分类A" });
    fireEvent.contextMenu(category, { clientX: 20, clientY: 20 });
    fireEvent.click(screen.getByRole("menuitem", { name: "删除文件夹" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await waitFor(() => expect(request).toEqual({ relativePath: "分类A", confirmed: true }));
  });

  it("renames the folder targeted by the context menu", async () => {
    let request: Parameters<DnfApi["renameCategory"]>[0] | undefined;
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      renameCategory: async (input) => {
        request = input;
        return { ok: true, value: { relativePath: "分类B" } };
      },
    };
    render(<App api={api} />);
    const category = await screen.findByRole("button", { name: "分类A" });
    fireEvent.contextMenu(category, { clientX: 20, clientY: 20 });

    const rename = screen.getByRole("menuitem", { name: "重命名" });
    const remove = screen.getByRole("menuitem", { name: "删除文件夹" });
    expect(rename.compareDocumentPosition(remove)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    fireEvent.click(rename);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    const input = await screen.findByRole("textbox", { name: "重命名 分类A" });
    expect(input).toHaveValue("分类A");
    fireEvent.change(input, { target: { value: "分类B" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(request).toEqual({ relativePath: "分类A", name: "分类B" }));
  });

  it("commits the folder rename when the input loses focus", async () => {
    let request: Parameters<DnfApi["renameCategory"]>[0] | undefined;
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      renameCategory: async (input) => {
        request = input;
        return { ok: true, value: { relativePath: "分类B" } };
      },
    };
    render(<App api={api} />);
    const category = await screen.findByRole("button", { name: "分类A" });
    fireEvent.keyDown(category, { key: "F2" });
    const input = await screen.findByRole("textbox", { name: "重命名 分类A" });

    fireEvent.change(input, { target: { value: "分类B" } });
    fireEvent.blur(input);

    await waitFor(() => expect(request).toEqual({ relativePath: "分类A", name: "分类B" }));
  });

  it("cancels the folder rename when the name is unchanged on blur", async () => {
    let request: Parameters<DnfApi["renameCategory"]>[0] | undefined;
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      renameCategory: async (input) => {
        request = input;
        return { ok: true, value: { relativePath: "分类A" } };
      },
    };
    render(<App api={api} />);
    const category = await screen.findByRole("button", { name: "分类A" });
    fireEvent.keyDown(category, { key: "F2" });
    const input = await screen.findByRole("textbox", { name: "重命名 分类A" });

    fireEvent.blur(input);

    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "重命名 分类A" })).not.toBeInTheDocument(),
    );
    expect(request).toBeUndefined();
  });

  it("opens folder rename inline with F2", async () => {
    render(<App api={createFakeApi(WORKSPACE_SNAPSHOT)} />);
    const category = await screen.findByRole("button", { name: "分类A" });

    fireEvent.keyDown(category, { key: "F2" });

    expect(screen.getByRole("textbox", { name: "重命名 分类A" })).toHaveValue("分类A");
  });

  it("keeps F2 from starting a rename in a read-only library", async () => {
    const api = createFakeApi(WORKSPACE_SNAPSHOT);
    render(
      <App
        api={{
          ...api,
          getRecoveryState: async () => ({
            ok: true,
            value: { readOnly: true, files: ["D:\\app\\data\\settings.json"] },
          }),
        }}
      />,
    );
    const category = await screen.findByRole("button", { name: "分类A" });

    fireEvent.keyDown(category, { key: "F2" });

    expect(screen.queryByRole("textbox", { name: "重命名 分类A" })).not.toBeInTheDocument();
  });

  it("warns before deleting a non-empty folder from the context menu", async () => {
    let request: Parameters<DnfApi["deleteCategory"]>[0] | undefined;
    const api: DnfApi = {
      ...createFakeApi({
        ...WORKSPACE_SNAPSHOT,
        childCategories: [
          { name: "分类A", relativePath: "分类A", patchCount: 1, childCategories: [] },
        ],
      }),
      deleteCategory: async (input) => {
        request = input;
        return { ok: true, value: { relativePath: input.relativePath } };
      },
    };
    render(<App api={api} />);
    const category = await screen.findByRole("button", { name: "分类A" });
    fireEvent.contextMenu(category, { clientX: 20, clientY: 20 });
    fireEvent.click(screen.getByRole("menuitem", { name: "删除文件夹" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    const dialog = await screen.findByRole("dialog", { name: "警告" });
    expect(dialog).toHaveTextContent("当前目录下还有补丁文件，是否确认删除");
    expect(request).toBeUndefined();
  });

  it("opens the folder menu and changes its style", async () => {
    let request: Parameters<DnfApi["setCategoryStyle"]>[0] | undefined;
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      setCategoryStyle: async (input) => {
        request = input;
        return {
          ok: true,
          value: {
            styles: input.style === undefined ? {} : { [input.relativePath]: input.style },
            colors: {},
            styleColors:
              input.colorStyle === undefined || input.color === undefined
                ? {}
                : { [input.colorStyle]: input.color },
          },
        };
      },
    };
    render(<App api={api} />);
    const category = await screen.findByRole("button", { name: "分类A" });
    fireEvent.contextMenu(category, { clientX: 20, clientY: 20 });

    expect(screen.getByRole("menuitem", { name: "新增子文件夹" })).toBeInTheDocument();
    const styleButton = screen.getByRole("button", { name: "设置文件夹外观：收藏文件夹" });
    fireEvent.click(styleButton);
    await waitFor(() => expect(request).toEqual({ relativePath: "分类A", style: "star" }));
    fireEvent.change(screen.getByRole("slider", { name: "图标颜色" }), {
      target: { value: "120" },
    });
    fireEvent.pointerUp(screen.getByRole("slider", { name: "图标颜色" }));
    await waitFor(() =>
      expect(request).toEqual({
        relativePath: "分类A",
        color: "#00ff00",
        colorStyle: "star",
      }),
    );
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("creates a child from the folder menu and enters rename mode", async () => {
    let createRequest: Parameters<DnfApi["createCategory"]>[0] | undefined;
    let renameRequest: Parameters<DnfApi["renameCategory"]>[0] | undefined;
    let created = false;
    const nestedSnapshot = {
      ...WORKSPACE_SNAPSHOT,
      childCategories: [
        {
          name: "分类A",
          relativePath: "分类A",
          patchCount: 0,
          childCategories: [
            {
              name: "新建文件夹",
              relativePath: "分类A\\新建文件夹",
              patchCount: 0,
              childCategories: [],
            },
          ],
        },
      ],
    };
    const api: DnfApi = {
      ...createFakeApi(WORKSPACE_SNAPSHOT),
      createCategory: async (input) => {
        createRequest = input;
        created = true;
        return { ok: true, value: { relativePath: "分类A\\新建文件夹" } };
      },
      renameCategory: async (input) => {
        renameRequest = input;
        return { ok: true, value: { relativePath: "分类A\\新名称" } };
      },
      scan: async ({ relativePath }) => ({
        ok: true,
        value: relativePath === "" && created ? nestedSnapshot : WORKSPACE_SNAPSHOT,
      }),
    };
    render(<App api={api} />);
    const category = await screen.findByRole("button", { name: "分类A" });
    fireEvent.contextMenu(category, { clientX: 20, clientY: 20 });
    fireEvent.click(screen.getByRole("menuitem", { name: "新增子文件夹" }));

    const input = await screen.findByRole("textbox", { name: "重命名 新建文件夹" });
    expect(createRequest).toEqual({ parentRelativePath: "分类A", name: "新建文件夹" });
    fireEvent.change(input, { target: { value: "新名称" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(renameRequest).toEqual({ relativePath: "分类A\\新建文件夹", name: "新名称" }),
    );
  });
});

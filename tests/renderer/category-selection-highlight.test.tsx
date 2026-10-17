import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/renderer/App";
import type { MoveCategoryRequest } from "../../src/shared/ipc-contracts";
import { createFakeApi, WORKSPACE_SNAPSHOT } from "./fake-api";

afterEach(cleanup);

const rowRect = {
  bottom: 30,
  height: 30,
  left: 0,
  right: 200,
  top: 0,
  width: 200,
  x: 0,
  y: 0,
  toJSON: () => ({}),
};

describe("category selection highlight", () => {
  it("keeps the selected ring when the sidebar blank space is pressed", async () => {
    render(<App api={createFakeApi(WORKSPACE_SNAPSHOT)} />);

    const category = await screen.findByRole("button", { name: "分类A" });
    fireEvent.click(category);
    expect(category).toHaveClass("selected");

    fireEvent.pointerDown(screen.getByRole("navigation", { name: "补丁分类" }), { button: 0 });

    expect(category).toHaveClass("selected");
  });

  it("keeps the selected ring when the workspace blank space is pressed", async () => {
    render(<App api={createFakeApi(WORKSPACE_SNAPSHOT)} />);

    const category = await screen.findByRole("button", { name: "分类A" });
    fireEvent.click(category);
    expect(category).toHaveClass("selected");

    fireEvent.pointerDown(screen.getByRole("main", { name: "补丁工作区" }), {
      button: 0,
      clientX: 4,
      clientY: 4,
      pointerId: 1,
    });

    expect(category).toHaveClass("selected");
  });

  it("keeps the selected ring after entering a patch group", async () => {
    const snapshot = {
      ...WORKSPACE_SNAPSHOT,
      groups: WORKSPACE_SNAPSHOT.groups.map((group) => ({
        ...group,
        categoryRelativePath: "分类A",
      })),
    };
    render(<App api={createFakeApi(snapshot)} />);
    const category = await screen.findByRole("button", { name: "分类A" });
    fireEvent.click(category);
    expect(category).toHaveClass("selected");

    fireEvent.contextMenu(await screen.findByRole("button", { name: /^套装/u }));
    fireEvent.click(screen.getByRole("menuitem", { name: "进入组" }));

    await screen.findByRole("button", { name: "返回组" });
    expect(category).toHaveClass("selected");
  });
});

describe("category drop targets", () => {
  const snapshot = {
    ...WORKSPACE_SNAPSHOT,
    childCategories: [
      {
        name: "Female",
        relativePath: "Female",
        patchCount: 0,
        childCategories: [
          { name: "Male", relativePath: "Female\\Male", patchCount: 1, childCategories: [] },
        ],
      },
      { name: "Interface", relativePath: "Interface", patchCount: 0, childCategories: [] },
    ],
  };

  function moveApi(requests: MoveCategoryRequest[]) {
    return {
      ...createFakeApi(snapshot),
      moveCategory: async (request: MoveCategoryRequest) => {
        requests.push(request);
        return { ok: true as const, value: { relativePath: "Female\\Interface" } };
      },
    };
  }

  // 展开箭头是行按钮的兄弟节点，落在它上面时指针事件的 target 不是行按钮。
  // 命中区若只挂在行按钮上，这里的落点就不会更新，拖拽等于落空。
  it("accepts a drop whose pointer entered over the expand toggle", async () => {
    const requests: MoveCategoryRequest[] = [];
    render(<App api={moveApi(requests)} />);

    const source = await screen.findByRole("button", { name: "Interface" });
    const target = screen.getByRole("button", { name: "Female" });
    const toggle = screen.getByRole("button", { name: "展开 Female" });
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(rowRect);

    fireEvent.pointerDown(source, { buttons: 1, pointerId: 1 });
    fireEvent.pointerEnter(toggle, { buttons: 1, clientY: 15, pointerId: 1 });
    fireEvent.pointerUp(toggle, { pointerId: 1 });

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({
      sourceParentRelativePath: "",
      sourceRelativePath: "Interface",
      targetParentRelativePath: "Female",
    });
  });

  // 拖到源自己身上必须判为非法；此前非法落点不清空，上一次的合法落点会残留到
  // 松手时执行，把文件夹移进它自己的子树。前半段的有效拖拽是阳性对照，
  // 否则「没有请求」也可能只是因为拖拽根本没工作。
  it("drops the stale target when the pointer moves onto the dragged category itself", async () => {
    const requests: MoveCategoryRequest[] = [];
    render(<App api={moveApi(requests)} />);

    const female = await screen.findByRole("button", { name: "Female" });
    const other = screen.getByRole("button", { name: "Interface" });
    vi.spyOn(female, "getBoundingClientRect").mockReturnValue(rowRect);
    vi.spyOn(other, "getBoundingClientRect").mockReturnValue(rowRect);

    fireEvent.pointerDown(other, { buttons: 1, pointerId: 1 });
    fireEvent.pointerEnter(female, { buttons: 1, clientY: 15, pointerId: 1 });
    fireEvent.pointerUp(female, { pointerId: 1 });
    await waitFor(() => expect(requests).toHaveLength(1));

    fireEvent.pointerDown(female, { buttons: 1, pointerId: 2 });
    fireEvent.pointerEnter(other, { buttons: 1, clientY: 15, pointerId: 2 });
    fireEvent.pointerEnter(female, { buttons: 1, clientY: 15, pointerId: 2 });
    fireEvent.pointerUp(female, { pointerId: 2 });

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ sourceRelativePath: "Interface" });
  });
});

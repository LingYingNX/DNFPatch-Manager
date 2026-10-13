import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/renderer/App";
import { createFakeApi, WORKSPACE_SNAPSHOT } from "./fake-api";

afterEach(cleanup);

function itemButton(name: string): HTMLElement {
  return screen.getByRole("button", { name: new RegExp(name, "u") });
}

describe("workspace selection", () => {
  it("supports Ctrl toggling and Shift range selection", async () => {
    render(<App api={createFakeApi(WORKSPACE_SNAPSHOT)} />);
    await screen.findByText("coat.npk");

    fireEvent.click(itemButton("coat.npk"));
    fireEvent.click(itemButton("sword.npk"), { ctrlKey: true });
    expect(itemButton("coat.npk")).toHaveAttribute("aria-pressed", "true");
    expect(itemButton("sword.npk")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(itemButton("sword.npk"), { ctrlKey: true });
    expect(itemButton("coat.npk")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(itemButton("sword.npk"), { shiftKey: true });
    expect(screen.queryByRole("toolbar", { name: "选中项目操作" })).not.toBeInTheDocument();
    expect(itemButton("coat.npk")).toHaveAttribute("aria-pressed", "true");
  }, 15_000);

  it("selects every card intersected by a drag box", async () => {
    render(<App api={createFakeApi(WORKSPACE_SNAPSHOT)} />);
    await screen.findByText("coat.npk");
    const coat = itemButton("coat.npk");
    const sword = itemButton("sword.npk");
    const group = itemButton("套装");
    coat.getBoundingClientRect = () => new DOMRect(20, 20, 100, 100);
    sword.getBoundingClientRect = () => new DOMRect(140, 20, 100, 100);
    group.getBoundingClientRect = () => new DOMRect(260, 20, 100, 100);
    const grid = screen.getByRole("region", { name: "补丁项目" });

    fireEvent.pointerDown(grid, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(grid, { clientX: 250, clientY: 130, pointerId: 1 });
    fireEvent.pointerUp(grid, { pointerId: 1 });

    expect(screen.queryByRole("toolbar", { name: "选中项目操作" })).not.toBeInTheDocument();
    expect(coat).toHaveAttribute("aria-pressed", "true");
    expect(sword).toHaveAttribute("aria-pressed", "true");
    expect(group).toHaveAttribute("aria-pressed", "false");
  });

  it("selects cards when drag starts on a card preview affordance", async () => {
    render(<App api={createFakeApi(WORKSPACE_SNAPSHOT)} />);
    await screen.findByText("coat.npk");
    const coat = itemButton("coat.npk");
    const sword = itemButton("sword.npk");
    const group = itemButton("套装");
    coat.getBoundingClientRect = () => new DOMRect(20, 20, 100, 100);
    sword.getBoundingClientRect = () => new DOMRect(140, 20, 100, 100);
    group.getBoundingClientRect = () => new DOMRect(260, 20, 100, 100);
    const grid = screen.getByRole("region", { name: "补丁项目" });
    const previewAffordance = coat.parentElement?.querySelector<HTMLElement>(
      ".item-preview-hover-zone",
    );

    expect(previewAffordance).not.toBeNull();
    fireEvent.pointerDown(previewAffordance as HTMLElement, {
      clientX: 10,
      clientY: 10,
      pointerId: 1,
    });
    fireEvent.pointerMove(grid, { clientX: 250, clientY: 130, pointerId: 1 });
    fireEvent.pointerUp(grid, { pointerId: 1 });

    expect(coat).toHaveAttribute("aria-pressed", "true");
    expect(sword).toHaveAttribute("aria-pressed", "true");
    expect(group).toHaveAttribute("aria-pressed", "false");
  });

  it("waits for the drag to pass the slop before box-selecting cards", async () => {
    render(<App api={createFakeApi(WORKSPACE_SNAPSHOT)} />);
    await screen.findByText("coat.npk");
    const coat = itemButton("coat.npk");
    coat.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100);
    const workspace = screen.getByRole("main", { name: "补丁工作区" });

    fireEvent.pointerDown(workspace, { clientX: 10, clientY: 10, pointerId: 1 });
    // 三像素以内的抖动是双击，不是拖拽：这时不能改选中，否则卡片左上角预览按钮的
    // 双击换图会被框选吃掉。
    fireEvent.pointerMove(workspace, { clientX: 11, clientY: 11, pointerId: 1 });
    expect(coat).toHaveAttribute("aria-pressed", "false");

    fireEvent.pointerMove(workspace, { clientX: 60, clientY: 60, pointerId: 1 });
    expect(coat).toHaveAttribute("aria-pressed", "true");
  }, 15_000);

  it("selects cards when drag starts in empty patch workspace space", async () => {
    render(<App api={createFakeApi(WORKSPACE_SNAPSHOT)} />);
    await screen.findByText("coat.npk");
    const coat = itemButton("coat.npk");
    const sword = itemButton("sword.npk");
    const group = itemButton("套装");
    coat.getBoundingClientRect = () => new DOMRect(20, 20, 100, 100);
    sword.getBoundingClientRect = () => new DOMRect(140, 20, 100, 100);
    group.getBoundingClientRect = () => new DOMRect(260, 20, 100, 100);
    const workspace = screen.getByRole("main", { name: "补丁工作区" });

    fireEvent.pointerDown(workspace, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(workspace, { clientX: 250, clientY: 130, pointerId: 1 });
    fireEvent.pointerUp(workspace, { pointerId: 1 });

    expect(coat).toHaveAttribute("aria-pressed", "true");
    expect(sword).toHaveAttribute("aria-pressed", "true");
    expect(group).toHaveAttribute("aria-pressed", "false");
  });
});

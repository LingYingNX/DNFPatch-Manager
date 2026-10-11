import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../../src/renderer/App";
import { createFakeApi, WORKSPACE_SNAPSHOT } from "./fake-api";

afterEach(cleanup);

const readProjectFile = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("patch search field contract", () => {
  it("keeps the search control text-only and free of microphone actions", async () => {
    render(<App api={createFakeApi(WORKSPACE_SNAPSHOT)} />);

    const search = await screen.findByRole("searchbox", { name: "搜索补丁" });

    expect(search).toHaveAttribute("type", "search");
    expect(search).toHaveClass("workspace-search-input");
    expect(search.closest("label")).toHaveClass("workspace-search-field");
    expect(screen.queryByRole("button", { name: /麦克风/u })).not.toBeInTheDocument();
  });

  it("keeps the search control on the shared toolbar control language", () => {
    const stylesheet = readProjectFile("src/renderer/styles/layout.css");
    const block = stylesheet.match(/\.workspace-search-field\s*\{[\s\S]*?\n\}/u)?.[0] ?? "";
    const toolbar = readProjectFile("src/renderer/styles/toolbar.css");

    // 工作区搜索框只负责收窄宽度：颜色、圆角、高度、字体全部交给 .search-field。
    expect(block).toContain("max-width: 320px;");
    expect(block).toContain("flex: 0 1 320px;");
    expect(block).not.toMatch(/color|background|border|height|font/u);
    expect(toolbar).toContain(".search-field input::placeholder");
    expect(toolbar).toContain(".search-field:focus-within");
    // 焦点反馈与其它工具栏控件一致：图标转 primary，外框在 .search-field 里。
    expect(stylesheet).toContain(".workspace-search-field:focus-within > svg");
    // 工具栏里不再有自绘的下划线动画。
    expect(stylesheet).not.toContain(".todo-line");
    expect(stylesheet).not.toContain("workspace-search-line-draw");
  });

  it("does not ship development overlay dependencies or entry-point injection", () => {
    const entrypoint = readProjectFile("src/renderer/main.tsx");
    const packageManifest = readProjectFile("package.json");

    expect(entrypoint).not.toMatch(/react-(grab|scan)/u);
    expect(packageManifest).not.toMatch(/"react-(grab|scan)"/u);
  });
});

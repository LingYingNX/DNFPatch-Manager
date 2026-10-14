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

/** 取出样式表里某个选择器的规则块，供逐条断言。 */
const cssRuleOf = (stylesheet: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return stylesheet.match(new RegExp(`${escaped}\\s*\\{[\\s\\S]*?\\n\\}`, "u"))?.[0] ?? "";
};

describe("patch search field contract", () => {
  it("keeps the search control text-only and free of microphone actions", async () => {
    render(<App api={createFakeApi(WORKSPACE_SNAPSHOT)} />);

    const search = await screen.findByRole("searchbox", { name: "搜索补丁" });

    expect(search).toHaveAttribute("type", "search");
    expect(search).toHaveClass("workspace-search-input");
    expect(search.closest("label")).toHaveClass("workspace-search-field");
    expect(screen.queryByRole("button", { name: /麦克风/u })).not.toBeInTheDocument();
  });

  it("renders the nebula particles as decoration after the input", async () => {
    render(<App api={createFakeApi(WORKSPACE_SNAPSHOT)} />);

    const search = await screen.findByRole("searchbox", { name: "搜索补丁" });
    const field = search.closest("label");

    // 6 个落点照搬源设计；少一个就不是那套粒子了。
    expect(field?.querySelectorAll(".nebula-particle")).toHaveLength(6);
    // 必须紧跟在 input 之后：toolbar.css 的 `input:focus ~ .nebula-particle` 靠兄弟顺序选中。
    expect(search.nextElementSibling).toHaveClass("nebula-particle");
    // 纯装饰，不能被读屏念出来。
    for (const particle of field?.querySelectorAll(".nebula-particle") ?? []) {
      expect(particle).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("keeps the search control on the shared toolbar control language", () => {
    const stylesheet = readProjectFile("src/renderer/styles/layout.css");
    const block = stylesheet.match(/\.workspace-search-field\s*\{[\s\S]*?\n\}/u)?.[0] ?? "";
    const toolbar = readProjectFile("src/renderer/styles/toolbar.css");

    // 工作区搜索框只负责占位：宽度、颜色、圆角、高度、字体全部交给 .search-field。
    expect(block).toContain("flex: none;");
    expect(block).not.toMatch(/color|background|border|height|font/u);
    expect(toolbar).toContain(".search-field input::placeholder");
    expect(toolbar).toContain(".search-field:focus-within");
    // 焦点反馈与其它工具栏控件一致：图标转 primary，外框在 .search-field 里。
    expect(stylesheet).toContain(".workspace-search-field:focus-within > svg");
    // 工具栏里不再有自绘的下划线动画。
    expect(stylesheet).not.toContain(".todo-line");
    expect(stylesheet).not.toContain("workspace-search-line-draw");
  });

  it("paints the search field as the nebula box with a purple focus glow", () => {
    const toolbar = readProjectFile("src/renderer/styles/toolbar.css");
    const fieldBlock = toolbar.match(/\.search-field\s*\{[\s\S]*?\n\}/u)?.[0] ?? "";
    const focusBlock = toolbar.match(/\.search-field:focus-within\s*\{[\s\S]*?\n\}/u)?.[0] ?? "";

    // 半透明底 + 2px 描边是星云框的固定外观，换回 --color-field-* 就不再透壁纸。
    expect(fieldBlock).toContain("background: var(--color-nebula-surface);");
    expect(fieldBlock).toContain("border: 2px solid var(--color-nebula-border);");
    // 聚焦：描边由 2px 收到 1px 并转亮紫，再叠一层单层紫辉光。
    // 这里用紫是刻意的，与「品牌紫专指选中」的旧约定分家——紫辉光就是星云设计的签名。
    expect(focusBlock).toContain("border-width: 1px;");
    expect(focusBlock).toContain("border-color: var(--color-nebula-border-focus);");
    expect(focusBlock).toContain("box-shadow: 0 4px 14px var(--color-nebula-glow);");
    // 粒子靠兄弟选择器触发，选择器与关键帧缺一不可。
    expect(toolbar).toContain(".search-field input:focus ~ .nebula-particle");
    expect(toolbar).toContain("@keyframes nebula-float");
  });

  it("gives every theme its own inset-well token set", () => {
    const tokens = readProjectFile("src/renderer/styles/tokens.css");
    const blockOf = (selector: string): string => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      return tokens.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`, "u"))?.[1] ?? "";
    };
    const readerOf =
      (block: string) =>
      (token: string): string =>
        block.match(new RegExp(`${token}:\\s*([^;]+);`, "u"))?.[1]?.trim() ?? "";
    const rootValueOf = readerOf(blockOf(":root"));
    const fieldTokens = [
      "--color-field-surface",
      "--color-field-border",
      "--color-field-border-focus",
      // 星云框自己那套：同样必须每个主题各自声明，否则高对比主题会继承默认主题
      // 那组给 #151d2b 配的深色值，纯黑上等于没画框。
      "--color-nebula-surface",
      "--color-nebula-border",
      "--color-nebula-border-focus",
      "--color-nebula-glow",
    ];
    const themes = [
      { label: "默认", selector: ":root" },
      { label: "高对比", selector: ':root[data-theme="high-contrast"]' },
      { label: "玻璃", selector: ':root[data-theme="glass"]' },
    ];

    for (const theme of themes) {
      const declaredOf = readerOf(blockOf(theme.selector));
      // 主题没声明的 token 沿用默认主题的值（CSS 变量就是这样继承的），
      // 所以比较「同色/品牌色」时要按解析后的值比，不能只看本块。
      const resolvedOf = (token: string): string => declaredOf(token) || rootValueOf(token);

      for (const token of fieldTokens) {
        // 每个主题都要自带凹槽三件套。
        expect(declaredOf(token), `${theme.label}主题缺 ${token}`).not.toBe("");
        // 而且必须真的改过值：留成默认主题那组等于没覆盖——那组是给 #151d2b 画布
        // 配的，搬到高对比的纯黑上框底差只剩 1.39:1、描边差 1.15:1，2px 边框等于没画。
        if (theme.selector !== ":root") {
          expect(declaredOf(token), `${theme.label}主题的 ${token} 与默认主题同值`).not.toBe(
            rootValueOf(token),
          );
        }
      }
      // 凹槽要在本主题里真的凹下去：底和描边都不能与本主题的面板值重合。
      expect(
        resolvedOf("--color-field-surface"),
        `${theme.label}主题的凹槽底与面板底同色`,
      ).not.toBe(resolvedOf("--color-surface"));
      expect(
        resolvedOf("--color-field-border"),
        `${theme.label}主题的凹槽描边与普通描边同色`,
      ).not.toBe(resolvedOf("--color-border"));
      // 聚焦描边不能退回品牌色：那个色相全站留给「选中」。
      expect(
        resolvedOf("--color-field-border-focus"),
        `${theme.label}主题的聚焦描边用了品牌色`,
      ).not.toBe(resolvedOf("--color-primary"));
    }
  });

  it("does not stack a container focus ring on top of the pressed segment ring", () => {
    const toolbar = readProjectFile("src/renderer/styles/toolbar.css");

    // 回归守卫：容器 focus-within 画紫环的同时按钮选中又画紫 inset 环，
    // 鼠标点一下就会在同屏出现两个紫环。
    expect(toolbar).not.toMatch(/\.view-mode-control:focus-within/u);
    const focusVisible = cssRuleOf(toolbar, ".view-mode-control button:focus-visible");
    expect(focusVisible).toContain("box-shadow: none;");
    // 焦点和选中必须用两种色相，否则同屏仍会看混。
    expect(focusVisible).toContain("var(--color-field-border-focus)");
    // 轨道内边距和分段间隙都只有 2px：offset 只要不是 0，2px 的环就会压进相邻分段。
    expect(focusVisible).toContain("outline-offset: 0;");

    // 未聚焦的选中块保留全站「选中」紫环。
    const pressedBlock = cssRuleOf(toolbar, '.view-mode-control button[aria-pressed="true"]');
    expect(pressedBlock).toContain("var(--selection-ring-color)");

    // 键盘焦点落在选中块上时紫环必须让位：30px 分段上紫蓝两圈并排等于一条双色粗边。
    const pressedFocused = cssRuleOf(
      toolbar,
      '.view-mode-control button[aria-pressed="true"]:focus-visible',
    );
    expect(pressedFocused).toContain("box-shadow: none;");
    expect(pressedFocused).not.toContain("--selection-ring");
  });

  it("does not ship development overlay dependencies or entry-point injection", () => {
    const entrypoint = readProjectFile("src/renderer/main.tsx");
    const packageManifest = readProjectFile("package.json");

    expect(entrypoint).not.toMatch(/react-(grab|scan)/u);
    expect(packageManifest).not.toMatch(/"react-(grab|scan)"/u);
  });
});

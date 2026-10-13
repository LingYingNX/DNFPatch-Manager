import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

/** 取出样式表里某个选择器的规则块，供逐条断言。 */
const cssRuleOf = (stylesheet: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return stylesheet.match(new RegExp(`${escaped}\\s*\\{[\\s\\S]*?\\n\\}`, "u"))?.[0] ?? "";
};

/** 从规则块里取自定义属性的字面值。 */
const tokenValueOf = (block: string, token: string): string =>
  block.match(new RegExp(`${token}:\\s*([^;]+);`, "u"))?.[1]?.trim() ?? "";

const srgbChannel = (value: number): number => {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]: readonly [number, number, number]): number =>
  0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b);

const contrastRatio = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number => {
  const ordered = [luminance(a), luminance(b)].sort((x, y) => y - x);
  const lighter = ordered[0] ?? 0;
  const darker = ordered[1] ?? 0;
  return (lighter + 0.05) / (darker + 0.05);
};

const hexToRgb = (hex: string): readonly [number, number, number] => {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
};

describe("theme field token coverage", () => {
  const tokens = readProjectFile("src/renderer/styles/tokens.css");
  const fieldTokens = [
    "--color-field-surface",
    "--color-field-border",
    "--color-field-border-focus",
  ];

  it("keeps the inset field palette in every theme", () => {
    // 凹槽输入框的底与描边如果只有 halo 一档配色：玻璃主题会在壁纸上糊出不透明的
    // 死色方块，高对比度主题会退化成 1.15:1 的描边（2px 等于没画）。标志色可以只换
    // 一个，这组容器色必须成套换。
    for (const theme of ["glass", "high-contrast"]) {
      const block = cssRuleOf(tokens, `:root[data-theme="${theme}"]`);
      expect(block, `${theme} 主题块缺失`).not.toBe("");
      for (const token of fieldTokens) {
        expect(tokenValueOf(block, token), `${theme} 未覆盖 ${token}`).not.toBe("");
      }
    }
  });

  it("keeps the glass field surface translucent so the wallpaper still shows through", () => {
    // 「透明玻璃」主题的整个前提是底能透出壁纸；不透明的 field-surface 会让搜索框与
    // 视图切换轨道变成两块死色方块，工具栏上就剩它们不跟着主题走。
    const block = cssRuleOf(tokens, ':root[data-theme="glass"]');
    expect(tokenValueOf(block, "--color-field-surface")).toMatch(/^rgba?\(/u);
  });

  it("keeps the high-contrast field border light enough to be seen against the black canvas", () => {
    // 高对比度主题的描边是唯一能勾出凹槽的东西，按 WCAG 非文本对比度下限 3:1 卡住。
    const block = cssRuleOf(tokens, ':root[data-theme="high-contrast"]');
    const surface = hexToRgb(tokenValueOf(block, "--color-field-surface"));
    const border = hexToRgb(tokenValueOf(block, "--color-field-border"));

    expect(contrastRatio(surface, border)).toBeGreaterThanOrEqual(3);
  });
});

describe("high-contrast text hierarchy", () => {
  const tokens = readProjectFile("src/renderer/styles/tokens.css");
  const textTokens = ["--color-text-primary", "--color-text-secondary", "--color-text-tertiary"];

  it("defines every text tier instead of inheriting the halo value", () => {
    // 这一块换了画布（#151d2b → #000000）就等于换了底色，文字必须跟着自己定。三级
    // 文字漏掉时继承的是给深蓝底调的 #5c6170，在纯黑上只剩 3.4:1：一个叫「高对比度」
    // 的主题，底部文字反而比它取代的默认主题更难读。CSS 不会为漏掉的那一档报警。
    const block = cssRuleOf(tokens, ':root[data-theme="high-contrast"]');
    for (const token of textTokens) {
      expect(tokenValueOf(block, token), `high-contrast 未覆盖 ${token}`).not.toBe("");
    }
  });

  it("keeps every text tier at or above the 4.5:1 body-text floor on both backdrops", () => {
    // 三级文字同时出现在画布（设置页说明文字）与卡片面（日期、体积）上，两处都要够。
    const block = cssRuleOf(tokens, ':root[data-theme="high-contrast"]');
    const backdrops = [
      ["画布", tokenValueOf(block, "--color-canvas")],
      ["卡片面", tokenValueOf(block, "--color-surface")],
    ] as const;

    for (const token of textTokens) {
      const rgb = hexToRgb(tokenValueOf(block, token));
      for (const [name, backdrop] of backdrops) {
        expect(
          contrastRatio(rgb, hexToRgb(backdrop)),
          `${token} 在${name}上的对比度不足`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

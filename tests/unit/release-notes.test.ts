import { describe, expect, it } from "vitest";
import { normalizeReleaseNotes, selectReleaseNotes } from "../../src/main/ipc/release-notes";

describe("release notes", () => {
  it("preserves GitHub Markdown headings, paragraphs and bullet grouping", () => {
    const body = [
      "## 更新日志",
      "",
      "【新增】",
      "- 补丁 A",
      "- 补丁 B",
      "",
      "【修复】",
      "- 修复 C",
    ].join("\r\n");

    expect(normalizeReleaseNotes(body)).toEqual([
      "## 更新日志",
      "",
      "【新增】",
      "- 补丁 A",
      "- 补丁 B",
      "",
      "【修复】",
      "- 修复 C",
    ]);
  });

  it("prefers GitHub release notes over updater metadata and local fallback", () => {
    expect(
      selectReleaseNotes(
        "1.4.0",
        ["updater note"],
        ["## GitHub note", "- authoritative"],
        "1.3.0",
        ["local note"],
      ),
    ).toEqual(["## GitHub note", "- authoritative"]);
  });

  it("falls back to updater notes when GitHub is unavailable", () => {
    expect(selectReleaseNotes("1.4.0", ["updater note"], [], "1.3.0", ["local note"])).toEqual([
      "updater note",
    ]);
  });
});

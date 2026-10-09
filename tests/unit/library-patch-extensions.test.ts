import { describe, expect, it } from "vitest";
import {
  isLibraryPatchPath,
  isVideoPatchPath,
  libraryPatchBaseName,
  libraryPatchExtension,
} from "../../src/shared/library-patch-extensions";

describe("library patch extensions", () => {
  it.each(["coat.npk", "coat.NPK", "Armor\\coat.NpK", "Armor/coat.npk", "buff.bk2", "BUFF.BK2"])(
    "accepts %s as a library patch",
    (path) => {
      expect(isLibraryPatchPath(path)).toBe(true);
    },
  );

  it.each(["coat.bik", "coat.npkx", "coat.png", "npk", "coat", "", "Armor\\buff.BK2.backup"])(
    "rejects %s as a library patch",
    (path) => {
      expect(isLibraryPatchPath(path)).toBe(false);
    },
  );

  it("treats only .bk2 as a video patch", () => {
    expect(isVideoPatchPath("buff.bk2")).toBe(true);
    expect(isVideoPatchPath("Buff.BK2")).toBe(true);
    expect(isVideoPatchPath("Armor\\buff.bk2")).toBe(true);
    expect(isVideoPatchPath("coat.npk")).toBe(false);
    expect(isVideoPatchPath("coat.bik")).toBe(false);
  });

  it("returns the patch extension with a fallback for unknown suffixes", () => {
    expect(libraryPatchExtension("coat.npk")).toBe(".npk");
    expect(libraryPatchExtension("BUFF.BK2")).toBe(".bk2");
    expect(libraryPatchExtension("notes.txt")).toBe(".npk");
    expect(libraryPatchExtension("no-extension")).toBe(".npk");
  });

  it("strips only the extension when computing the base name", () => {
    expect(libraryPatchBaseName("coat.npk")).toBe("coat");
    expect(libraryPatchBaseName("Armor\\coat.NPK")).toBe("coat");
    expect(libraryPatchBaseName("Armor/0A 冰雪女剑buff.bk2")).toBe("0A 冰雪女剑buff");
    expect(libraryPatchBaseName("no-extension")).toBe("no-extension");
    expect(libraryPatchBaseName("Armor\\a.b.c.npk")).toBe("a.b.c");
  });

  it("keeps a dotted directory name out of the extension", () => {
    expect(isLibraryPatchPath("v1.0\\coat.npk")).toBe(true);
    expect(isVideoPatchPath("v1.0\\buff")).toBe(false);
    expect(libraryPatchBaseName("v1.0\\buff.bk2")).toBe("buff");
  });
});

import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importPatches } from "../../src/core/library/import-patches";
import { resolveAppPaths } from "../../src/main/app-paths";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function createImportFixture(): Promise<{
  readonly sourceDirectory: string;
  readonly category: string;
  readonly libraryRoot: ReturnType<typeof resolveAppPaths>["libraryRoot"];
}> {
  const projectRoot = await mkdtemp(join(tmpdir(), "dnf-import-"));
  temporaryDirectories.push(projectRoot);
  const { libraryRoot } = resolveAppPaths({ mode: "development", projectRoot });
  const category = join(libraryRoot, "鬼剑士女");
  const sourceDirectory = join(projectRoot, "incoming");
  await Promise.all([mkdir(category, { recursive: true }), mkdir(sourceDirectory)]);
  return { sourceDirectory, category, libraryRoot };
}

describe("patch import", () => {
  it("rejects a non-NPK selection before copying any file", async () => {
    const { sourceDirectory, category, libraryRoot } = await createImportFixture();
    const patch = join(sourceDirectory, "coat.npk");
    const text = join(sourceDirectory, "notes.txt");
    await Promise.all([writeFile(patch, "coat"), writeFile(text, "notes")]);

    const result = await importPatches({
      libraryRoot,
      categoryRelativePath: "鬼剑士女",
      sourcePaths: [patch, text],
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "INVALID_IMPORT_SOURCE", sourcePath: text },
    });
    await expect(access(join(category, "coat.npk"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("blocks the whole import when a later target has different content", async () => {
    const { sourceDirectory, category, libraryRoot } = await createImportFixture();
    const newPatch = join(sourceDirectory, "coat.npk");
    const conflictingPatch = join(sourceDirectory, "weapon.npk");
    await Promise.all([
      writeFile(newPatch, "coat"),
      writeFile(conflictingPatch, "incoming-weapon"),
      writeFile(join(category, "weapon.npk"), "existing-weapon"),
    ]);

    const result = await importPatches({
      libraryRoot,
      categoryRelativePath: "鬼剑士女",
      sourcePaths: [newPatch, conflictingPatch],
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "TARGET_CONFLICT", relativePath: "鬼剑士女\\weapon.npk" },
    });
    await expect(access(join(category, "coat.npk"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports identical targets as duplicates and copies only new patches", async () => {
    const { sourceDirectory, category, libraryRoot } = await createImportFixture();
    const duplicate = join(sourceDirectory, "weapon.npk");
    const newPatch = join(sourceDirectory, "coat.npk");
    await Promise.all([
      writeFile(duplicate, "same-weapon"),
      writeFile(join(category, "weapon.npk"), "same-weapon"),
      writeFile(newPatch, "new-coat"),
    ]);

    const result = await importPatches({
      libraryRoot,
      categoryRelativePath: "鬼剑士女",
      sourcePaths: [duplicate, newPatch],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        importedRelativePaths: ["鬼剑士女\\coat.npk"],
        duplicateRelativePaths: ["鬼剑士女\\weapon.npk"],
      },
    });
    expect(await readFile(join(category, "coat.npk"), "utf8")).toBe("new-coat");
  });

  it("imports a BK2 video patch alongside NPK patches", async () => {
    // Given: an incoming folder with one NPK and one BK2.
    const { sourceDirectory, category, libraryRoot } = await createImportFixture();
    const patch = join(sourceDirectory, "coat.npk");
    const video = join(sourceDirectory, "0A 冰雪女剑buff.bk2");
    await Promise.all([writeFile(patch, "coat"), writeFile(video, "bk2-bytes")]);

    // When: both are imported into one category.
    const result = await importPatches({
      libraryRoot,
      categoryRelativePath: "鬼剑士女",
      sourcePaths: [patch, video],
    });

    // Then: the BK2 is copied verbatim under its original name.
    expect(result).toEqual({
      ok: true,
      value: {
        importedRelativePaths: ["鬼剑士女\\coat.npk", "鬼剑士女\\0A 冰雪女剑buff.bk2"],
        duplicateRelativePaths: [],
      },
    });
    expect(await readFile(join(category, "0A 冰雪女剑buff.bk2"), "utf8")).toBe("bk2-bytes");
  });

  it("rejects a .bik file because only .bk2 is a supported video patch", async () => {
    // Given: an incoming folder holding a Bink 1 (.bik) file.
    const { sourceDirectory, category, libraryRoot } = await createImportFixture();
    const bik = join(sourceDirectory, "legacy.bik");
    await writeFile(bik, "bink1-bytes");

    // When: the import is attempted.
    const result = await importPatches({
      libraryRoot,
      categoryRelativePath: "鬼剑士女",
      sourcePaths: [bik],
    });

    // Then: the unsupported video container is refused before any copy.
    expect(result).toEqual({
      ok: false,
      error: { code: "INVALID_IMPORT_SOURCE", sourcePath: bik },
    });
    await expect(access(join(category, "legacy.bik"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("treats an identical BK2 as a duplicate and refuses a differing one", async () => {
    // Given: one BK2 already in the library and two incoming BK2 files,
    // one byte-identical and one with different content.
    const { sourceDirectory, category, libraryRoot } = await createImportFixture();
    const same = join(sourceDirectory, "same.bk2");
    await writeFile(join(category, "same.bk2"), "existing-bk2");
    await Promise.all([writeFile(same, "existing-bk2")]);

    // When: the identical BK2 is imported.
    const duplicated = await importPatches({
      libraryRoot,
      categoryRelativePath: "鬼剑士女",
      sourcePaths: [same],
    });

    // Then: it is reported as a duplicate without rewriting the library copy.
    expect(duplicated).toEqual({
      ok: true,
      value: {
        importedRelativePaths: [],
        duplicateRelativePaths: ["鬼剑士女\\same.bk2"],
      },
    });

    // And: a BK2 whose bytes differ blocks the whole import.
    const other = join(sourceDirectory, "other.bk2");
    await writeFile(join(category, "other.bk2"), "existing-other");
    await writeFile(other, "incoming-other");
    expect(
      await importPatches({
        libraryRoot,
        categoryRelativePath: "鬼剑士女",
        sourcePaths: [other],
      }),
    ).toEqual({
      ok: false,
      error: { code: "TARGET_CONFLICT", relativePath: "鬼剑士女\\other.bk2" },
    });
  });
});

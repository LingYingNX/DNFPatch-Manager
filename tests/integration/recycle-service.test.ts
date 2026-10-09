import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createManagedImageAssets } from "../../src/core/assets/managed-image-assets";
import { createVirtualGroupService } from "../../src/core/groups/group-service";
import { createPreviewService } from "../../src/core/previews/preview-service";
import { createPreviewStateStore } from "../../src/core/previews/preview-state";
import { createRecycleService } from "../../src/core/recycle/recycle-service";
import { resolveAppPaths } from "../../src/main/app-paths";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function createRecycleFixture(): Promise<ReturnType<typeof resolveAppPaths>> {
  const projectRoot = await mkdtemp(join(tmpdir(), "dnf-recycle-"));
  temporaryDirectories.push(projectRoot);
  const paths = resolveAppPaths({ mode: "development", projectRoot });
  await Promise.all([
    mkdir(join(paths.libraryRoot, "分类A"), { recursive: true }),
    mkdir(paths.dataRoot, { recursive: true }),
  ]);
  return paths;
}

describe("recycle service", () => {
  it("lists recycled entries for the recycle-bin view", async () => {
    const paths = await createRecycleFixture();
    const service = createRecycleService({
      ...paths,
      createId: () => "a2021aa5-e024-4106-a0a3-f0874d4c9ec9",
      now: () => new Date("2026-07-18T00:00:00.000Z"),
    });
    await writeFile(join(paths.libraryRoot, "分类A", "coat.npk"), "coat");

    await service.recycle({ kind: "patch", relativePath: "分类A\\coat.npk" });

    await expect(service.list()).resolves.toEqual({
      ok: true,
      value: [
        {
          id: "a2021aa5-e024-4106-a0a3-f0874d4c9ec9",
          kind: "patch",
          originalRelativePath: "分类A\\coat.npk",
          recycledRelativePath: "a2021aa5-e024-4106-a0a3-f0874d4c9ec9\\coat.npk",
          recycledAt: "2026-07-18T00:00:00.000Z",
          size: 4,
        },
      ],
    });
  });

  it("recycles and restores every live virtual-group member without a game directory", async () => {
    const paths = await createRecycleFixture();
    await Promise.all([
      writeFile(join(paths.libraryRoot, "分类A", "top.npk"), "top"),
      writeFile(join(paths.libraryRoot, "分类A", "bottom.npk"), "bottom"),
      writeFile(join(paths.dataRoot, "group-preview.png"), "preview"),
    ]);
    const groupId = "0552babf-49b5-4390-96a7-1846a0c1e9f8";
    const groups = createVirtualGroupService({
      dataRoot: paths.dataRoot,
      libraryRoot: paths.libraryRoot,
      createId: () => groupId,
    });
    const created = await groups.create({
      categoryRelativePath: "分类A",
      memberRelativePaths: ["分类A\\top.npk", "分类A\\bottom.npk"],
      name: "套装",
    });
    if (!created.ok) throw new Error("Expected virtual group creation to succeed");
    const previews = createPreviewService({
      assets: createManagedImageAssets({
        assetsRoot: join(paths.dataRoot, "previews"),
        createId: () => "01234567-89ab-4cde-8fab-0123456789ab",
        kind: "preview",
      }),
      store: createPreviewStateStore(join(paths.dataRoot, "previews.json")),
    });
    await previews.set({
      kind: "group",
      groupId,
      sourcePath: join(paths.dataRoot, "group-preview.png"),
    });
    const recycleIds = [
      "a2021aa5-e024-4106-a0a3-f0874d4c9ec9",
      "bbfa906c-b853-4424-b053-11b21e364f4b",
    ];
    const service = createRecycleService({
      ...paths,
      groups,
      previews,
      createId: () => recycleIds.shift() ?? crypto.randomUUID(),
      now: () => new Date("2026-07-18T01:00:00.000Z"),
    });

    const recycled = await service.recycle({ kind: "group", groupId });
    await expect(access(join(paths.libraryRoot, "分类A", "top.npk"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(join(paths.libraryRoot, "分类A", "bottom.npk"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(join(paths.libraryRoot, "分类A", "套装"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(recycled).toMatchObject({
      ok: true,
      value: { entry: { kind: "patch" } },
    });
    await expect(groups.get(groupId)).resolves.toMatchObject({
      ok: false,
      error: { code: "GROUP_NOT_FOUND", id: groupId },
    });
    await expect(previews.listActive()).resolves.toEqual({ ok: true, value: [] });

    const entries = await service.list();
    if (!entries.ok) throw new Error("Expected recycle entries");
    expect(
      entries.value
        .map((entry) => ({ kind: entry.kind, originalRelativePath: entry.originalRelativePath }))
        .sort((left, right) => left.originalRelativePath.localeCompare(right.originalRelativePath)),
    ).toEqual([
      { kind: "patch", originalRelativePath: "分类A\\bottom.npk" },
      { kind: "patch", originalRelativePath: "分类A\\top.npk" },
    ]);
    for (const entry of entries.value) {
      await expect(service.restore({ id: entry.id })).resolves.toEqual({
        ok: true,
        value: { relativePath: entry.originalRelativePath },
      });
    }

    expect(await readFile(join(paths.libraryRoot, "分类A", "top.npk"), "utf8")).toBe("top");
    expect(await readFile(join(paths.libraryRoot, "分类A", "bottom.npk"), "utf8")).toBe("bottom");
  });

  it("keeps both copies when restore target is occupied", async () => {
    const paths = await createRecycleFixture();
    const patch = join(paths.libraryRoot, "分类A", "coat.npk");
    await writeFile(patch, "original");
    const service = createRecycleService({
      ...paths,
      createId: () => "a2021aa5-e024-4106-a0a3-f0874d4c9ec9",
      now: () => new Date("2026-07-18T01:00:00.000Z"),
    });
    await service.recycle({ kind: "patch", relativePath: "分类A\\coat.npk" });
    await writeFile(patch, "replacement");

    const result = await service.restore({ id: "a2021aa5-e024-4106-a0a3-f0874d4c9ec9" });

    expect(result).toEqual({
      ok: false,
      error: { code: "TARGET_CONFLICT", relativePath: "分类A\\coat.npk" },
    });
    expect(await readFile(patch, "utf8")).toBe("replacement");
    const recycledPath = join(
      paths.dataRoot,
      "recycle-bin",
      "a2021aa5-e024-4106-a0a3-f0874d4c9ec9",
      "coat.npk",
    );
    expect(await readFile(recycledPath, "utf8")).toBe("original");
  });

  it("does not move files when the recycle manifest is corrupted", async () => {
    const paths = await createRecycleFixture();
    const patch = join(paths.libraryRoot, "分类A", "coat.npk");
    await writeFile(patch, "original");
    await mkdir(paths.dataRoot, { recursive: true });
    await writeFile(join(paths.dataRoot, "recycle-bin.json"), "{broken");
    const service = createRecycleService({ ...paths });

    const result = await service.recycle({ kind: "patch", relativePath: "分类A\\coat.npk" });

    expect(result).toMatchObject({ ok: false, error: { code: "STATE_CORRUPTED" } });
    expect(await readFile(patch, "utf8")).toBe("original");
  });

  it("deletes a matching library preview when emptying recycled patches", async () => {
    const paths = await createRecycleFixture();
    const category = join(paths.libraryRoot, "分类A");
    await Promise.all([
      writeFile(join(category, "coat.npk"), "coat"),
      writeFile(join(category, "coat.png"), "preview"),
      writeFile(join(category, "other.png"), "keep"),
    ]);
    const service = createRecycleService({
      ...paths,
      createId: () => "a2021aa5-e024-4106-a0a3-f0874d4c9ec9",
    });
    await service.recycle({ kind: "patch", relativePath: "分类A\\coat.npk" });

    const emptied = await service.empty({ confirmed: true });

    expect(emptied).toEqual({ ok: true, value: { removedCount: 1 } });
    await expect(access(join(category, "coat.png"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(category, "other.png"), "utf8")).toBe("keep");
  });

  it("deletes the hover MP4 preview of a recycled BK2 when emptying", async () => {
    // Given: a BK2 patch with both its still cover and its hover MP4 alongside it.
    const paths = await createRecycleFixture();
    const category = join(paths.libraryRoot, "分类A");
    await Promise.all([
      writeFile(join(category, "clip.bk2"), "bk2"),
      writeFile(join(category, "clip.jpg"), "cover"),
      writeFile(join(category, "clip.mp4"), "playback"),
      writeFile(join(category, "keep.mp4"), "keep"),
    ]);
    const service = createRecycleService({
      ...paths,
      createId: () => "a2021aa5-e024-4106-a0a3-f0874d4c9ec9",
    });
    await service.recycle({ kind: "patch", relativePath: "分类A\\clip.bk2" });

    // When: the recycle bin is emptied.
    const emptied = await service.empty({ confirmed: true });

    // Then: both media previews are removed, and an unrelated MP4 survives.
    expect(emptied).toEqual({ ok: true, value: { removedCount: 1 } });
    await expect(access(join(category, "clip.jpg"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(category, "clip.mp4"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(category, "keep.mp4"), "utf8")).toBe("keep");
  });

  it("deletes the hover MP4 preview when individually deleting a recycled BK2", async () => {
    // Given: a recycled BK2 whose media previews still sit in the category.
    const paths = await createRecycleFixture();
    const category = join(paths.libraryRoot, "分类A");
    await Promise.all([
      writeFile(join(category, "clip.bk2"), "bk2"),
      writeFile(join(category, "clip.mp4"), "playback"),
    ]);
    const service = createRecycleService({
      ...paths,
      createId: () => "a2021aa5-e024-4106-a0a3-f0874d4c9ec9",
    });
    const recycled = await service.recycle({ kind: "patch", relativePath: "分类A\\clip.bk2" });
    expect(recycled.ok).toBe(true);

    // When: only that recycled entry is deleted.
    const deleted = await service.deleteMany({
      ids: ["a2021aa5-e024-4106-a0a3-f0874d4c9ec9"],
    });

    // Then: the orphaned hover video goes with it.
    expect(deleted).toEqual({
      ok: true,
      value: { deletedIds: ["a2021aa5-e024-4106-a0a3-f0874d4c9ec9"] },
    });
    await expect(access(join(category, "clip.mp4"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("requires explicit confirmation before emptying recycled files", async () => {
    const paths = await createRecycleFixture();
    const patch = join(paths.libraryRoot, "分类A", "coat.npk");
    await writeFile(patch, "original");
    const service = createRecycleService({
      ...paths,
      createId: () => "a2021aa5-e024-4106-a0a3-f0874d4c9ec9",
    });
    await service.recycle({ kind: "patch", relativePath: "分类A\\coat.npk" });
    const recycledPath = join(
      paths.dataRoot,
      "recycle-bin",
      "a2021aa5-e024-4106-a0a3-f0874d4c9ec9",
      "coat.npk",
    );

    const rejected = await service.empty({ confirmed: false });

    expect(rejected).toEqual({ ok: false, error: { code: "CONFIRMATION_REQUIRED" } });
    await expect(access(recycledPath)).resolves.toBeUndefined();

    const emptied = await service.empty({ confirmed: true });

    expect(emptied).toEqual({ ok: true, value: { removedCount: 1 } });
    await expect(access(recycledPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(join(paths.dataRoot, "recycle-bin.json"), "utf8"))).toEqual({
      formatVersion: 1,
      items: [],
    });
  });
});

import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeFileTransaction } from "../../src/core/filesystem/file-transaction";
import { createVirtualGroupService } from "../../src/core/groups/group-service";
import { createInstallService } from "../../src/core/install/install-service";
import { parseGameRoot, resolveAppPaths } from "../../src/main/app-paths";
import { buildNpkBytes } from "./npk-fixture";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function createInstallFixture(): Promise<{
  readonly paths: ReturnType<typeof resolveAppPaths>;
  readonly gameRoot: ReturnType<typeof parseGameRoot>;
}> {
  const projectRoot = await mkdtemp(join(tmpdir(), "dnf-install-"));
  temporaryDirectories.push(projectRoot);
  const paths = resolveAppPaths({ mode: "development", projectRoot });
  const gameDirectory = join(projectRoot, "game");
  await Promise.all([
    mkdir(join(paths.libraryRoot, "分类A"), { recursive: true }),
    mkdir(gameDirectory),
  ]);
  return { paths, gameRoot: parseGameRoot(gameDirectory) };
}

describe("install service", () => {
  it("rolls back the first copy when a later enable transaction step fails", async () => {
    // Given: two valid patches and a transaction executor that fails after its first copy.
    const { paths, gameRoot } = await createInstallFixture();
    await writeFile(join(paths.libraryRoot, "first.npk"), "first");
    await writeFile(join(paths.libraryRoot, "second.npk"), "second");
    const service = createInstallService({
      ...paths,
      gameRoot,
      executeTransaction: async (steps) => {
        const [firstStep, ...remainingSteps] = steps;
        if (firstStep === undefined) return executeFileTransaction(steps);
        return executeFileTransaction([
          firstStep,
          {
            apply: async () => {
              throw new Error("injected transaction failure");
            },
            compensate: async () => {},
          },
          ...remainingSteps,
        ]);
      },
    });

    // When: the batch starts applying its files.
    const result = await service.enableMany([
      { kind: "patch", relativePath: "first.npk" },
      { kind: "patch", relativePath: "second.npk" },
    ]);

    // Then: the copied first target and the absent state are restored exactly.
    expect(result).toEqual({ ok: false, error: { code: "TRANSACTION_FAILED" } });
    expect(await readdir(gameRoot)).toEqual([]);
    await expect(readFile(join(paths.dataRoot, "installation-state.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("changes no game or state bytes when the second batch item conflicts", async () => {
    // Given: two patches, with the second target already occupied.
    const { paths, gameRoot } = await createInstallFixture();
    await writeFile(join(paths.libraryRoot, "first.npk"), "first");
    await writeFile(join(paths.libraryRoot, "second.npk"), "second");
    await writeFile(join(gameRoot, "second.npk"), "occupied");
    const beforeGame = await readdir(gameRoot);
    const statePath = join(paths.dataRoot, "installation-state.json");

    // When: one batch enable command is issued.
    const result = await createInstallService({ ...paths, gameRoot }).enableMany([
      { kind: "patch", relativePath: "first.npk" },
      { kind: "patch", relativePath: "second.npk" },
    ]);

    // Then: preflight rejects the whole command before any mutation.
    expect(result).toEqual({
      ok: false,
      error: { code: "TARGET_CONFLICT", targetPath: join(gameRoot, "second.npk") },
    });
    expect(await readdir(gameRoot)).toEqual(beforeGame);
    expect(await readFile(join(gameRoot, "second.npk"), "utf8")).toBe("occupied");
    await expect(readFile(statePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves every target and state byte when the second target is modified", async () => {
    // Given: two recorded patches whose second target was changed externally.
    const { paths, gameRoot } = await createInstallFixture();
    await writeFile(join(paths.libraryRoot, "first.npk"), "first");
    await writeFile(join(paths.libraryRoot, "second.npk"), "second");
    const service = createInstallService({ ...paths, gameRoot });
    await service.enableMany([
      { kind: "patch", relativePath: "first.npk" },
      { kind: "patch", relativePath: "second.npk" },
    ]);
    const secondTarget = join(gameRoot, "second.npk");
    await writeFile(secondTarget, "external");
    const statePath = join(paths.dataRoot, "installation-state.json");
    const beforeState = await readFile(statePath);

    // When: one batch disable command is issued.
    const result = await service.disableMany([
      { kind: "patch", relativePath: "first.npk" },
      { kind: "patch", relativePath: "second.npk" },
    ]);

    // Then: external content is protected and the installation state is unchanged.
    expect(result).toEqual({
      ok: false,
      error: { code: "TARGET_MODIFIED", targetPath: secondTarget },
    });
    expect(await readFile(join(gameRoot, "first.npk"), "utf8")).toBe("first");
    expect(await readFile(secondTarget, "utf8")).toBe("external");
    expect(await readFile(statePath)).toEqual(beforeState);
  });

  it("clears stale installation records when a target was deleted externally", async () => {
    // Given: two recorded patches whose second target was deleted externally.
    const { paths, gameRoot } = await createInstallFixture();
    await writeFile(join(paths.libraryRoot, "first.npk"), "first");
    await writeFile(join(paths.libraryRoot, "second.npk"), "second");
    const service = createInstallService({ ...paths, gameRoot });
    const items = [
      { kind: "patch", relativePath: "first.npk" },
      { kind: "patch", relativePath: "second.npk" },
    ] as const;
    await service.enableMany(items);
    await rm(join(gameRoot, "second.npk"));

    // When: the stale enabled items are disabled.
    const result = await service.disableMany(items);

    // Then: the live target is removed and both records are cleared.
    expect(result).toEqual({ ok: true, value: { removedCount: 2 } });
    await expect(access(join(gameRoot, "first.npk"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(gameRoot, "second.npk"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(
      JSON.parse(await readFile(join(paths.dataRoot, "installation-state.json"), "utf8")),
    ).toEqual({
      formatVersion: 1,
      records: [],
    });
  });

  it("enables and disables only the live members of a virtual group", async () => {
    // Given: a virtual group and an unrelated patch in the same category.
    const { paths, gameRoot } = await createInstallFixture();
    await Promise.all([
      writeFile(join(paths.libraryRoot, "分类A", "a.npk"), "a"),
      writeFile(join(paths.libraryRoot, "分类A", "b.npk"), "b"),
      writeFile(join(paths.libraryRoot, "分类A", "unrelated.npk"), "unrelated"),
    ]);
    const groups = createVirtualGroupService({
      dataRoot: paths.dataRoot,
      libraryRoot: paths.libraryRoot,
      createId: () => "0552babf-49b5-4390-96a7-1846a0c1e9f8",
    });
    const created = await groups.create({
      categoryRelativePath: "分类A",
      memberRelativePaths: ["分类A\\b.npk", "分类A\\a.npk"],
      name: "套装",
    });
    if (!created.ok) throw new Error("Expected virtual group creation to succeed");
    const transactionId = "3f5b9300-f078-4b6b-a6ee-c859a5a4b76a";
    const service = createInstallService({
      ...paths,
      gameRoot,
      groups,
      createId: () => transactionId,
    });

    // When: the mixed batch is enabled and then disabled.
    const enabled = await service.enable({ kind: "group", groupId: created.value.id });
    const enabledState = JSON.parse(
      await readFile(join(paths.dataRoot, "installation-state.json"), "utf8"),
    );
    const disabled = await service.disable({ kind: "group", groupId: created.value.id });

    // Then: only exact group members are installed and removed together.
    expect(enabled).toEqual({ ok: true, value: { installedCount: 2 } });
    expect(
      enabledState.records.map(
        (record: { sourceRelativePath: string }) => record.sourceRelativePath,
      ),
    ).toEqual(["分类A\\a.npk", "分类A\\b.npk"]);
    expect(disabled).toEqual({ ok: true, value: { removedCount: 2 } });
    expect(await readdir(gameRoot)).toEqual([]);
    await expect(access(join(paths.libraryRoot, "分类A", "套装"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("skips missing virtual group members and rejects an empty group source", async () => {
    // Given: a virtual group whose second member disappears after creation.
    const { paths, gameRoot } = await createInstallFixture();
    await Promise.all([
      writeFile(join(paths.libraryRoot, "分类A", "first.npk"), "first"),
      writeFile(join(paths.libraryRoot, "分类A", "second.npk"), "second"),
    ]);
    const groups = createVirtualGroupService({
      dataRoot: paths.dataRoot,
      libraryRoot: paths.libraryRoot,
      createId: () => "0552babf-49b5-4390-96a7-1846a0c1e9f8",
    });
    const created = await groups.create({
      categoryRelativePath: "分类A",
      memberRelativePaths: ["分类A\\first.npk", "分类A\\second.npk"],
      name: "套装",
    });
    if (!created.ok) throw new Error("Expected virtual group creation to succeed");
    await rm(join(paths.libraryRoot, "分类A", "second.npk"));
    const service = createInstallService({ ...paths, gameRoot, groups });

    // When: the group is enabled, then its last live member disappears.
    const result = await service.enable({ kind: "group", groupId: created.value.id });

    // Then: the live member is installed and an empty group is rejected.
    expect(result).toEqual({ ok: true, value: { installedCount: 1 } });
    await rm(join(paths.libraryRoot, "分类A", "first.npk"));
    expect(await service.enable({ kind: "group", groupId: created.value.id })).toEqual({
      ok: false,
      error: { code: "SOURCE_EMPTY", relativePath: created.value.id },
    });
  });

  it("routes image and sound patches into their respective subdirectories", async () => {
    // Given: an image NPK and a sound NPK in the library, with both subdirectories present.
    const { paths, gameRoot } = await createInstallFixture();
    const imageDir = join(gameRoot, "ImagePacks2");
    const soundDir = join(gameRoot, "SoundPacks");
    await Promise.all([mkdir(imageDir), mkdir(soundDir)]);
    await writeFile(
      join(paths.libraryRoot, "sprite.npk"),
      buildNpkBytes(["sprite/character/xxx.img"]),
    );
    await writeFile(join(paths.libraryRoot, "bgm.npk"), buildNpkBytes(["sounds/bgm/xxx.ogg"]));
    const service = createInstallService({ ...paths, gameRoot });

    // When: both patches are enabled in one batch.
    const result = await service.enableMany([
      { kind: "patch", relativePath: "sprite.npk" },
      { kind: "patch", relativePath: "bgm.npk" },
    ]);

    // Then: each copy lands in its routed subdirectory with a matching record.
    expect(result).toEqual({ ok: true, value: { installedCount: 2 } });
    expect(await readFile(join(imageDir, "sprite.npk"), "utf8")).toBeTruthy();
    expect(await readFile(join(soundDir, "bgm.npk"), "utf8")).toBeTruthy();
    expect(await readdir(gameRoot)).toEqual(["ImagePacks2", "SoundPacks"]);
    const state = JSON.parse(
      await readFile(join(paths.dataRoot, "installation-state.json"), "utf8"),
    );
    expect(state.records.map((record: { targetPath: string }) => record.targetPath)).toEqual([
      join(imageDir, "sprite.npk"),
      join(soundDir, "bgm.npk"),
    ]);
  });

  it("routes a sound NPK whose index is far larger than one read chunk", async () => {
    // Given: a sound patch with 12820 entries (3.38 MB index), mirroring a real voice pack.
    const { paths, gameRoot } = await createInstallFixture();
    const imageDir = join(gameRoot, "ImagePacks2");
    const soundDir = join(gameRoot, "SoundPacks");
    await Promise.all([mkdir(imageDir), mkdir(soundDir)]);
    const entryPaths = Array.from(
      { length: 12820 },
      (_value, index) => `sounds/mon/apocalypse/vo/bliss_vo_atk_${index}.ogg`,
    );
    await writeFile(join(paths.libraryRoot, "voice.npk"), buildNpkBytes(entryPaths));
    const service = createInstallService({ ...paths, gameRoot });

    // When: the patch is enabled.
    const result = await service.enable({ kind: "patch", relativePath: "voice.npk" });

    // Then: it lands in SoundPacks instead of falling back to ImagePacks2.
    expect(result).toEqual({ ok: true, value: { installedCount: 1 } });
    expect(await readdir(soundDir)).toEqual(["voice.npk"]);
    expect(await readdir(imageDir)).toEqual([]);
  });

  it("disables a routed sound patch inside SoundPacks and a legacy root record", async () => {
    // Given: one sound patch installed through routing and one legacy root-level record.
    const { paths, gameRoot } = await createInstallFixture();
    const soundDir = join(gameRoot, "SoundPacks");
    await mkdir(soundDir);
    await writeFile(join(paths.libraryRoot, "bgm.npk"), buildNpkBytes(["sounds/bgm/xxx.ogg"]));
    await writeFile(join(paths.libraryRoot, "legacy.npk"), buildNpkBytes(["sprite/a.img"]));
    const service = createInstallService({ ...paths, gameRoot });
    await service.enable({ kind: "patch", relativePath: "bgm.npk" });
    await service.enable({ kind: "patch", relativePath: "legacy.npk" });

    // When: both patches are disabled.
    const result = await service.disableMany([
      { kind: "patch", relativePath: "bgm.npk" },
      { kind: "patch", relativePath: "legacy.npk" },
    ]);

    // Then: both routed and legacy targets are removed without boundary errors.
    expect(result).toEqual({ ok: true, value: { removedCount: 2 } });
    await expect(access(join(soundDir, "bgm.npk"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(gameRoot, "legacy.npk"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("falls back to the game root when the routed subdirectory is missing", async () => {
    // Given: a sound NPK enabled while SoundPacks has not been created yet.
    const { paths, gameRoot } = await createInstallFixture();
    await writeFile(join(paths.libraryRoot, "bgm.npk"), buildNpkBytes(["sounds/bgm/xxx.ogg"]));
    const service = createInstallService({ ...paths, gameRoot });

    // When: the patch is enabled.
    const result = await service.enable({ kind: "patch", relativePath: "bgm.npk" });

    // Then: the copy lands directly in the game root instead of failing.
    expect(result).toEqual({ ok: true, value: { installedCount: 1 } });
    expect(await readFile(join(gameRoot, "bgm.npk"), "utf8")).toBeTruthy();
  });

  it("routes a BK2 video patch into the video subdirectory", async () => {
    // Given: a BK2 patch in the library and a game root exposing the video directory.
    const { paths, gameRoot } = await createInstallFixture();
    const imageDir = join(gameRoot, "ImagePacks2");
    const videoDir = join(gameRoot, "video");
    await Promise.all([mkdir(imageDir), mkdir(videoDir)]);
    await writeFile(join(paths.libraryRoot, "0A 冰雪女剑buff.bk2"), "bk2-bytes");
    await writeFile(join(paths.libraryRoot, "sprite.npk"), buildNpkBytes(["sprite/a.img"]));
    const service = createInstallService({ ...paths, gameRoot });

    // When: the video patch is enabled next to an image patch.
    const result = await service.enableMany([
      { kind: "patch", relativePath: "0A 冰雪女剑buff.bk2" },
      { kind: "patch", relativePath: "sprite.npk" },
    ]);

    // Then: the BK2 lands in video and the record points at that exact target.
    expect(result).toEqual({ ok: true, value: { installedCount: 2 } });
    expect(await readFile(join(videoDir, "0A 冰雪女剑buff.bk2"), "utf8")).toBe("bk2-bytes");
    const state = JSON.parse(
      await readFile(join(paths.dataRoot, "installation-state.json"), "utf8"),
    );
    expect(state.records.map((record: { targetPath: string }) => record.targetPath).sort()).toEqual(
      [join(gameRoot, "ImagePacks2", "sprite.npk"), join(videoDir, "0A 冰雪女剑buff.bk2")],
    );

    // And: disabling removes the routed video target without boundary errors.
    expect(await service.disable({ kind: "patch", relativePath: "0A 冰雪女剑buff.bk2" })).toEqual({
      ok: true,
      value: { removedCount: 1 },
    });
    await expect(access(join(videoDir, "0A 冰雪女剑buff.bk2"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("falls back to the game root for a BK2 when the video subdirectory is missing", async () => {
    // Given: a BK2 enabled while the game root has no video directory.
    const { paths, gameRoot } = await createInstallFixture();
    await writeFile(join(paths.libraryRoot, "clip.bk2"), "bk2-bytes");
    const service = createInstallService({ ...paths, gameRoot });

    // When: the patch is enabled.
    const result = await service.enable({ kind: "patch", relativePath: "clip.bk2" });

    // Then: the copy lands in the game root instead of failing.
    expect(result).toEqual({ ok: true, value: { installedCount: 1 } });
    expect(await readFile(join(gameRoot, "clip.bk2"), "utf8")).toBe("bk2-bytes");
  });

  it("enables and disables one patch with matching state records", async () => {
    const { paths, gameRoot } = await createInstallFixture();
    await writeFile(join(paths.libraryRoot, "分类A", "coat.npk"), "coat-bytes");
    const service = createInstallService({
      ...paths,
      gameRoot,
      createId: () => "67d6958e-55ef-4a23-8fb6-275db011cb54",
      now: () => new Date("2026-07-18T02:00:00.000Z"),
    });

    const enabled = await service.enable({ kind: "patch", relativePath: "分类A\\coat.npk" });

    expect(enabled).toEqual({ ok: true, value: { installedCount: 1 } });
    expect(await readFile(join(gameRoot, "coat.npk"), "utf8")).toBe("coat-bytes");
    const stateFile = join(paths.dataRoot, "installation-state.json");
    const enabledState = JSON.parse(await readFile(stateFile, "utf8"));
    expect(enabledState.records).toHaveLength(1);
    expect(enabledState.records[0]).toMatchObject({
      sourceRelativePath: "分类A\\coat.npk",
      targetPath: join(gameRoot, "coat.npk"),
      transactionId: "67d6958e-55ef-4a23-8fb6-275db011cb54",
    });

    const disabled = await service.disable({ kind: "patch", relativePath: "分类A\\coat.npk" });

    expect(disabled).toEqual({ ok: true, value: { removedCount: 1 } });
    await expect(access(join(gameRoot, "coat.npk"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(stateFile, "utf8"))).toEqual({
      formatVersion: 1,
      records: [],
    });
  });
});

import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeFileTransaction } from "../../src/core/filesystem/file-transaction";
import { createVirtualGroupService } from "../../src/core/groups/group-service";
import { createInstallService } from "../../src/core/install/install-service";
import { InstallationStateSchema } from "../../src/core/state/schemas";
import { parseGameRoot, resolveAppPaths } from "../../src/main/app-paths";
import { buildNpkBytes } from "./npk-fixture";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function createFixture() {
  const projectRoot = await mkdtemp(join(tmpdir(), "dnf-install-boundary-"));
  temporaryDirectories.push(projectRoot);
  const paths = resolveAppPaths({ mode: "development", projectRoot });
  const gameRoot = parseGameRoot(join(projectRoot, "game"));
  await Promise.all([mkdir(paths.libraryRoot, { recursive: true }), mkdir(gameRoot)]);
  return { gameRoot, paths };
}

describe("installation target boundary", () => {
  it.each([
    { parentName: "ImagePacks2", patchName: "clip.npk", bytes: buildNpkBytes(["sprite/a.img"]) },
    { parentName: "SoundPacks", patchName: "clip.npk", bytes: buildNpkBytes(["sounds/a.ogg"]) },
    { parentName: "video", patchName: "clip.bk2", bytes: Buffer.from("bk2-bytes") },
  ])(
    "accepts $parentName as a routed installation parent",
    async ({ parentName, patchName, bytes }) => {
      // Given: a game root exposing the routed subdirectory and one matching patch.
      const { paths, gameRoot } = await createFixture();
      const targetDir = join(gameRoot, parentName);
      await mkdir(targetDir);
      await writeFile(join(paths.libraryRoot, patchName), bytes);
      const service = createInstallService({ ...paths, gameRoot });

      // When: the patch is enabled so it routes into that subdirectory.
      const result = await service.enable({ kind: "patch", relativePath: patchName });

      // Then: the boundary check lets the routed parent through.
      expect(result).toEqual({ ok: true, value: { installedCount: 1 } });
      await expect(access(join(targetDir, patchName))).resolves.toBeUndefined();
    },
  );

  it("refuses a target inside a subdirectory that is not a routing parent", async () => {
    // Given: a game root whose stray subdirectory is not an allowed routing parent.
    const { paths, gameRoot } = await createFixture();
    const stray = join(gameRoot, "stray");
    await mkdir(stray);
    await writeFile(join(paths.libraryRoot, "clip.bk2"), "patch");
    const service = createInstallService({
      ...paths,
      gameRoot,
      videoTargetDir: stray,
    });

    // When: the patch is enabled with that directory as its routed target.
    const result = await service.enable({ kind: "patch", relativePath: "clip.bk2" });

    // Then: the boundary rejects the write and nothing is left behind.
    expect(result).toEqual({ ok: false, error: { code: "TRANSACTION_FAILED" } });
    await expect(access(join(stray, "clip.bk2"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves a target created after preflight instead of overwriting it", async () => {
    const { paths, gameRoot } = await createFixture();
    await writeFile(join(paths.libraryRoot, "race.npk"), "patch");
    const targetPath = join(gameRoot, "race.npk");
    const service = createInstallService({
      ...paths,
      gameRoot,
      executeTransaction: async (steps) => {
        await writeFile(targetPath, "external");
        return executeFileTransaction(steps);
      },
    });

    const result = await service.enable({ kind: "patch", relativePath: "race.npk" });

    expect(result).toEqual({ ok: false, error: { code: "TRANSACTION_FAILED" } });
    expect(await readFile(targetPath, "utf8")).toBe("external");
    await expect(access(join(paths.dataRoot, "installation-state.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("refuses to write when the configured game root is replaced by a junction", async () => {
    const { paths, gameRoot } = await createFixture();
    await writeFile(join(paths.libraryRoot, "linked.npk"), "patch");
    const outsideRoot = join(gameRoot, "..", "outside-game");
    await mkdir(outsideRoot);
    await rm(gameRoot, { recursive: true });
    await symlink(outsideRoot, gameRoot, "junction");

    const result = await createInstallService({ ...paths, gameRoot }).enable({
      kind: "patch",
      relativePath: "linked.npk",
    });

    expect(result).toEqual({ ok: false, error: { code: "TRANSACTION_FAILED" } });
    await expect(access(join(outsideRoot, "linked.npk"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(paths.dataRoot, "installation-state.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("does not remove an external file when the game root is replaced before disable", async () => {
    const { paths, gameRoot } = await createFixture();
    await writeFile(join(paths.libraryRoot, "disable.npk"), "patch");
    const service = createInstallService({ ...paths, gameRoot });
    await service.enable({ kind: "patch", relativePath: "disable.npk" });
    const outsideRoot = join(gameRoot, "..", "outside-disable");
    await mkdir(outsideRoot);
    await writeFile(join(outsideRoot, "disable.npk"), "patch");
    await rm(gameRoot, { recursive: true });
    await symlink(outsideRoot, gameRoot, "junction");

    const result = await service.disable({ kind: "patch", relativePath: "disable.npk" });

    expect(result).toEqual({ ok: false, error: { code: "TRANSACTION_FAILED" } });
    expect(await readFile(join(outsideRoot, "disable.npk"), "utf8")).toBe("patch");
  });

  it("preserves a relocation destination created after preflight", async () => {
    const { paths, gameRoot } = await createFixture();
    await writeFile(join(paths.libraryRoot, "old.npk"), "patch");
    await createInstallService({ ...paths, gameRoot }).enable({
      kind: "patch",
      relativePath: "old.npk",
    });
    const destination = join(gameRoot, "new.npk");
    const service = createInstallService({
      ...paths,
      gameRoot,
      executeTransaction: async (steps) => {
        await writeFile(destination, "external");
        return executeFileTransaction(steps);
      },
    });

    const result = await service.relocate({
      kind: "patch",
      fromRelativePath: "old.npk",
      toRelativePath: "new.npk",
    });

    expect(result).toEqual({ ok: false, error: { code: "TRANSACTION_FAILED" } });
    expect(await readFile(destination, "utf8")).toBe("external");
    expect(await readFile(join(gameRoot, "old.npk"), "utf8")).toBe("patch");
  });

  it("does not remove an installation record whose target is outside the game root", async () => {
    const { paths, gameRoot } = await createFixture();
    await writeFile(join(paths.libraryRoot, "outside.npk"), "patch");
    const service = createInstallService({ ...paths, gameRoot });
    await service.enable({ kind: "patch", relativePath: "outside.npk" });
    const statePath = join(paths.dataRoot, "installation-state.json");
    const state = InstallationStateSchema.parse(JSON.parse(await readFile(statePath, "utf8")));
    const outsideTarget = join(gameRoot, "..", "outside.npk");
    await writeFile(outsideTarget, "patch");
    const firstRecord = state.records[0];
    if (firstRecord === undefined) throw new Error("Expected an installation record");
    await writeFile(
      statePath,
      JSON.stringify({ ...state, records: [{ ...firstRecord, targetPath: outsideTarget }] }),
    );

    const result = await service.disable({ kind: "patch", relativePath: "outside.npk" });

    expect(result).toEqual({ ok: false, error: { code: "TRANSACTION_FAILED" } });
    expect(await readFile(outsideTarget, "utf8")).toBe("patch");
  });

  it("preserves an externally modified target and its record", async () => {
    const { paths, gameRoot } = await createFixture();
    await writeFile(join(paths.libraryRoot, "modified.npk"), "patch");
    const service = createInstallService({ ...paths, gameRoot });
    await service.enable({ kind: "patch", relativePath: "modified.npk" });
    await writeFile(join(gameRoot, "modified.npk"), "external-change");

    const result = await service.disable({ kind: "patch", relativePath: "modified.npk" });

    expect(result).toEqual({
      ok: false,
      error: { code: "TARGET_MODIFIED", targetPath: join(gameRoot, "modified.npk") },
    });
    expect(await readFile(join(gameRoot, "modified.npk"), "utf8")).toBe("external-change");
    const state = InstallationStateSchema.parse(
      JSON.parse(await readFile(join(paths.dataRoot, "installation-state.json"), "utf8")),
    );
    expect(state.records).toHaveLength(1);
  });

  it("installs none of a virtual group when a later target conflicts", async () => {
    const { paths, gameRoot } = await createFixture();
    await Promise.all([
      writeFile(join(paths.libraryRoot, "top.npk"), "top"),
      writeFile(join(paths.libraryRoot, "bottom.npk"), "bottom"),
      writeFile(join(gameRoot, "bottom.npk"), "conflict"),
    ]);
    const groupId = "0552babf-49b5-4390-96a7-1846a0c1e9f8";
    const groups = createVirtualGroupService({
      dataRoot: paths.dataRoot,
      libraryRoot: paths.libraryRoot,
      createId: () => groupId,
    });
    const created = await groups.create({
      categoryRelativePath: "",
      memberRelativePaths: ["top.npk", "bottom.npk"],
      name: "set",
    });
    if (!created.ok) throw new Error("Expected virtual group creation to succeed");
    const service = createInstallService({ ...paths, gameRoot, groups });

    const result = await service.enable({ kind: "group", groupId });

    expect(result).toEqual({
      ok: false,
      error: { code: "TARGET_CONFLICT", targetPath: join(gameRoot, "bottom.npk") },
    });
    await expect(access(join(gameRoot, "top.npk"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(paths.dataRoot, "installation-state.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

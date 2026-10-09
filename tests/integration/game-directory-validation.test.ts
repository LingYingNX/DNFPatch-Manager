import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseGameRoot } from "../../src/main/app-paths";
import { apiError } from "../../src/main/ipc/api-result";
import { assertGameRootHasSubdirectories } from "../../src/main/ipc/game-directory-ipc";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("game root subdirectory validation", () => {
  it("accepts a game root containing ImagePacks2, SoundPacks and video", async () => {
    const root = await mkdtemp(join(tmpdir(), "dnf-game-root-"));
    temporaryDirectories.push(root);
    const gameRoot = parseGameRoot(join(root, "game"));
    await Promise.all([
      mkdir(join(gameRoot, "ImagePacks2"), { recursive: true }),
      mkdir(join(gameRoot, "SoundPacks"), { recursive: true }),
      mkdir(join(gameRoot, "video"), { recursive: true }),
    ]);

    expect(await assertGameRootHasSubdirectories(gameRoot)).toBe(true);
  });

  it("rejects a game root missing SoundPacks", async () => {
    const root = await mkdtemp(join(tmpdir(), "dnf-game-root-"));
    temporaryDirectories.push(root);
    const gameRoot = parseGameRoot(join(root, "game"));
    await mkdir(join(gameRoot, "ImagePacks2"), { recursive: true });

    expect(await assertGameRootHasSubdirectories(gameRoot)).toBe(false);
  });

  it("rejects a game root missing video", async () => {
    const root = await mkdtemp(join(tmpdir(), "dnf-game-root-"));
    temporaryDirectories.push(root);
    const gameRoot = parseGameRoot(join(root, "game"));
    await Promise.all([
      mkdir(join(gameRoot, "ImagePacks2"), { recursive: true }),
      mkdir(join(gameRoot, "SoundPacks"), { recursive: true }),
    ]);

    expect(await assertGameRootHasSubdirectories(gameRoot)).toBe(false);
  });

  it("rejects when a required subdirectory is a file rather than a directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "dnf-game-root-"));
    temporaryDirectories.push(root);
    const gameRoot = parseGameRoot(join(root, "game"));
    await mkdir(gameRoot, { recursive: true });
    await Promise.all([
      mkdir(join(gameRoot, "ImagePacks2"), { recursive: true }),
      mkdir(join(gameRoot, "video"), { recursive: true }),
      writeFile(join(gameRoot, "SoundPacks"), "not a directory"),
    ]);

    expect(await assertGameRootHasSubdirectories(gameRoot)).toBe(false);
  });

  it("maps a missing game root to the user-facing hint", () => {
    expect(apiError("GAME_ROOT_MISSING").message).toBe("请设置到游戏根目录");
  });
});

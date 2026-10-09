import { realpath } from "node:fs/promises";
import { win32 } from "node:path";
import type { GameRoot } from "../../main/app-paths";
import { isPathWithin } from "../../shared/path-key";
import { normalizedPathKey } from "../paths/relative-path";

/**
 * 安装目标允许的父目录：游戏根目录直属（旧版记录）与
 * ImagePacks2 / SoundPacks / video 子目录（按补丁类型路由的新记录）。
 */
const ALLOWED_PARENT_NAMES = ["ImagePacks2", "SoundPacks", "video"] as const;

export async function assertInstallTargetBoundary(
  gameRoot: GameRoot,
  targetPath: string,
): Promise<void> {
  const parentKey = normalizedPathKey(win32.dirname(targetPath));
  const allowedParents = [
    gameRoot,
    ...ALLOWED_PARENT_NAMES.map((name) => win32.join(gameRoot, name)),
  ];
  if (!allowedParents.some((dir) => normalizedPathKey(dir) === parentKey)) {
    throw new Error("Installation target is outside the game directory");
  }
  if (!isPathWithin(targetPath, gameRoot)) {
    throw new Error("Installation target is outside the game directory");
  }
  if (normalizedPathKey(await realpath(gameRoot)) !== normalizedPathKey(gameRoot)) {
    throw new Error("Game directory identity changed");
  }
}

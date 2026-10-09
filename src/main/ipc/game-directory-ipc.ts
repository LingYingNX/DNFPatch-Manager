import { realpath, stat } from "node:fs/promises";
import { win32 } from "node:path";
import { type BrowserWindow, dialog, ipcMain } from "electron";
import {
  createAppSettingsStore,
  readAppSettings,
  withGameDirectory,
} from "../../core/appearance/appearance-settings";
import type { AsyncMutex } from "../../core/concurrency/async-mutex";
import type { VirtualGroupService } from "../../core/groups/group-service";
import { createInstallService, type InstallService } from "../../core/install/install-service";
import {
  createInstallationStateStore,
  readInstallationState,
} from "../../core/install/installation-state";
import type { StateStoreError } from "../../core/state/atomic-json-store";
import type { AppSettings } from "../../core/state/schemas";
import {
  type ApiResult,
  IPC_CHANNELS,
  SetGameDirectoryRequestSchema,
} from "../../shared/ipc-contracts";
import { type AppPaths, parseGameRoot } from "../app-paths";
import { apiError } from "./api-result";

type SettingsState =
  | { readonly ok: true; readonly value: AppSettings }
  | { readonly ok: false; readonly error: StateStoreError };

export type GameDirectoryBinding = {
  readonly getInstallService: () => ApiResult<InstallService>;
  readonly getSettings: () => SettingsState;
  readonly updateSettings: (next: AppSettings) => Promise<ApiResult<AppSettings>>;
};

/** 游戏根目录下必须存在的子目录：贴图、音效与视频补丁的落盘位置。 */
export const GAME_SUBDIRECTORIES = ["ImagePacks2", "SoundPacks", "video"] as const;

/** 校验游戏根目录是否包含全部必需子目录（真实 FS 探测，缺失任一即不通过）。 */
export async function assertGameRootHasSubdirectories(gameRoot: string): Promise<boolean> {
  const checks = await Promise.all(
    GAME_SUBDIRECTORIES.map((name) =>
      stat(win32.join(gameRoot, name))
        .then((metadata) => metadata.isDirectory())
        .catch(() => false),
    ),
  );
  return checks.every((exists) => exists);
}

export async function registerGameDirectoryIpc(
  window: BrowserWindow,
  paths: AppPaths,
  mutationMutex: AsyncMutex,
  groups: VirtualGroupService,
): Promise<GameDirectoryBinding> {
  const store = createAppSettingsStore(win32.join(paths.dataRoot, "settings.json"));
  const stored = await readAppSettings(store);
  const installationStore = createInstallationStateStore(
    win32.join(paths.dataRoot, "installation-state.json"),
  );
  let state: SettingsState = stored;

  const current = (): ApiResult<{ readonly gameDirectory: string | null }> =>
    state.ok
      ? { ok: true, value: { gameDirectory: state.value.gameDirectory } }
      : { ok: false, error: apiError(state.error.code) };

  const resolveDirectory = async (value: string): Promise<string | null> => {
    try {
      const resolved = await realpath(value);
      if (!(await stat(resolved)).isDirectory()) return null;
      return parseGameRoot(resolved);
    } catch {
      return null;
    }
  };

  /** 保存前校验 ImagePacks2 / SoundPacks / video 存在，任一缺失即视为未选到游戏根目录。 */
  const assertGameSubdirectoriesExist = async (
    gameRoot: string,
  ): Promise<ApiResult<{ readonly gameDirectory: string | null }> | null> =>
    (await assertGameRootHasSubdirectories(gameRoot))
      ? null
      : { ok: false, error: apiError("GAME_ROOT_MISSING") };

  const persistDirectory = (
    nextDirectory: string,
  ): Promise<
    ApiResult<{
      readonly gameDirectory: string | null;
    }>
  > =>
    mutationMutex.runExclusive(async () => {
      if (!state.ok) return current();
      if (state.value.gameDirectory?.toLocaleLowerCase() !== nextDirectory.toLocaleLowerCase()) {
        const installation = await readInstallationState(installationStore);
        if (!installation.ok) return { ok: false, error: apiError(installation.error.code) };
        if (installation.value.state.records.length > 0) {
          return { ok: false, error: apiError("GAME_DIRECTORY_IN_USE") };
        }
      }
      const next = withGameDirectory(state.value, nextDirectory);
      const written = await store.write(next);
      if (!written.ok) return { ok: false, error: apiError(written.error.code) };
      state = { ok: true, value: next };
      return current();
    });

  ipcMain.removeHandler(IPC_CHANNELS.getGameDirectory);
  ipcMain.handle(IPC_CHANNELS.getGameDirectory, async () => current());

  ipcMain.removeHandler(IPC_CHANNELS.setGameDirectory);
  ipcMain.handle(IPC_CHANNELS.setGameDirectory, async (_event, input: unknown) => {
    const parsed = SetGameDirectoryRequestSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: apiError("INVALID_INPUT") };
    const nextDirectory = await resolveDirectory(parsed.data.gameDirectory);
    if (nextDirectory === null) return { ok: false, error: apiError("INVALID_INPUT") };
    const missingSubdirectory = await assertGameSubdirectoriesExist(nextDirectory);
    if (missingSubdirectory !== null) return missingSubdirectory;
    return persistDirectory(nextDirectory);
  });

  ipcMain.removeHandler(IPC_CHANNELS.selectGameDirectory);
  ipcMain.handle(IPC_CHANNELS.selectGameDirectory, async () => {
    if (!state.ok) return current();
    const selection = await dialog.showOpenDialog(window, { properties: ["openDirectory"] });
    if (selection.canceled) return current();
    const selected = selection.filePaths[0];
    if (selected === undefined) return { ok: false, error: apiError("INVALID_INPUT") };
    const nextDirectory = await resolveDirectory(selected);
    if (nextDirectory === null) return { ok: false, error: apiError("INVALID_INPUT") };
    const missingSubdirectory = await assertGameSubdirectoriesExist(nextDirectory);
    if (missingSubdirectory !== null) return missingSubdirectory;
    return persistDirectory(nextDirectory);
  });

  return {
    getSettings: () => state,
    async updateSettings(next) {
      const written = await store.write(next);
      if (!written.ok) return { ok: false, error: apiError(written.error.code) };
      state = { ok: true, value: next };
      return { ok: true, value: next };
    },
    getInstallService: () => {
      if (!state.ok) return { ok: false, error: apiError(state.error.code) };
      if (state.value.gameDirectory === null) {
        return { ok: false, error: apiError("GAME_DIRECTORY_REQUIRED") };
      }
      return {
        ok: true,
        value: createInstallService({
          ...paths,
          gameRoot: parseGameRoot(state.value.gameDirectory),
          groups,
        }),
      };
    },
  };
}

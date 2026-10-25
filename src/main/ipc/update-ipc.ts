import { createRequire } from "node:module";
import { dirname } from "node:path";
import { type BrowserWindow, ipcMain, net } from "electron";
import { APP_RELEASE_NOTES, APP_VERSION } from "../../shared/contracts";
import { type ApiResult, IPC_CHANNELS } from "../../shared/ipc-contracts";
import type { UpdateCheckResult, UpdateEvent } from "../../shared/update-contracts";
import { apiError } from "./api-result";
import { normalizeReleaseNotes, selectReleaseNotes } from "./release-notes";

type AutoUpdater = import("electron-updater").NsisUpdater;

// electron-updater 只有 CommonJS 入口，且实例化时要读 app.getVersion()，
// 所以必须用 createRequire 且在打包环境里惰性加载。
const requireCjs = createRequire(import.meta.url);
const GITHUB_RELEASE_API = "https://api.github.com/repos/LingYingNX/DNFPatch-Manager/releases/tags";

const loadAutoUpdater = (): AutoUpdater =>
  (requireCjs("electron-updater") as typeof import("electron-updater")).autoUpdater as AutoUpdater;

const ok = <T>(value: T): ApiResult<T> => ({ ok: true, value });

const fetchGithubReleaseNotes = (version: string): Promise<string[]> =>
  new Promise((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const finish = (notes: string[]): void => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      resolve(notes);
    };

    try {
      const request = net.request(`${GITHUB_RELEASE_API}/v${encodeURIComponent(version)}`);
      request.setHeader("Accept", "application/vnd.github+json");
      request.setHeader("User-Agent", "DNF-Patch-Manager");
      timeoutId = setTimeout(() => {
        request.abort();
        finish([]);
      }, 5000);
      request.on("response", (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk.toString();
        });
        response.on("end", () => {
          if (
            response.statusCode === undefined ||
            response.statusCode < 200 ||
            response.statusCode >= 300
          ) {
            finish([]);
            return;
          }
          try {
            const parsed = JSON.parse(body) as { body?: unknown };
            finish(normalizeReleaseNotes(parsed.body));
          } catch {
            finish([]);
          }
        });
        response.on("error", () => finish([]));
      });
      request.on("error", () => finish([]));
      request.end();
    } catch {
      finish([]);
    }
  });

const resolveReleaseNotes = async (version: string, value: unknown): Promise<string[]> => {
  const githubNotes = await fetchGithubReleaseNotes(version);
  return selectReleaseNotes(
    version,
    normalizeReleaseNotes(value),
    githubNotes,
    APP_VERSION,
    APP_RELEASE_NOTES,
  );
};

export function registerUpdateIpc(window: BrowserWindow, isPackaged: boolean): void {
  const updater = isPackaged ? loadAutoUpdater() : undefined;
  const publish = (event: UpdateEvent): void => {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.updateEvent, event);
    }
  };

  if (updater !== undefined) {
    // NSIS updates must reuse the directory of the running executable.
    updater.installDirectory = dirname(process.execPath);
    updater.autoDownload = false;
    updater.on("checking-for-update", () => publish({ kind: "checking" }));
    updater.on("update-available", (info) => {
      void resolveReleaseNotes(info.version, info.releaseNotes).then((releaseNotes) =>
        publish({ kind: "available", version: info.version, releaseNotes }),
      );
    });
    updater.on("update-not-available", (info) => {
      void resolveReleaseNotes(info.version, info.releaseNotes).then((releaseNotes) =>
        publish({ kind: "current", version: info.version, releaseNotes }),
      );
    });
    updater.on("download-progress", (progress) =>
      publish({
        kind: "downloading",
        percent: Number.isFinite(progress.percent) ? Math.round(progress.percent) : 0,
      }),
    );
    updater.on("update-downloaded", (info) =>
      publish({ kind: "downloaded", version: info.version }),
    );
    updater.on("error", (error) =>
      publish({ kind: "failed", message: error.message.slice(0, 500) }),
    );
  }

  ipcMain.removeHandler(IPC_CHANNELS.checkUpdate);
  ipcMain.handle(IPC_CHANNELS.checkUpdate, async (): Promise<ApiResult<UpdateCheckResult>> => {
    if (updater === undefined) {
      return ok({
        currentVersion: APP_VERSION,
        latestVersion: APP_VERSION,
        updateAvailable: false,
        releaseNotes: [...APP_RELEASE_NOTES],
      });
    }
    try {
      const checked = await updater.checkForUpdates();
      const latestVersion = checked?.updateInfo.version ?? APP_VERSION;
      const releaseNotes = await resolveReleaseNotes(
        latestVersion,
        checked?.updateInfo.releaseNotes,
      );
      return ok({
        currentVersion: APP_VERSION,
        latestVersion,
        updateAvailable: latestVersion !== APP_VERSION,
        releaseNotes,
      });
    } catch {
      publish({ kind: "failed", message: "检查更新失败，请检查网络后重试" });
      return { ok: false, error: apiError("UPDATE_CHECK_FAILED") };
    }
  });

  ipcMain.removeHandler(IPC_CHANNELS.downloadUpdate);
  ipcMain.handle(IPC_CHANNELS.downloadUpdate, async (): Promise<ApiResult<null>> => {
    if (updater === undefined) return { ok: false, error: apiError("UPDATE_UNAVAILABLE") };
    try {
      await updater.downloadUpdate();
      return ok(null);
    } catch {
      publish({ kind: "failed", message: "下载更新失败，请稍后重试" });
      return { ok: false, error: apiError("UPDATE_DOWNLOAD_FAILED") };
    }
  });

  ipcMain.removeHandler(IPC_CHANNELS.installUpdate);
  ipcMain.handle(IPC_CHANNELS.installUpdate, async (): Promise<ApiResult<null>> => {
    if (updater === undefined) return { ok: false, error: apiError("UPDATE_UNAVAILABLE") };
    updater.quitAndInstall(true, true);
    return ok(null);
  });
}

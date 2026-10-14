import { mkdir, stat } from "node:fs/promises";
import { win32 } from "node:path";
import { type BrowserWindow, ipcMain, shell } from "electron";
import type { ZodType } from "zod";
import { createCategoryDeleteService } from "../../core/application/category-delete-service";
import {
  createLibraryLifecycleService,
  dissolveGroupLifecycle,
} from "../../core/application/library-lifecycle-service";
import { createManagedImageAssets } from "../../core/assets/managed-image-assets";
import { createAsyncMutex } from "../../core/concurrency/async-mutex";
import { configureTransactionRecovery } from "../../core/filesystem/file-transaction";
import { createVirtualGroupService } from "../../core/groups/group-service";
import { migrateLegacyGroups } from "../../core/groups/legacy-group-migration";
import {
  createInstallationStateStore,
  readInstallationState,
} from "../../core/install/installation-state";
import { createCategoryOrderService } from "../../core/library/category-order-service";
import { createCategoryStyleService } from "../../core/library/category-style-service";
import { createLibraryCommands } from "../../core/library/library-commands";
import { scanCategory, scanGroup } from "../../core/library/scanner";
import { resolveLibraryPath } from "../../core/paths/library-path";
import { createPreviewService } from "../../core/previews/preview-service";
import { createPreviewStateStore } from "../../core/previews/preview-state";
import { createRecycleService } from "../../core/recycle/recycle-service";
import { emptyInstallationState, emptyPreviewState } from "../../core/state/schemas";
import { createWallpaperService } from "../../core/wallpapers/wallpaper-service";
import { createWallpaperStateStore } from "../../core/wallpapers/wallpaper-state";
import {
  AddGroupMembersRequestSchema,
  type ApiResult,
  CreateGroupRequestSchema,
  DeleteRecycleItemsRequestSchema,
  DissolveGroupRequestSchema,
  EmptyRecycleRequestSchema,
  InstallBatchRequestSchema,
  InstallRequestSchema,
  IPC_CHANNELS,
  OpenExternalUrlRequestSchema,
  RecycleBatchRequestSchema,
  RecycleRequestSchema,
  RestoreRequestSchema,
  RevealPatchRequestSchema,
  ScanGroupRequestSchema,
  ScanRequestSchema,
} from "../../shared/ipc-contracts";
import { isLibraryPatchPath } from "../../shared/library-patch-extensions";
import type { AppPaths } from "../app-paths";
import {
  collectMissingVideoPreviews,
  createVideoPreviewScheduler,
} from "../library/video-preview-scheduler";
import { apiError, toApiResult } from "./api-result";
import { registerAppearanceIpc } from "./appearance-ipc";
import { registerCategoryCommandIpc } from "./category-command-ipc";
import { registerCategoryStyleIpc } from "./category-style-ipc";
import { registerCategoryTransferIpc } from "./category-transfer-ipc";
import {
  decorateGroupSnapshotWithInstallation,
  decorateGroupSnapshotWithPreviews,
  decorateSnapshotWithInstallation,
  decorateSnapshotWithPreviews,
} from "./decorate-snapshot";
import { registerGameDirectoryIpc } from "./game-directory-ipc";
import { registerMoveIpc } from "./move-ipc";
import { registerPresetIpc } from "./preset-ipc";
import { registerPreviewIpc } from "./preview-ipc";
import { inspectRecoveryState, registerRecoveryMode } from "./recovery-mode";
import { registerUpdateIpc } from "./update-ipc";
import { createValidatedHandler } from "./validated-handler";
import { registerWindowControlsIpc } from "./window-controls-ipc";

function register<T, U>(
  channel: string,
  schema: ZodType<T>,
  action: (request: T) => Promise<ApiResult<U>>,
): void {
  ipcMain.removeHandler(channel);
  const handler = createValidatedHandler(schema, action);
  ipcMain.handle(channel, (_event, input: unknown) => handler(input));
}

export async function registerIpc(
  window: BrowserWindow,
  paths: AppPaths,
  isPackaged: boolean,
): Promise<void> {
  await Promise.all([
    mkdir(paths.dataRoot, { recursive: true }),
    mkdir(paths.libraryRoot, { recursive: true }),
  ]);
  const recoveryState = await inspectRecoveryState(paths);
  configureTransactionRecovery(paths.dataRoot);
  registerWindowControlsIpc(window);
  const installationStore = createInstallationStateStore(
    win32.join(paths.dataRoot, "installation-state.json"),
  );
  const groups = createVirtualGroupService({
    dataRoot: paths.dataRoot,
    libraryRoot: paths.libraryRoot,
  });
  const commands = createLibraryCommands({ dataRoot: paths.dataRoot, groups });
  const previewAssets = createManagedImageAssets({
    assetsRoot: win32.join(paths.dataRoot, "previews"),
    kind: "preview",
  });
  const previewStore = createPreviewStateStore(win32.join(paths.dataRoot, "previews.json"));
  const previews = createPreviewService({
    assets: previewAssets,
    store: previewStore,
  });
  const legacyMigration = await migrateLegacyGroups({
    groups,
    libraryRoot: paths.libraryRoot,
    previews,
  });
  if (!legacyMigration.ok) {
    console.error("Legacy patch-group migration failed", legacyMigration.error);
  }
  const patchPreviewMigration = await previews.migratePatchBindingsToLibrary(paths.libraryRoot);
  if (!patchPreviewMigration.ok) {
    console.error("Legacy patch preview migration failed", patchPreviewMigration.error);
  }
  const wallpaperAssets = createManagedImageAssets({
    assetsRoot: win32.join(paths.dataRoot, "wallpapers"),
    kind: "wallpaper",
  });
  const wallpaper = createWallpaperService({
    assets: wallpaperAssets,
    store: createWallpaperStateStore(win32.join(paths.dataRoot, "wallpapers.json")),
  });
  const recycle = createRecycleService({ ...paths, groups, previews });
  const categoryOrder = createCategoryOrderService(
    win32.join(paths.dataRoot, "category-order.json"),
  );
  const categoryStyle = createCategoryStyleService(
    win32.join(paths.dataRoot, "category-styles.json"),
  );
  // 库根固定为 <应用根>\patch-categories，父目录即应用根；安装/便携版的转换器
  // 随 extraResources 打在 <应用根>\resources\tools\bink2nvenc，需把 resourcesPath
  // 一并作为搜索根（开发模式下该目录不存在，探测自然跳过）。
  const videoToolRoots = [win32.dirname(paths.libraryRoot), process.resourcesPath];
  registerCategoryTransferIpc({ categoryOrder, categoryStyle, paths, videoToolRoots });

  // 手动复制进库的 .bk2 不经过导入 IPC，只在扫描后发现缺预览时后台补生成。
  const videoPreviewScheduler = createVideoPreviewScheduler({
    libraryRoot: paths.libraryRoot,
    searchRoots: videoToolRoots,
    onGenerated: (relativePaths) => {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.libraryChanged, {
          kind: "video-previews-generated",
          relativePaths: [...relativePaths],
        });
      }
    },
  });
  registerCategoryStyleIpc(categoryStyle);

  const mutationMutex = createAsyncMutex();
  const binding = await registerGameDirectoryIpc(window, paths, mutationMutex, groups);
  const { getInstallService } = binding;
  const categoryDelete = createCategoryDeleteService({
    groups,
    libraryRoot: paths.libraryRoot,
    recycleMany: async (items) => {
      const install = getInstallService();
      if (!install.ok && install.error.code !== "GAME_DIRECTORY_REQUIRED") return install;
      const result = install.ok
        ? await createLibraryLifecycleService({
            groups,
            libraryRoot: paths.libraryRoot,
            install: install.value,
            previews,
            recycle,
          }).recycleMany(items)
        : await recycle.recycleMany(items);
      return result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error };
    },
  });
  registerCategoryCommandIpc({
    deleteCategory: (request) =>
      mutationMutex.runExclusive(async () => {
        const result = await categoryDelete.remove(request);
        if (!result.ok) return toApiResult(result);
        const styleResult = await categoryStyle.remove(request.relativePath);
        return styleResult.ok ? result : toApiResult(styleResult);
      }),
    paths,
    categoryOrder,
    categoryStyle,
  });
  registerPresetIpc({ getInstallService, mutationMutex, paths });
  registerAppearanceIpc({ binding, mutationMutex, wallpaper, window });
  registerPreviewIpc({ libraryRoot: paths.libraryRoot, mutationMutex, previews, window });

  register(IPC_CHANNELS.scan, ScanRequestSchema, async (request) => {
    const savedOrders = await categoryOrder.getAll();
    if (!savedOrders.ok && !recoveryState.readOnly) {
      return { ok: false, error: apiError(savedOrders.error.code) };
    }
    const [scanned, installation, previewState, groupState] = await Promise.all([
      scanCategory(paths.libraryRoot, request.relativePath, {
        includeDescendants: request.includeDescendants,
        savedOrders: savedOrders.ok ? savedOrders.value : {},
        groups,
      }),
      readInstallationState(installationStore),
      previews.read(),
      groups.list(),
    ]);
    if (!scanned.ok) {
      return toApiResult(scanned);
    }
    if (!installation.ok && !recoveryState.readOnly) {
      return { ok: false, error: apiError(installation.error.code) };
    }
    if (!previewState.ok && !recoveryState.readOnly) {
      return { ok: false, error: apiError(previewState.error.code) };
    }
    if (!groupState.ok && !recoveryState.readOnly) {
      return { ok: false, error: apiError(groupState.error.code) };
    }
    const groupMemberPaths = new Map(
      groupState.ok
        ? groupState.value.groups.map((group) => [group.id, group.memberRelativePaths] as const)
        : [],
    );
    // 扫描不等待补生成：转换在后台串行跑，完成后推送事件让渲染进程重新扫描。
    videoPreviewScheduler.schedule(collectMissingVideoPreviews(scanned.value.patches));
    const installed = decorateSnapshotWithInstallation(
      scanned.value,
      installation.ok ? installation.value.state : emptyInstallationState(),
      groupMemberPaths,
    );
    return toApiResult(
      decorateSnapshotWithPreviews(
        installed,
        previewState.ok ? previewState.value : emptyPreviewState(),
        previewAssets,
      ),
    );
  });

  register(IPC_CHANNELS.scanGroup, ScanGroupRequestSchema, async ({ groupId }) => {
    const [scanned, installation, previewState] = await Promise.all([
      scanGroup(paths.libraryRoot, groupId, { groups }),
      readInstallationState(installationStore),
      previews.read(),
    ]);
    if (!scanned.ok) return toApiResult(scanned);
    if (!installation.ok && !recoveryState.readOnly) {
      return { ok: false, error: apiError(installation.error.code) };
    }
    if (!previewState.ok && !recoveryState.readOnly) {
      return { ok: false, error: apiError(previewState.error.code) };
    }
    const installed = decorateGroupSnapshotWithInstallation(
      scanned.value,
      installation.ok ? installation.value.state : emptyInstallationState(),
    );
    return toApiResult(
      decorateGroupSnapshotWithPreviews(
        installed,
        previewState.ok ? previewState.value : emptyPreviewState(),
        previewAssets,
      ),
    );
  });

  register(IPC_CHANNELS.revealPatch, RevealPatchRequestSchema, async ({ relativePath }) => {
    if (!isLibraryPatchPath(relativePath)) {
      return { ok: false, error: apiError("INVALID_INPUT") };
    }
    const source = resolveLibraryPath(paths.libraryRoot, relativePath);
    if (!source.ok) {
      return { ok: false, error: apiError("INVALID_INPUT") };
    }
    try {
      const metadata = await stat(source.value);
      if (!metadata.isFile()) {
        return { ok: false, error: apiError("TARGET_MISSING") };
      }
      shell.showItemInFolder(source.value);
      return { ok: true, value: { revealed: true } };
    } catch {
      return { ok: false, error: apiError("TARGET_MISSING") };
    }
  });

  register(IPC_CHANNELS.openExternalUrl, OpenExternalUrlRequestSchema, async ({ url }) => {
    try {
      await shell.openExternal(url);
      return { ok: true, value: null };
    } catch {
      return { ok: false, error: apiError("OPEN_EXTERNAL_FAILED") };
    }
  });

  register(IPC_CHANNELS.createGroup, CreateGroupRequestSchema, async (request) =>
    toApiResult(await commands.createGroup({ ...request, libraryRoot: paths.libraryRoot })),
  );

  register(IPC_CHANNELS.addGroupMembers, AddGroupMembersRequestSchema, async (request) =>
    mutationMutex.runExclusive(async () => {
      const result = await groups.addMembers(request.groupId, request.patchRelativePaths);
      return toApiResult(result);
    }),
  );

  register(IPC_CHANNELS.dissolveGroup, DissolveGroupRequestSchema, async (request) =>
    mutationMutex.runExclusive(async () => {
      const result = await dissolveGroupLifecycle({
        groupId: request.groupId,
        groups,
        previews,
      });
      return toApiResult(result);
    }),
  );

  registerMoveIpc({ getInstallService, mutationMutex, paths, previews, recycle });

  register(IPC_CHANNELS.recycleItem, RecycleRequestSchema, (request) =>
    mutationMutex.runExclusive(async () => {
      const install = getInstallService();
      if (install.ok) {
        const lifecycle = createLibraryLifecycleService({
          groups,
          libraryRoot: paths.libraryRoot,
          install: install.value,
          previews,
          recycle,
        });
        const result = await lifecycle.recycle(request);
        return result.ok ? { ok: true, value: { id: result.value.entry.id } } : toApiResult(result);
      }
      if (install.error.code !== "GAME_DIRECTORY_REQUIRED") {
        return install;
      }
      const result = await recycle.recycle(request);
      return result.ok ? { ok: true, value: { id: result.value.entry.id } } : toApiResult(result);
    }),
  );

  register(IPC_CHANNELS.recycleItems, RecycleBatchRequestSchema, (request) =>
    mutationMutex.runExclusive(async () => {
      const install = getInstallService();
      if (!install.ok && install.error.code !== "GAME_DIRECTORY_REQUIRED") return install;
      const result = install.ok
        ? await createLibraryLifecycleService({
            groups,
            libraryRoot: paths.libraryRoot,
            install: install.value,
            previews,
            recycle,
          }).recycleMany(request.items)
        : await recycle.recycleMany(request.items);
      return result.ok
        ? { ok: true, value: { ids: result.value.entries.map((entry) => entry.id) } }
        : toApiResult(result);
    }),
  );

  register(IPC_CHANNELS.restoreItem, RestoreRequestSchema, async (request) => {
    const result = await recycle.restore(request);
    return toApiResult(result);
  });

  register(IPC_CHANNELS.deleteRecycleItems, DeleteRecycleItemsRequestSchema, (request) =>
    mutationMutex.runExclusive(async () => toApiResult(await recycle.deleteMany(request))),
  );

  register(IPC_CHANNELS.emptyRecycle, EmptyRecycleRequestSchema, async (request) =>
    toApiResult(await recycle.empty(request)),
  );

  ipcMain.removeHandler(IPC_CHANNELS.listRecycle);
  ipcMain.handle(IPC_CHANNELS.listRecycle, async () => {
    const result = await recycle.list();
    return result.ok ? { ok: true, value: { items: result.value } } : toApiResult(result);
  });

  register(IPC_CHANNELS.enableItem, InstallRequestSchema, (request) =>
    mutationMutex.runExclusive(async () => {
      const install = getInstallService();
      return install.ok ? toApiResult(await install.value.enable(request)) : install;
    }),
  );

  register(IPC_CHANNELS.disableItem, InstallRequestSchema, (request) =>
    mutationMutex.runExclusive(async () => {
      const install = getInstallService();
      return install.ok ? toApiResult(await install.value.disable(request)) : install;
    }),
  );

  register(IPC_CHANNELS.enableItems, InstallBatchRequestSchema, (request) =>
    mutationMutex.runExclusive(async () => {
      const install = getInstallService();
      return install.ok ? toApiResult(await install.value.enableMany(request.items)) : install;
    }),
  );

  register(IPC_CHANNELS.disableItems, InstallBatchRequestSchema, (request) =>
    mutationMutex.runExclusive(async () => {
      const install = getInstallService();
      return install.ok ? toApiResult(await install.value.disableMany(request.items)) : install;
    }),
  );
  registerUpdateIpc(window, isPackaged);
  registerRecoveryMode(recoveryState);
}

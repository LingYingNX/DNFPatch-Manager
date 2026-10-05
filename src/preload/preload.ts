import { contextBridge, type IpcRendererEvent, ipcRenderer, webUtils } from "electron";
import { z } from "zod";
import {
  AppearanceSettingsDtoSchema,
  UpdateAppearanceRequestSchema,
  WallpaperSlotRequestSchema,
} from "../shared/appearance-contracts";
import { APP_NAME, APP_RELEASE_NOTES, APP_VERSION } from "../shared/contracts";
import {
  AddGroupMembersRequestSchema,
  apiResultSchema,
  CategoryOrderRequestSchema,
  CategoryStyleStateDtoSchema,
  CreateCategoryRequestSchema,
  CreateGroupRequestSchema,
  DeleteCategoryRequestSchema,
  DeleteRecycleItemsRequestSchema,
  DissolveGroupRequestSchema,
  type DnfApi,
  EmptyRecycleRequestSchema,
  ImportDroppedPatchesRequestSchema,
  InstallBatchRequestSchema,
  InstallRequestSchema,
  IPC_CHANNELS,
  MoveCategoryRequestSchema,
  MoveItemRequestSchema,
  MoveItemsRequestSchema,
  OpenExternalUrlRequestSchema,
  RecycleBatchRequestSchema,
  RecycleEntryDtoSchema,
  RecycleRequestSchema,
  RenameCategoryRequestSchema,
  RestoreRequestSchema,
  RevealPatchRequestSchema,
  ScanGroupRequestSchema,
  ScanGroupResultSchema,
  ScanRequestSchema,
  SetCategoryStyleRequestSchema,
  SetGameDirectoryRequestSchema,
  WindowStateSchema,
} from "../shared/ipc-contracts";
import { CategorySnapshotSchema } from "../shared/library-dto";
import {
  AddItemsToPresetRequestSchema,
  CreatePresetRequestSchema,
  DeletePresetRequestSchema,
  InstallPresetRequestSchema,
  PresetInstallResultSchema,
  PresetSummarySchema,
  RenamePresetRequestSchema,
} from "../shared/preset-contracts";
import {
  ActivePreviewDtoSchema,
  SelectItemPreviewRequestSchema,
} from "../shared/preview-contracts";
import { RecoveryStateDtoSchema } from "../shared/recovery-contracts";
import { UpdateCheckResultSchema, UpdateEventSchema } from "../shared/update-contracts";

const CountResultSchema = apiResultSchema(
  z.object({ importedCount: z.number().int(), duplicateCount: z.number().int() }),
);
const RevealPatchResultSchema = apiResultSchema(z.object({ revealed: z.literal(true) }));
const InstalledResultSchema = apiResultSchema(z.object({ installedCount: z.number().int() }));
const RemovedResultSchema = apiResultSchema(z.object({ removedCount: z.number().int() }));
const RecycleListResultSchema = apiResultSchema(
  z.object({ items: z.array(RecycleEntryDtoSchema) }),
);
const IdResultSchema = apiResultSchema(z.object({ id: z.string().uuid() }));
const IdsResultSchema = apiResultSchema(z.object({ ids: z.array(z.string().uuid()) }));
const PathResultSchema = apiResultSchema(z.object({ relativePath: z.string() }));
const PathsResultSchema = apiResultSchema(z.object({ relativePaths: z.array(z.string()) }));
const DeletedIdsResultSchema = apiResultSchema(
  z.object({ deletedIds: z.array(z.string().uuid()) }),
);
const CategoryStylesResultSchema = apiResultSchema(CategoryStyleStateDtoSchema);
const GroupResultSchema = apiResultSchema(
  z.object({ id: z.string().uuid(), categoryRelativePath: z.string() }),
);
const PresetListResultSchema = apiResultSchema(z.array(PresetSummarySchema));
const PresetResultSchema = apiResultSchema(PresetSummarySchema);
const PresetDeleteResultSchema = apiResultSchema(z.object({ id: z.string().uuid() }));
const PresetInstallResultValueSchema = apiResultSchema(PresetInstallResultSchema);
const GameDirectoryResultSchema = apiResultSchema(
  z.object({ gameDirectory: z.string().nullable() }),
);
const WindowStateResultSchema = apiResultSchema(WindowStateSchema);
const WindowActionResultSchema = apiResultSchema(z.null());
const PreviewListResultSchema = apiResultSchema(
  z.object({ items: z.array(ActivePreviewDtoSchema) }),
);
const PreviewResultSchema = apiResultSchema(z.object({ previewUrl: z.string().nullable() }));
const UpdateCheckResultValueSchema = apiResultSchema(UpdateCheckResultSchema);
const AppearanceResultSchema = apiResultSchema(
  z.object({
    appearance: AppearanceSettingsDtoSchema,
    wallpaper: z.object({
      slots: z.tuple([
        z.string().nullable(),
        z.string().nullable(),
        z.string().nullable(),
        z.string().nullable(),
        z.string().nullable(),
      ]),
      activeSlot: z
        .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
        .nullable(),
    }),
  }),
);
const AppearanceUpdateResultSchema = apiResultSchema(
  z.object({ appearance: AppearanceSettingsDtoSchema }),
);

async function invoke<T>(
  channel: string,
  responseSchema: z.ZodType<T>,
  request?: unknown,
): Promise<T> {
  const response: unknown =
    request === undefined
      ? await ipcRenderer.invoke(channel)
      : await ipcRenderer.invoke(channel, request);
  return responseSchema.parse(response);
}

const api = {
  appInfo: { name: APP_NAME, version: APP_VERSION, releaseNotes: APP_RELEASE_NOTES },
  scan: (request) => {
    ScanRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.scan, apiResultSchema(CategorySnapshotSchema), request);
  },
  scanGroup: (request) => {
    ScanGroupRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.scanGroup, ScanGroupResultSchema, request);
  },
  importDroppedPatches: (request) => {
    const input = {
      categoryRelativePath: request.categoryRelativePath,
      sourcePaths: request.files.map((file) => webUtils.getPathForFile(file)),
    };
    ImportDroppedPatchesRequestSchema.parse(input);
    return invoke(IPC_CHANNELS.importDroppedPatches, CountResultSchema, input);
  },
  revealPatch: (request) => {
    RevealPatchRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.revealPatch, RevealPatchResultSchema, request);
  },
  setCategoryOrder: (request) => {
    CategoryOrderRequestSchema.parse(request);
    return invoke(
      IPC_CHANNELS.setCategoryOrder,
      apiResultSchema(z.object({ orderedCount: z.number().int().nonnegative() })),
      request,
    );
  },
  getCategoryStyles: () => invoke(IPC_CHANNELS.getCategoryStyles, CategoryStylesResultSchema),
  setCategoryStyle: (request) => {
    SetCategoryStyleRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.setCategoryStyle, CategoryStylesResultSchema, request);
  },
  createGroup: (request) => {
    CreateGroupRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.createGroup, GroupResultSchema, request);
  },
  addGroupMembers: (request) => {
    AddGroupMembersRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.addGroupMembers, IdResultSchema, request);
  },
  dissolveGroup: (request) => {
    DissolveGroupRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.dissolveGroup, IdResultSchema, request);
  },
  createCategory: (request) => {
    CreateCategoryRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.createCategory, PathResultSchema, request);
  },
  renameCategory: (request) => {
    RenameCategoryRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.renameCategory, PathResultSchema, request);
  },
  deleteCategory: (request) => {
    DeleteCategoryRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.deleteCategory, PathResultSchema, request);
  },
  moveCategory: (request) => {
    MoveCategoryRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.moveCategory, PathResultSchema, request);
  },
  moveItem: (request) => {
    MoveItemRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.moveItem, PathResultSchema, request);
  },
  moveItems: (request) => {
    MoveItemsRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.moveItems, PathsResultSchema, request);
  },
  recycleItem: (request) => {
    RecycleRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.recycleItem, IdResultSchema, request);
  },
  recycleItems: (request) => {
    RecycleBatchRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.recycleItems, IdsResultSchema, request);
  },
  restoreItem: (request) => {
    RestoreRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.restoreItem, PathResultSchema, request);
  },
  deleteRecycleItems: (request) => {
    DeleteRecycleItemsRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.deleteRecycleItems, DeletedIdsResultSchema, request);
  },
  emptyRecycle: (request) => {
    EmptyRecycleRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.emptyRecycle, RemovedResultSchema, request);
  },
  listRecycle: () => invoke(IPC_CHANNELS.listRecycle, RecycleListResultSchema),
  enableItem: (request) => {
    InstallRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.enableItem, InstalledResultSchema, request);
  },
  disableItem: (request) => {
    InstallRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.disableItem, RemovedResultSchema, request);
  },
  enableItems: (request) => {
    InstallBatchRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.enableItems, InstalledResultSchema, request);
  },
  disableItems: (request) => {
    InstallBatchRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.disableItems, RemovedResultSchema, request);
  },
  listPresets: () => invoke(IPC_CHANNELS.presetsList, PresetListResultSchema),
  createPreset: (request) => {
    CreatePresetRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.presetsCreate, PresetResultSchema, request);
  },
  renamePreset: (request) => {
    RenamePresetRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.presetsRename, PresetResultSchema, request);
  },
  deletePreset: (request) => {
    DeletePresetRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.presetsDelete, PresetDeleteResultSchema, request);
  },
  addItemsToPreset: (request) => {
    AddItemsToPresetRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.presetsAddItems, PresetResultSchema, request);
  },
  installPreset: (request) => {
    InstallPresetRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.presetsInstall, PresetInstallResultValueSchema, request);
  },
  getGameDirectory: () => invoke(IPC_CHANNELS.getGameDirectory, GameDirectoryResultSchema),
  selectGameDirectory: () => invoke(IPC_CHANNELS.selectGameDirectory, GameDirectoryResultSchema),
  setGameDirectory: (request) => {
    SetGameDirectoryRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.setGameDirectory, GameDirectoryResultSchema, request);
  },
  openExternalUrl: (request) => {
    OpenExternalUrlRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.openExternalUrl, WindowActionResultSchema, request);
  },
  windowControls: {
    getState: () => invoke(IPC_CHANNELS.getWindowState, WindowStateResultSchema),
    minimize: () => invoke(IPC_CHANNELS.minimizeWindow, WindowActionResultSchema),
    toggleMaximize: () => invoke(IPC_CHANNELS.toggleMaximizeWindow, WindowStateResultSchema),
    close: () => invoke(IPC_CHANNELS.closeWindow, WindowActionResultSchema),
    subscribeState: (listener) => {
      const handleStateChange = (_event: IpcRendererEvent, value: unknown): void => {
        const parsed = WindowStateSchema.safeParse(value);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(IPC_CHANNELS.windowStateChanged, handleStateChange);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.windowStateChanged, handleStateChange);
    },
  },
  getRecoveryState: () =>
    invoke(IPC_CHANNELS.getRecoveryState, apiResultSchema(RecoveryStateDtoSchema)),
  getPreviewState: () => invoke(IPC_CHANNELS.getPreviewState, PreviewListResultSchema),
  selectItemPreview: (request) => {
    SelectItemPreviewRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.selectItemPreview, PreviewResultSchema, request);
  },
  getAppearance: () => invoke(IPC_CHANNELS.getAppearance, AppearanceResultSchema),
  updateAppearance: (request) => {
    UpdateAppearanceRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.updateAppearance, AppearanceUpdateResultSchema, request);
  },
  importWallpaper: (request) => {
    WallpaperSlotRequestSchema.parse({ slot: request.slot });
    return invoke(IPC_CHANNELS.importWallpaper, AppearanceResultSchema, request);
  },
  activateWallpaper: (request) => {
    WallpaperSlotRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.activateWallpaper, AppearanceResultSchema, request);
  },
  deleteWallpaper: (request) => {
    WallpaperSlotRequestSchema.parse(request);
    return invoke(IPC_CHANNELS.deleteWallpaper, AppearanceResultSchema, request);
  },
  update: {
    check: () => invoke(IPC_CHANNELS.checkUpdate, UpdateCheckResultValueSchema),
    download: () => invoke(IPC_CHANNELS.downloadUpdate, WindowActionResultSchema),
    install: () => invoke(IPC_CHANNELS.installUpdate, WindowActionResultSchema),
    subscribe: (listener) => {
      const handleUpdateEvent = (_event: IpcRendererEvent, value: unknown): void => {
        const parsed = UpdateEventSchema.safeParse(value);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(IPC_CHANNELS.updateEvent, handleUpdateEvent);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.updateEvent, handleUpdateEvent);
    },
  },
} satisfies DnfApi;

contextBridge.exposeInMainWorld("dnf", api);

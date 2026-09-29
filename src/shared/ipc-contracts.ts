import { z } from "zod";
import type { AppearanceApi } from "./appearance-contracts";
import { isCategoryOrderForParent } from "./category-order";
import {
  CategoryColorSchema,
  CategoryFolderColorsSchema,
  CategoryFolderStyleColorsSchema,
  CategoryFolderStyleSchema,
  CategoryFolderStylesSchema,
} from "./category-styles";
import {
  type CategorySnapshot,
  CategorySnapshotSchema,
  type GroupSnapshot,
  GroupSnapshotSchema,
} from "./library-dto";
import { pathKey } from "./path-key";
import type {
  AddItemsToPresetRequest,
  CreatePresetRequest,
  DeletePresetRequest,
  InstallPresetRequest,
  PresetInstallResult,
  PresetSummary,
  RenamePresetRequest,
} from "./preset-contracts";
import type { ActivePreviewDto, SelectItemPreviewRequestSchema } from "./preview-contracts";
import type { RecoveryStateDto } from "./recovery-contracts";
import { isSafeRelativePath } from "./relative-path-guard";
import type { UpdateCheckResult, UpdateEvent } from "./update-contracts";

export const RelativePathSchema = z.string().max(1024).refine(isSafeRelativePath);
export const ItemRelativePathSchema = RelativePathSchema.refine((value) => value.length > 0);
export const ItemKindSchema = z.union([z.literal("patch"), z.literal("group")]);
export const ScanRequestSchema = z.object({
  includeDescendants: z.boolean().default(false),
  relativePath: RelativePathSchema,
});
export const ScanGroupRequestSchema = z.object({
  groupId: z.string().uuid(),
});
export const CreateGroupRequestSchema = z.object({
  categoryRelativePath: RelativePathSchema,
  patchRelativePaths: z.array(ItemRelativePathSchema).min(2),
  groupName: z.string().trim().min(1).max(120),
});
export const DissolveGroupRequestSchema = z.object({
  groupId: z.string().uuid(),
});
export const AddGroupMembersRequestSchema = z.object({
  groupId: z.string().uuid(),
  patchRelativePaths: z.array(ItemRelativePathSchema).min(1),
});
export const CreateCategoryRequestSchema = z.object({
  parentRelativePath: RelativePathSchema,
  name: z.string().trim().min(1).max(120),
});
export const RenameCategoryRequestSchema = z.object({
  relativePath: ItemRelativePathSchema,
  name: z.string().trim().min(1).max(120),
});
export const DeleteCategoryRequestSchema = z.object({
  relativePath: ItemRelativePathSchema,
  confirmed: z.literal(true),
});
export const MoveCategoryRequestSchema = z
  .object({
    sourceParentRelativePath: RelativePathSchema,
    sourceRelativePath: ItemRelativePathSchema,
    targetParentRelativePath: RelativePathSchema,
    targetIndex: z.number().int().nonnegative(),
    sourceParentChildRelativePaths: z.array(ItemRelativePathSchema),
    targetParentChildRelativePaths: z.array(ItemRelativePathSchema),
  })
  .refine(({ sourceParentRelativePath, sourceParentChildRelativePaths }) =>
    isCategoryOrderForParent(sourceParentRelativePath, sourceParentChildRelativePaths),
  )
  .refine(({ targetParentRelativePath, targetParentChildRelativePaths }) =>
    isCategoryOrderForParent(targetParentRelativePath, targetParentChildRelativePaths),
  )
  .refine(
    ({ targetIndex, targetParentChildRelativePaths }) =>
      targetIndex < targetParentChildRelativePaths.length,
  );
export type MoveCategoryRequest = z.input<typeof MoveCategoryRequestSchema>;
export const SetGameDirectoryRequestSchema = z.object({
  gameDirectory: z.string().trim().min(1).max(32767),
});
export const OpenExternalUrlRequestSchema = z.object({
  url: z.union([
    z.literal("https://afdian.com/a/naixu"),
    z.literal("https://docs.qq.com/smartsheet/DRXZyb2N2eUFmWHVC"),
    z.literal("https://github.com/LingYingNX/DNFguanliqi"),
    z.literal("https://qm.qq.com/q/ZxPw28W7eg"),
    z.literal("https://space.bilibili.com/41344302"),
  ]),
});

export const WindowStateSchema = z.object({
  isMaximized: z.boolean(),
});

export type WindowState = z.infer<typeof WindowStateSchema>;

const MovePatchRequestSchema = z
  .object({
    kind: z.literal("patch"),
    sourceRelativePath: ItemRelativePathSchema,
    targetDirectoryRelativePath: RelativePathSchema,
    newName: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
const MoveGroupRequestSchema = z
  .object({
    kind: z.literal("group"),
    groupId: z.string().uuid(),
    targetDirectoryRelativePath: RelativePathSchema,
    newName: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export const MoveItemRequestSchema = z.discriminatedUnion("kind", [
  MovePatchRequestSchema,
  MoveGroupRequestSchema,
]);

const MovePatchItemRequestSchema = z
  .object({ kind: z.literal("patch"), sourceRelativePath: ItemRelativePathSchema })
  .strict();
const MoveGroupItemRequestSchema = z
  .object({ kind: z.literal("group"), groupId: z.string().uuid() })
  .strict();
const MoveItemsItemRequestSchema = z.discriminatedUnion("kind", [
  MovePatchItemRequestSchema,
  MoveGroupItemRequestSchema,
]);

export const MoveItemsRequestSchema = z.object({
  items: z
    .array(MoveItemsItemRequestSchema)
    .min(1)
    .refine(
      (items) =>
        new Set(
          items.map((item) =>
            item.kind === "patch"
              ? `patch:${pathKey(item.sourceRelativePath)}`
              : `group:${item.groupId.toLocaleLowerCase()}`,
          ),
        ).size === items.length,
    ),
  targetDirectoryRelativePath: RelativePathSchema,
});

const PatchItemReferenceSchema = z
  .object({
    kind: z.literal("patch"),
    relativePath: ItemRelativePathSchema,
  })
  .strict();
const GroupItemReferenceSchema = z
  .object({
    kind: z.literal("group"),
    groupId: z.string().uuid(),
  })
  .strict();
export const ItemReferenceSchema = z.discriminatedUnion("kind", [
  PatchItemReferenceSchema,
  GroupItemReferenceSchema,
]);
export const RecycleRequestSchema = ItemReferenceSchema;

export const RestoreRequestSchema = z.object({
  id: z.string().uuid(),
});

export const DeleteRecycleItemsRequestSchema = z.object({
  ids: z.array(z.string().uuid()).min(1),
});

export const InstallRequestSchema = RecycleRequestSchema;
export const InstallBatchRequestSchema = z.object({
  items: z
    .array(InstallRequestSchema)
    .min(1)
    .refine(
      (items) =>
        new Set(
          items.map((item) =>
            item.kind === "patch"
              ? `patch:${pathKey(item.relativePath)}`
              : `group:${item.groupId.toLocaleLowerCase()}`,
          ),
        ).size === items.length,
    ),
});
export const RecycleBatchRequestSchema = InstallBatchRequestSchema;

const AbsoluteNpkPathSchema = z
  .string()
  .refine((value) => /^[a-z]:[\\/]/iu.test(value) && value.toLocaleLowerCase().endsWith(".npk"));

export const ImportDroppedPatchesRequestSchema = z.object({
  categoryRelativePath: RelativePathSchema,
  sourcePaths: z.array(AbsoluteNpkPathSchema).min(1),
});
export const RevealPatchRequestSchema = z.object({
  relativePath: ItemRelativePathSchema,
});

export const CategoryOrderRequestSchema = z
  .object({
    parentRelativePath: RelativePathSchema,
    orderedChildRelativePaths: z.array(ItemRelativePathSchema),
  })
  .refine(({ parentRelativePath, orderedChildRelativePaths }) =>
    isCategoryOrderForParent(parentRelativePath, orderedChildRelativePaths),
  );
export const SetCategoryStyleRequestSchema = z
  .object({
    relativePath: ItemRelativePathSchema,
    style: CategoryFolderStyleSchema.optional(),
    colorStyle: CategoryFolderStyleSchema.optional(),
    color: CategoryColorSchema.optional(),
  })
  .refine(
    (value) =>
      value.style !== undefined || value.color !== undefined || value.colorStyle !== undefined,
  );
export const CategoryStyleStateDtoSchema = z.object({
  styles: CategoryFolderStylesSchema,
  colors: CategoryFolderColorsSchema,
  styleColors: CategoryFolderStyleColorsSchema,
});
export type CategoryStyleStateDto = z.infer<typeof CategoryStyleStateDtoSchema>;

export const EmptyRecycleRequestSchema = z.object({
  confirmed: z.boolean(),
});

export const RecycleEntryDtoSchema = z.object({
  id: z.string().uuid(),
  kind: ItemKindSchema,
  originalRelativePath: ItemRelativePathSchema,
  recycledRelativePath: ItemRelativePathSchema,
  recycledAt: z.string().datetime(),
});
export type RecycleEntryDto = z.infer<typeof RecycleEntryDtoSchema>;

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  files: z.array(z.string()).optional(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

export type ApiResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ApiError };

export function apiResultSchema<T>(valueSchema: z.ZodType<T>): z.ZodType<ApiResult<T>> {
  return z.union([
    z.object({ ok: z.literal(true), value: valueSchema }),
    z.object({ ok: z.literal(false), error: ApiErrorSchema }),
  ]);
}

export const ScanResultSchema = apiResultSchema(CategorySnapshotSchema);
export const ScanGroupResultSchema = apiResultSchema(GroupSnapshotSchema);

export const INVALID_INPUT_ERROR: ApiError = {
  code: "INVALID_INPUT",
  message: "请求参数无效",
};

export const IPC_CHANNELS = {
  scan: "library:scan",
  scanGroup: "library:scan-group",
  importDroppedPatches: "library:import-dropped-patches",
  revealPatch: "library:reveal-patch",
  setCategoryOrder: "library:set-category-order",
  getCategoryStyles: "library:get-category-styles",
  setCategoryStyle: "library:set-category-style",
  createGroup: "library:create-group",
  addGroupMembers: "library:add-group-members",
  dissolveGroup: "library:dissolve-group",
  createCategory: "library:create-category",
  renameCategory: "library:rename-category",
  deleteCategory: "library:delete-category",
  moveCategory: "library:move-category",
  moveItem: "library:move-item",
  moveItems: "library:move-items",
  recycleItem: "library:recycle-item",
  recycleItems: "library:recycle-items",
  restoreItem: "library:restore-item",
  deleteRecycleItems: "library:delete-recycle-items",
  emptyRecycle: "library:empty-recycle",
  listRecycle: "library:list-recycle",
  enableItem: "installation:enable-item",
  disableItem: "installation:disable-item",
  enableItems: "installation:enable-items",
  disableItems: "installation:disable-items",
  getGameDirectory: "installation:get-game-directory",
  selectGameDirectory: "installation:select-game-directory",
  setGameDirectory: "installation:set-game-directory",
  openExternalUrl: "system:open-external-url",
  getWindowState: "window:get-state",
  minimizeWindow: "window:minimize",
  toggleMaximizeWindow: "window:toggle-maximize",
  closeWindow: "window:close",
  windowStateChanged: "window:state-changed",
  getPreviewState: "appearance:get-preview-state",
  selectItemPreview: "appearance:select-item-preview",
  getAppearance: "appearance:get-settings",
  updateAppearance: "appearance:update-settings",
  importWallpaper: "appearance:import-wallpaper",
  activateWallpaper: "appearance:activate-wallpaper",
  deleteWallpaper: "appearance:delete-wallpaper",
  presetsList: "presets:list",
  presetsCreate: "presets:create",
  presetsRename: "presets:rename",
  presetsDelete: "presets:delete",
  presetsAddItems: "presets:add-items",
  presetsInstall: "presets:install",
  getRecoveryState: "settings:get-recovery-state",
  checkUpdate: "update:check",
  downloadUpdate: "update:download",
  installUpdate: "update:install",
  updateEvent: "update:event",
} as const;

export type DnfApi = {
  readonly appInfo: {
    readonly name: string;
    readonly version: string;
    readonly releaseNotes?: readonly string[];
  };
  readonly scan: (
    request: z.input<typeof ScanRequestSchema>,
  ) => Promise<ApiResult<CategorySnapshot>>;
  readonly scanGroup: (
    request: z.input<typeof ScanGroupRequestSchema>,
  ) => Promise<ApiResult<GroupSnapshot>>;
  readonly importDroppedPatches: (request: {
    readonly categoryRelativePath: string;
    readonly files: readonly File[];
  }) => Promise<ApiResult<{ readonly importedCount: number; readonly duplicateCount: number }>>;
  readonly revealPatch: (
    request: z.input<typeof RevealPatchRequestSchema>,
  ) => Promise<ApiResult<{ readonly revealed: true }>>;
  readonly setCategoryOrder: (
    request: z.input<typeof CategoryOrderRequestSchema>,
  ) => Promise<ApiResult<{ readonly orderedCount: number }>>;
  readonly getCategoryStyles: () => Promise<ApiResult<CategoryStyleStateDto>>;
  readonly setCategoryStyle: (
    request: z.input<typeof SetCategoryStyleRequestSchema>,
  ) => Promise<ApiResult<CategoryStyleStateDto>>;
  readonly createGroup: (
    request: z.input<typeof CreateGroupRequestSchema>,
  ) => Promise<ApiResult<{ readonly id: string; readonly categoryRelativePath: string }>>;
  readonly addGroupMembers: (
    request: z.input<typeof AddGroupMembersRequestSchema>,
  ) => Promise<ApiResult<{ readonly id: string }>>;
  readonly dissolveGroup: (
    request: z.input<typeof DissolveGroupRequestSchema>,
  ) => Promise<ApiResult<{ readonly id: string }>>;
  readonly createCategory: (
    request: z.input<typeof CreateCategoryRequestSchema>,
  ) => Promise<ApiResult<{ readonly relativePath: string }>>;
  readonly renameCategory: (
    request: z.input<typeof RenameCategoryRequestSchema>,
  ) => Promise<ApiResult<{ readonly relativePath: string }>>;
  readonly deleteCategory: (
    request: z.input<typeof DeleteCategoryRequestSchema>,
  ) => Promise<ApiResult<{ readonly relativePath: string }>>;
  readonly moveCategory?: (
    request: MoveCategoryRequest,
  ) => Promise<ApiResult<{ readonly relativePath: string }>>;
  readonly moveItem: (
    request: z.input<typeof MoveItemRequestSchema>,
  ) => Promise<ApiResult<{ readonly relativePath: string }>>;
  readonly moveItems: (
    request: z.input<typeof MoveItemsRequestSchema>,
  ) => Promise<ApiResult<{ readonly relativePaths: readonly string[] }>>;
  readonly recycleItem: (
    request: z.input<typeof RecycleRequestSchema>,
  ) => Promise<ApiResult<{ readonly id: string }>>;
  readonly recycleItems: (
    request: z.input<typeof RecycleBatchRequestSchema>,
  ) => Promise<ApiResult<{ readonly ids: readonly string[] }>>;
  readonly restoreItem: (
    request: z.input<typeof RestoreRequestSchema>,
  ) => Promise<ApiResult<{ readonly relativePath: string }>>;
  readonly deleteRecycleItems: (
    request: z.input<typeof DeleteRecycleItemsRequestSchema>,
  ) => Promise<ApiResult<{ readonly deletedIds: readonly string[] }>>;
  readonly emptyRecycle: (
    request: z.input<typeof EmptyRecycleRequestSchema>,
  ) => Promise<ApiResult<{ readonly removedCount: number }>>;
  readonly listRecycle: () => Promise<ApiResult<{ readonly items: readonly RecycleEntryDto[] }>>;
  readonly enableItem: (
    request: z.input<typeof InstallRequestSchema>,
  ) => Promise<ApiResult<{ readonly installedCount: number }>>;
  readonly disableItem: (
    request: z.input<typeof InstallRequestSchema>,
  ) => Promise<ApiResult<{ readonly removedCount: number }>>;
  readonly enableItems: (
    request: z.input<typeof InstallBatchRequestSchema>,
  ) => Promise<ApiResult<{ readonly installedCount: number }>>;
  readonly disableItems: (
    request: z.input<typeof InstallBatchRequestSchema>,
  ) => Promise<ApiResult<{ readonly removedCount: number }>>;
  readonly listPresets: () => Promise<ApiResult<readonly PresetSummary[]>>;
  readonly createPreset: (request: CreatePresetRequest) => Promise<ApiResult<PresetSummary>>;
  readonly renamePreset: (request: RenamePresetRequest) => Promise<ApiResult<PresetSummary>>;
  readonly deletePreset: (
    request: DeletePresetRequest,
  ) => Promise<ApiResult<{ readonly id: string }>>;
  readonly addItemsToPreset: (
    request: AddItemsToPresetRequest,
  ) => Promise<ApiResult<PresetSummary>>;
  readonly installPreset: (
    request: InstallPresetRequest,
  ) => Promise<ApiResult<PresetInstallResult>>;
  readonly getGameDirectory: () => Promise<ApiResult<{ readonly gameDirectory: string | null }>>;
  readonly selectGameDirectory: () => Promise<ApiResult<{ readonly gameDirectory: string | null }>>;
  readonly setGameDirectory: (
    request: z.input<typeof SetGameDirectoryRequestSchema>,
  ) => Promise<ApiResult<{ readonly gameDirectory: string | null }>>;
  readonly openExternalUrl: (
    request: z.input<typeof OpenExternalUrlRequestSchema>,
  ) => Promise<ApiResult<null>>;
  readonly windowControls: {
    readonly getState: () => Promise<ApiResult<WindowState>>;
    readonly minimize: () => Promise<ApiResult<null>>;
    readonly toggleMaximize: () => Promise<ApiResult<WindowState>>;
    readonly close: () => Promise<ApiResult<null>>;
    readonly subscribeState: (listener: (state: WindowState) => void) => () => void;
  };
  readonly getRecoveryState: () => Promise<ApiResult<RecoveryStateDto>>;
  readonly update: {
    readonly check: () => Promise<ApiResult<UpdateCheckResult>>;
    readonly download: () => Promise<ApiResult<null>>;
    readonly install: () => Promise<ApiResult<null>>;
    readonly subscribe: (listener: (event: UpdateEvent) => void) => () => void;
  };
  readonly getPreviewState: () => Promise<
    ApiResult<{ readonly items: readonly ActivePreviewDto[] }>
  >;
  readonly selectItemPreview: (
    request: z.input<typeof SelectItemPreviewRequestSchema>,
  ) => Promise<ApiResult<{ readonly previewUrl: string | null }>>;
} & AppearanceApi;

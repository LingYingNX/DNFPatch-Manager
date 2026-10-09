import type { AppearanceBundleDto } from "../../src/shared/appearance-contracts";
import type { DnfApi } from "../../src/shared/ipc-contracts";
import type { CategorySnapshot } from "../../src/shared/library-dto";
import type { LibraryChangedEvent } from "../../src/shared/library-events";
import type { UpdateEvent } from "../../src/shared/update-contracts";

const appearanceState = {
  appearance: {
    theme: "halo" as const,
    temperature: 0,
    saturation: 100,
    contrast: 100,
    scale: 100,
    opacity: 50,
    blur: 0,
    positionX: 50,
    positionY: 50,
    categoryTextColor: "#9AA0AE",
    selectedTint: "#5B6BFF",
    navigationFontColor: "#F2F4F8FF",
    patchCardFontColor: "#F2F4F8FF",
  },
  wallpaper: {
    slots: [null, null, null, null, null] as [null, null, null, null, null],
    activeSlot: null,
  },
};
const PRESET_ID = "0552babf-49b5-4390-96a7-1846a0c1e9f8";

export function createFakeApi(snapshot: CategorySnapshot): DnfApi {
  const updateListeners = new Set<(event: UpdateEvent) => void>();
  const emitUpdate = (event: UpdateEvent): void => {
    for (const listener of updateListeners) listener(event);
  };
  const libraryChangeListeners = new Set<(event: LibraryChangedEvent) => void>();
  const explicitGroupMembers = new Map<string, readonly string[]>([
    [PRESET_ID, ["coat.npk", "sword.npk"]],
  ]);
  let currentAppearanceState: AppearanceBundleDto = {
    appearance: { ...appearanceState.appearance },
    wallpaper: {
      slots: [...appearanceState.wallpaper.slots] as [
        string | null,
        string | null,
        string | null,
        string | null,
        string | null,
      ],
      activeSlot: appearanceState.wallpaper.activeSlot,
    },
  };

  return {
    appInfo: {
      name: "DNF 补丁管理器",
      version: "1.1.0",
      releaseNotes: ["当前版本发行说明"],
    },
    update: {
      check: async () => {
        emitUpdate({ kind: "checking" });
        emitUpdate({
          kind: "available",
          version: "9.9.9",
          releaseNotes: ["新增项目地址与QQ群交流入口，优化软件更新提示。"],
        });
        return {
          ok: true,
          value: {
            currentVersion: "1.1.0",
            latestVersion: "9.9.9",
            updateAvailable: true,
            releaseNotes: ["新增项目地址与QQ群交流入口，优化软件更新提示。"],
          },
        };
      },
      download: async () => {
        emitUpdate({ kind: "downloading", percent: 100 });
        emitUpdate({ kind: "downloaded", version: "9.9.9" });
        return { ok: true, value: null };
      },
      install: async () => ({ ok: true, value: null }),
      subscribe: (listener) => {
        updateListeners.add(listener);
        return () => {
          updateListeners.delete(listener);
        };
      },
    },
    subscribeLibraryChanges: (listener) => {
      libraryChangeListeners.add(listener);
      return () => {
        libraryChangeListeners.delete(listener);
      };
    },
    scan: async () => ({ ok: true, value: snapshot }),
    scanGroup: async ({ groupId }) => {
      const group = snapshot.groups.find((candidate) => candidate.id === groupId);
      return group === undefined
        ? { ok: false, error: { code: "GROUP_NOT_FOUND", message: "补丁组不存在" } }
        : {
            ok: true,
            value: {
              group,
              patches: snapshot.patches.filter((patch) =>
                (explicitGroupMembers.get(group.id) ?? []).some(
                  (memberPath) =>
                    patch.relativePath.replaceAll("/", "\\").toLocaleLowerCase() ===
                    memberPath.replaceAll("/", "\\").toLocaleLowerCase(),
                ),
              ),
            },
          };
    },
    importDroppedPatches: async () => ({
      ok: true,
      value: { importedCount: 1, duplicateCount: 0 },
    }),
    revealPatch: async () => ({ ok: true, value: { revealed: true } }),
    setCategoryOrder: async (request) => ({
      ok: true,
      value: { orderedCount: request.orderedChildRelativePaths.length },
    }),
    getCategoryStyles: async () => ({
      ok: true,
      value: { styles: {}, colors: {}, styleColors: {} },
    }),
    setCategoryStyle: async ({ relativePath, style }) => ({
      ok: true,
      value: {
        styles: style === undefined ? {} : { [relativePath]: style },
        colors: {},
        styleColors: {},
      },
    }),
    createGroup: async () => ({
      ok: true,
      value: { id: "0552babf-49b5-4390-96a7-1846a0c1e9f8", categoryRelativePath: "CategoryA" },
    }),
    addGroupMembers: async ({ groupId }) => ({
      ok: true,
      value: { id: groupId },
    }),
    dissolveGroup: async ({ groupId }) => ({
      ok: true,
      value: { id: groupId },
    }),
    createCategory: async ({ parentRelativePath, name }) => ({
      ok: true,
      value: { relativePath: `${parentRelativePath}\\${name}` },
    }),
    renameCategory: async ({ name }) => ({
      ok: true,
      value: { relativePath: name },
    }),
    deleteCategory: async ({ relativePath }) => ({ ok: true, value: { relativePath } }),
    moveItem: async (request) => ({
      ok: true,
      value: {
        relativePath: `${request.targetDirectoryRelativePath}\\${request.newName ?? "item.npk"}`,
      },
    }),
    moveItems: async (request) => ({
      ok: true,
      value: {
        relativePaths: request.items.map((item) =>
          item.kind === "patch"
            ? `${request.targetDirectoryRelativePath}\\${item.sourceRelativePath}`
            : item.groupId,
        ),
      },
    }),
    recycleItem: async () => ({
      ok: true,
      value: { id: "a2021aa5-e024-4106-a0a3-f0874d4c9ec9" },
    }),
    recycleItems: async ({ items }) => ({
      ok: true,
      value: { ids: items.map(() => "a2021aa5-e024-4106-a0a3-f0874d4c9ec9") },
    }),
    deleteRecycleItems: async ({ ids }) => ({
      ok: true,
      value: { deletedIds: [...ids] },
    }),
    restoreItem: async () => ({ ok: true, value: { relativePath: "分类A\\coat.npk" } }),
    emptyRecycle: async () => ({ ok: true, value: { removedCount: 1 } }),
    listRecycle: async () => ({ ok: true, value: { items: [] } }),
    enableItem: async () => ({ ok: true, value: { installedCount: 1 } }),
    disableItem: async () => ({ ok: true, value: { removedCount: 1 } }),
    enableItems: async ({ items }) => ({ ok: true, value: { installedCount: items.length } }),
    disableItems: async ({ items }) => ({ ok: true, value: { removedCount: items.length } }),
    listPresets: async () => ({ ok: true, value: [] }),
    createPreset: async ({ name, items }) => ({
      ok: true,
      value: {
        id: PRESET_ID,
        name,
        items,
        createdAt: "2026-07-22T00:00:00.000Z",
        updatedAt: "2026-07-22T00:00:00.000Z",
        missingPaths: [],
      },
    }),
    renamePreset: async ({ id, name }) => ({
      ok: true,
      value: {
        id,
        name,
        items: [],
        createdAt: "2026-07-22T00:00:00.000Z",
        updatedAt: "2026-07-22T00:00:00.000Z",
        missingPaths: [],
      },
    }),
    deletePreset: async ({ id }) => ({ ok: true, value: { id } }),
    addItemsToPreset: async ({ id, items }) => ({
      ok: true,
      value: {
        id,
        name: "测试预设",
        items,
        createdAt: "2026-07-22T00:00:00.000Z",
        updatedAt: "2026-07-22T00:00:00.000Z",
        missingPaths: [],
      },
    }),
    installPreset: async () => ({
      ok: true,
      value: { installedCount: 0, missingPaths: [] },
    }),
    getGameDirectory: async () => ({ ok: true, value: { gameDirectory: null } }),
    selectGameDirectory: async () => ({ ok: true, value: { gameDirectory: "D:\\DNF" } }),
    setGameDirectory: async ({ gameDirectory }) => ({
      ok: true,
      value: { gameDirectory },
    }),
    openExternalUrl: async () => ({ ok: true, value: null }),
    windowControls: {
      getState: async () => ({ ok: true, value: { isMaximized: false } }),
      minimize: async () => ({ ok: true, value: null }),
      toggleMaximize: async () => ({ ok: true, value: { isMaximized: false } }),
      close: async () => ({ ok: true, value: null }),
      subscribeState: () => () => {},
    },
    getRecoveryState: async () => ({ ok: true, value: { readOnly: false, files: [] } }),
    getPreviewState: async () => ({ ok: true, value: { items: [] } }),
    selectItemPreview: async () => ({ ok: true, value: { previewUrl: null } }),
    getAppearance: async () => ({ ok: true, value: currentAppearanceState }),
    updateAppearance: async (appearance) => {
      currentAppearanceState = { ...currentAppearanceState, appearance };
      return { ok: true, value: { appearance } };
    },
    importWallpaper: async ({ slot }) => {
      const slots = [...currentAppearanceState.wallpaper.slots] as [
        string | null,
        string | null,
        string | null,
        string | null,
        string | null,
      ];
      slots[slot] = "imported-wallpaper.jpg";
      currentAppearanceState = {
        ...currentAppearanceState,
        wallpaper: { slots, activeSlot: slot },
      };
      return { ok: true, value: currentAppearanceState };
    },
    activateWallpaper: async ({ slot }) => {
      currentAppearanceState = {
        ...currentAppearanceState,
        wallpaper: { ...currentAppearanceState.wallpaper, activeSlot: slot },
      };
      return { ok: true, value: currentAppearanceState };
    },
    deleteWallpaper: async ({ slot }) => {
      const slots = [...currentAppearanceState.wallpaper.slots] as [
        string | null,
        string | null,
        string | null,
        string | null,
        string | null,
      ];
      slots[slot] = null;
      currentAppearanceState = {
        ...currentAppearanceState,
        wallpaper: {
          slots,
          activeSlot:
            currentAppearanceState.wallpaper.activeSlot === slot
              ? null
              : currentAppearanceState.wallpaper.activeSlot,
        },
      };
      return { ok: true, value: currentAppearanceState };
    },
  };
}

export const WORKSPACE_SNAPSHOT: CategorySnapshot = {
  relativePath: "",
  patchCount: 2,
  patches: [
    {
      kind: "patch",
      name: "coat.npk",
      relativePath: "coat.npk",
      previewRelativePath: null,
      previewUrl: null,
      size: 1024,
      modifiedAt: "2026-07-18T00:00:00.000Z",
      enabled: true,
    },
    {
      kind: "patch",
      name: "sword.npk",
      relativePath: "sword.npk",
      previewRelativePath: null,
      previewUrl: null,
      size: 2048,
      modifiedAt: "2026-07-18T00:00:00.000Z",
      enabled: false,
    },
  ],
  groups: [
    {
      kind: "group",
      id: "0552babf-49b5-4390-96a7-1846a0c1e9f8",
      name: "套装",
      categoryRelativePath: "",
      relativePath: "套装",
      previewRelativePath: null,
      previewUrl: null,
      patchCount: 2,
      createdAt: "2026-07-18T00:00:00.000Z",
      enabled: false,
    },
  ],
  childCategories: [{ name: "分类A", relativePath: "分类A", patchCount: 0, childCategories: [] }],
};

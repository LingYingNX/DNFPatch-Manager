import { useCallback, useEffect, useState } from "react";
import type { DnfApi } from "../../shared/ipc-contracts";
import type { CategorySnapshot, ChildCategory } from "../../shared/library-dto";
import type { NavigationSelection, ViewMode } from "../workspace/model";
import { workspaceItemKey } from "../workspace/model";
import { useAppearance } from "../workspace/useAppearance";
import { useAppUpdate } from "../workspace/useAppUpdate";
import { useGameDirectory } from "../workspace/useGameDirectory";
import { useItemSelection } from "../workspace/useItemSelection";
import { usePresets } from "../workspace/usePresets";
import { useRecoveryState } from "../workspace/useRecoveryState";
import { useWorkspace } from "../workspace/useWorkspace";
import { useWorkspaceOperations } from "../workspace/useWorkspaceOperations";
import { AppearanceDialog } from "./AppearanceDialog";
import { type CategoryDialog, CategoryDialogs } from "./CategoryDialogs";
import { CategorySidebar } from "./CategorySidebar";
import { ItemWorkspace, type MoveTarget } from "./ItemWorkspace";
import { type OperationDialog, OperationDialogs } from "./OperationDialogs";
import { type PresetDialog, PresetDialogs } from "./PresetDialogs";
import { PresetWorkspace } from "./PresetWorkspace";
import { Toast } from "./primitives";
import { RecycleBinWorkspace } from "./RecycleBinWorkspace";
import { SettingsDialog } from "./SettingsDialog";
import { SidebarResizeHandle } from "./SidebarResizeHandle";
import { WindowTitleBar } from "./WindowTitleBar";

type WorkspaceAppProps = {
  readonly client: DnfApi | undefined;
};

const DEFAULT_SIDEBAR_WIDTH = 232;
const MINIMUM_SIDEBAR_WIDTH = 200;
const MAXIMUM_SIDEBAR_WIDTH = 520;

function moveTargets(snapshot: CategorySnapshot | null): readonly MoveTarget[] {
  if (snapshot === null) {
    return [];
  }
  const mapTargets = (categories: readonly ChildCategory[]): readonly MoveTarget[] =>
    categories.map((category) => ({
      children: mapTargets(category.childCategories),
      label: category.name,
      relativePath: category.relativePath,
    }));
  return mapTargets(snapshot.childCategories);
}

export function WorkspaceApp({ client }: WorkspaceAppProps): React.JSX.Element {
  const [navigation, setNavigation] = useState<NavigationSelection>({ kind: "all" });
  const workspaceScope =
    navigation.kind === "category"
      ? "category"
      : navigation.kind === "group"
        ? "group"
        : navigation.kind === "uncategorized"
          ? "uncategorized"
          : "all";
  const workspace = useWorkspace(
    client,
    navigation.kind === "group"
      ? { groupId: navigation.groupId, scope: workspaceScope }
      : { scope: workspaceScope },
  );
  const gameDirectory = useGameDirectory(client);
  const appUpdate = useAppUpdate(client);
  const selection = useItemSelection(workspace.visibleItems);
  const presets = usePresets(client, {
    refreshWorkspace: workspace.refresh,
    showNotice: workspace.showNotice,
  });
  const operations = useWorkspaceOperations({
    categoryPath: workspace.categoryPath,
    clearSelection: selection.clearSelection,
    client,
    refresh: workspace.refresh,
    refreshRecycle: workspace.refreshRecycle,
    selectedItems: selection.selectedItems,
    showNotice: workspace.showNotice,
  });
  const [activeDialog, setActiveDialog] = useState<OperationDialog>(null);
  const [categoryDialog, setCategoryDialog] = useState<CategoryDialog>(null);
  const [categoryDeleteHasContents, setCategoryDeleteHasContents] = useState(false);
  const [categoryDeletePath, setCategoryDeletePath] = useState("");
  const [presetDialog, setPresetDialog] = useState<PresetDialog>(null);
  const [operationBusy, setOperationBusy] = useState(false);
  const [busyItemKeys, setBusyItemKeys] = useState<ReadonlySet<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const notice = gameDirectory.notice ?? workspace.notice;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const appearance = useAppearance(client, workspace.showNotice);
  const recovery = useRecoveryState(client);
  const [noticeLeaving, setNoticeLeaving] = useState(false);

  const dismissNotice = useCallback((): void => {
    setNoticeLeaving(true);
    gameDirectory.showNotice(null);
    workspace.showNotice(null);
    // 等 CSS 淡出过渡播完再卸载元素。
    window.setTimeout(() => setNoticeLeaving(false), 320);
  }, [gameDirectory.showNotice, workspace.showNotice]);

  // 提示条 5 秒后带淡出动画消失；notice 变化（含手动关闭）都会重置计时。
  useEffect(() => {
    if (notice === null) {
      setNoticeLeaving(false);
      return;
    }
    const leavingTimer = window.setTimeout(dismissNotice, 5000);
    return () => {
      window.clearTimeout(leavingTimer);
    };
  }, [notice, dismissNotice]);

  useEffect(() => {
    if (navigation.kind === "category" && navigation.relativePath !== workspace.categoryPath) {
      setNavigation({ kind: "category", relativePath: workspace.categoryPath });
    }
  }, [navigation, workspace.categoryPath]);

  useEffect(() => {
    void workspace.refreshRecycle();
  }, [workspace.refreshRecycle]);

  const navigate = (next: NavigationSelection): void => {
    selection.clearSelection();
    setNavigation(next);
    workspace.setCategoryPath(
      next.kind === "category"
        ? next.relativePath
        : next.kind === "group"
          ? next.categoryRelativePath
          : "",
    );
  };

  const itemWorkspace =
    navigation.kind === "community" ? (
      <main className="placeholder-workspace" aria-label="资源社区">
        <h2>待构建</h2>
      </main>
    ) : navigation.kind === "recycle" ? (
      <RecycleBinWorkspace operations={operations} recycleEntries={workspace.recycleEntries} />
    ) : navigation.kind === "presets" ? (
      <PresetWorkspace
        busyKey={presets.busyKey}
        loading={presets.loading}
        onDelete={(preset) => setPresetDialog({ kind: "delete", preset })}
        onToggle={(id, enabled) => void presets.setEnabled(id, enabled)}
        onRename={(preset) => setPresetDialog({ kind: "rename", preset })}
        presets={presets.presets}
        readOnly={recovery.readOnly}
        workspaceItems={workspace.items}
        workspaceLoading={workspace.loading}
      />
    ) : (
      <ItemWorkspace
        categoryPath={workspace.categoryPath}
        enabledCounts={workspace.enabledCounts}
        enabledFilter={workspace.enabledFilter}
        includeDescendants={workspace.includeDescendants}
        items={workspace.items}
        loading={workspace.loading}
        onQueryChange={workspace.setQuery}
        onViewModeChange={setViewMode}
        onBoxSelect={selection.selectBox}
        onImportDropped={(files) => void workspace.importDroppedPatches(files)}
        onRevealSource={(relativePath) => void workspace.revealPatch(relativePath)}
        onIncludeDescendantsChange={workspace.setIncludeDescendants}
        onEnabledFilterChange={workspace.setEnabledFilter}
        moveTargets={moveTargets(workspace.navigationSnapshot)}
        onDissolveGroup={() => {
          setOperationBusy(true);
          void operations.dissolveGroup().finally(() => setOperationBusy(false));
        }}
        onEnterGroup={(item) => {
          if (item.kind === "group") {
            navigate({
              kind: "group",
              categoryRelativePath: item.categoryRelativePath ?? item.relativePath,
              groupId: item.id,
            });
          }
        }}
        onReturnFromGroup={
          navigation.kind === "group"
            ? () =>
                navigate({
                  kind: "category",
                  relativePath: navigation.categoryRelativePath,
                })
            : undefined
        }
        onSelectPreview={(item) => {
          if (client === undefined) return;
          void client
            .selectItemPreview(
              item.kind === "patch"
                ? { kind: "patch", relativePath: item.relativePath }
                : { kind: "group", groupId: item.id },
            )
            .then((result) => {
              if (result.ok && result.value.previewUrl !== null) void workspace.refresh();
              else if (!result.ok)
                workspace.showNotice({ tone: "error", message: result.error.message });
            });
        }}
        onSelect={selection.selectItem}
        selectedPaths={selection.selectedPaths}
        selectedItems={selection.selectedItems}
        operationBusy={operationBusy}
        busyItemKeys={busyItemKeys}
        query={workspace.query}
        onAddToPreset={() =>
          setPresetDialog({
            kind: "selection",
            items: selection.selectedItems.flatMap((item) =>
              item.kind === "patch"
                ? [{ kind: "patch" as const, relativePath: item.relativePath }]
                : [],
            ),
          })
        }
        onCreateGroup={() => {
          setOperationBusy(true);
          void operations.createGroup("自定义").finally(() => setOperationBusy(false));
        }}
        onAddGroupMembers={(groupId, patches) => {
          setOperationBusy(true);
          void operations.addGroupMembers(groupId, patches).finally(() => setOperationBusy(false));
        }}
        onMove={() => setActiveDialog("move")}
        onMoveTo={(targetDirectoryRelativePath, items) => {
          setOperationBusy(true);
          void operations
            .moveItems(items, targetDirectoryRelativePath)
            .finally(() => setOperationBusy(false));
        }}
        onRecycle={() => {
          if (selection.selectedItems.some((item) => item.enabled)) {
            setActiveDialog("recycle");
            return;
          }
          setOperationBusy(true);
          void operations
            .recycle()
            .finally(() => {
              void workspace.refreshRecycle();
            })
            .finally(() => setOperationBusy(false));
        }}
        onRenameItem={(item, newName) => {
          setOperationBusy(true);
          return operations.renameItem(item, newName).finally(() => setOperationBusy(false));
        }}
        onSetItemEnabled={(item, enabled) => {
          // 单个开关的启用/停用只标记该卡片为忙碌，避免全局 busy 让所有开关闪烁。
          const itemKey = workspaceItemKey(item);
          setBusyItemKeys((current) => new Set([...current, itemKey]));
          void operations.setEnabledFor([item], enabled).finally(() => {
            setBusyItemKeys((current) => {
              const next = new Set(current);
              next.delete(itemKey);
              return next;
            });
          });
        }}
        onSetItemsEnabled={(items, enabled) => {
          // 批量入口标记全部涉及条目，同样不动全局 busy。
          const itemKeys = items.map(workspaceItemKey);
          setBusyItemKeys((current) => new Set([...current, ...itemKeys]));
          void operations.setEnabledFor(items, enabled).finally(() => {
            setBusyItemKeys((current) => {
              const next = new Set(current);
              for (const key of itemKeys) next.delete(key);
              return next;
            });
          });
        }}
        readOnly={recovery.readOnly}
        showDescendantToggle={navigation.kind !== "uncategorized" && navigation.kind !== "group"}
        visibleItems={workspace.visibleItems}
        viewMode={viewMode}
      />
    );

  const deletionTargetPath = categoryDeletePath || workspace.categoryPath;

  return (
    <div
      className="app-shell"
      data-read-only={recovery.readOnly}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
    >
      <WindowTitleBar client={client} update={appUpdate} />
      {recovery.readOnly ? (
        <div className="recovery-banner" role="alert">
          状态文件损坏，当前为只读恢复模式。损坏文件：{recovery.files.join("；")}
        </div>
      ) : null}
      <div className="workspace-layout">
        <CategorySidebar
          categoryPath={workspace.categoryPath}
          client={client}
          navigation={navigation}
          onCreateCategory={() => setCategoryDialog("create")}
          onCreateCategoryAt={workspace.createCategoryAt}
          onDeleteCategory={(relativePath, hasContents) => {
            setCategoryDeletePath(relativePath);
            setCategoryDeleteHasContents(hasContents);
            if (hasContents) {
              setCategoryDialog("delete");
            } else {
              void workspace.deleteCategoryAt(relativePath);
            }
          }}
          onAppearance={() => setAppearanceOpen(true)}
          onRecycleBin={() => {
            navigate({ kind: "recycle" });
          }}
          onSettings={() => setSettingsOpen(true)}
          onMoveCategory={(request) => void workspace.moveCategory(request)}
          onMoveItems={(targetRelativePath, items) => {
            setOperationBusy(true);
            void operations
              .moveItems(items, targetRelativePath)
              .finally(() => setOperationBusy(false));
          }}
          onReorder={(parentPath, paths) => void workspace.setCategoryOrder(parentPath, paths)}
          onRenameCategoryAt={workspace.renameCategoryAt}
          presetCount={presets.presets.length}
          readOnly={recovery.readOnly}
          recycleCount={workspace.recycleEntries.length}
          onSelect={(relativePath) => navigate({ kind: "category", relativePath })}
          onSelectNavigation={navigate}
          snapshot={workspace.navigationSnapshot}
        />
        <SidebarResizeHandle
          maximumWidth={MAXIMUM_SIDEBAR_WIDTH}
          minimumWidth={MINIMUM_SIDEBAR_WIDTH}
          onChange={(width) =>
            setSidebarWidth(
              Math.min(MAXIMUM_SIDEBAR_WIDTH, Math.max(MINIMUM_SIDEBAR_WIDTH, Math.round(width))),
            )
          }
          width={sidebarWidth}
        />
        {itemWorkspace}
      </div>
      <OperationDialogs
        active={activeDialog}
        navigationSnapshot={workspace.navigationSnapshot}
        onClose={() => setActiveDialog(null)}
        operations={operations}
        selectedItems={selection.selectedItems}
      />
      <CategoryDialogs
        active={categoryDialog}
        categoryPath={deletionTargetPath}
        createCategory={workspace.createCategory}
        deleteCategory={() => workspace.deleteCategoryAt(deletionTargetPath)}
        hasContents={categoryDeleteHasContents}
        onClose={() => setCategoryDialog(null)}
        renameCategory={workspace.renameCategory}
      />
      <PresetDialogs
        active={presetDialog}
        onAddItems={presets.addItems}
        onClose={() => setPresetDialog(null)}
        onCreate={presets.create}
        onDelete={presets.remove}
        onRename={presets.rename}
        presets={presets.presets}
      />
      {settingsOpen ? (
        <SettingsDialog
          currentVersion={client?.appInfo.version ?? "1.2.7"}
          gameDirectory={gameDirectory.gameDirectory}
          gameDirectoryBusy={
            gameDirectory.loading || gameDirectory.selecting || gameDirectory.saving
          }
          onClose={() => setSettingsOpen(false)}
          onOpenExternalUrl={(url) => {
            if (client === undefined) return;
            void client.openExternalUrl({ url }).then((result) => {
              if (!result.ok)
                workspace.showNotice({ tone: "error", message: result.error.message });
            });
          }}
          onSelectGameDirectory={gameDirectory.select}
          onSetGameDirectory={gameDirectory.save}
          update={appUpdate}
        />
      ) : null}
      {appearanceOpen ? (
        <AppearanceDialog
          appearance={appearance.appearance}
          busy={appearance.busy}
          onActivateWallpaper={(slot) => void appearance.activateWallpaper(slot)}
          onClose={() => setAppearanceOpen(false)}
          onDeleteWallpaper={(slot) => void appearance.deleteWallpaper(slot)}
          onImportWallpaper={(slot) => void appearance.importWallpaper(slot)}
          onUpdate={(next) => void appearance.update(next)}
          wallpaper={appearance.wallpaper}
        />
      ) : null}
      {notice === null ? null : (
        <div className="toast-viewport">
          <Toast data-leaving={noticeLeaving} onClose={dismissNotice} tone={notice.tone}>
            {notice.message}
          </Toast>
        </div>
      )}
    </div>
  );
}

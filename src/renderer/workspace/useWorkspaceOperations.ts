import type { DnfApi, RecycleEntryDto } from "../../shared/ipc-contracts";
import {
  type Notice,
  type WorkspaceItem,
  type WorkspaceItemReference,
  workspaceItemReference,
} from "./model";

type OperationContext = {
  readonly categoryPath: string;
  readonly clearSelection: () => void;
  readonly client: DnfApi | undefined;
  readonly refresh: () => Promise<boolean>;
  readonly refreshRecycle: () => Promise<boolean>;
  readonly selectedItems: readonly WorkspaceItem[];
  readonly showNotice: (notice: Notice) => void;
};

function installReference(
  item: WorkspaceItem,
):
  | { readonly kind: "patch"; readonly relativePath: string }
  | { readonly kind: "group"; readonly groupId: string } {
  return item.kind === "patch"
    ? { kind: "patch", relativePath: item.relativePath }
    : { kind: "group", groupId: item.id };
}

export function useWorkspaceOperations({
  categoryPath,
  clearSelection,
  client,
  refresh,
  refreshRecycle,
  selectedItems,
  showNotice,
}: OperationContext) {
  const reportFailure = (message: string): false => {
    showNotice({ tone: "error", message });
    return false;
  };

  const finish = async (): Promise<boolean> => {
    if (!(await refresh())) {
      return false;
    }
    clearSelection();
    return true;
  };

  const withClient = (): DnfApi | null => {
    if (client === undefined) {
      reportFailure("桌面接口不可用，请重新启动应用。");
      return null;
    }
    return client;
  };

  const setEnabledFor = async (
    items: readonly WorkspaceItem[],
    enabled: boolean,
  ): Promise<boolean> => {
    const api = withClient();
    const itemsToChange = items.filter((item) => item.enabled !== enabled);
    if (api === null || itemsToChange.length === 0) {
      return false;
    }
    try {
      const request = {
        items: itemsToChange.map(installReference),
      };
      const result = enabled ? await api.enableItems(request) : await api.disableItems(request);
      if (!result.ok) {
        return reportFailure(result.error.message);
      }
      // 开关不清空选区：批量启用/停用后仍要保持多选，才能接着整体关回去。
      // 其余批量操作（移动、回收）用 finish()，那类操作完成后选区本就该失效。
      return refresh();
    } catch (error) {
      if (error instanceof Error) {
        return reportFailure(`${enabled ? "启用" : "停用"}失败，磁盘内容未被修改。`);
      }
      throw error;
    }
  };

  const dissolveGroup = async (): Promise<boolean> => {
    const api = withClient();
    const group = selectedItems[0];
    if (
      api === null ||
      group === undefined ||
      group.kind !== "group" ||
      selectedItems.length !== 1
    ) {
      return false;
    }
    try {
      const result = await api.dissolveGroup({ groupId: group.id });
      return result.ok ? finish() : reportFailure(result.error.message);
    } catch (error) {
      if (error instanceof Error) {
        return reportFailure(
          "\u89e3\u6563\u8865\u4e01\u7ec4\u5931\u8d25\uff0c\u78c1\u76d8\u5185\u5bb9\u672a\u88ab\u4fee\u6539\u3002",
        );
      }
      throw error;
    }
  };

  const renameItem = async (item: WorkspaceItem, newName: string): Promise<boolean> => {
    const api = withClient();
    if (api === null) {
      return false;
    }
    try {
      const normalizedPath = item.relativePath.replaceAll("/", "\\");
      const separatorIndex = normalizedPath.lastIndexOf("\\");
      const targetDirectoryRelativePath =
        item.kind === "group"
          ? categoryPath
          : separatorIndex < 0
            ? ""
            : normalizedPath.slice(0, separatorIndex);
      const result = await api.moveItem(
        item.kind === "patch"
          ? {
              kind: "patch",
              sourceRelativePath: item.relativePath,
              targetDirectoryRelativePath,
              newName,
            }
          : {
              kind: "group",
              groupId: item.id,
              targetDirectoryRelativePath,
              newName,
            },
      );
      return result.ok ? finish() : reportFailure(result.error.message);
    } catch (error) {
      if (error instanceof Error) {
        return reportFailure("重命名失败，磁盘内容未被修改。");
      }
      throw error;
    }
  };

  const rename = async (newName: string): Promise<boolean> => {
    const item = selectedItems[0];
    if (item === undefined || selectedItems.length !== 1) {
      return false;
    }
    return renameItem(item, newName);
  };

  const moveItems = async (
    items: readonly WorkspaceItemReference[],
    targetDirectoryRelativePath: string,
  ): Promise<boolean> => {
    const api = withClient();
    if (api === null || items.length === 0) {
      return false;
    }
    try {
      const requestItems: Array<
        | { readonly kind: "patch"; readonly sourceRelativePath: string }
        | { readonly kind: "group"; readonly groupId: string }
      > = [];
      for (const item of items) {
        if (item.kind === "patch") {
          requestItems.push({ kind: "patch", sourceRelativePath: item.relativePath });
          continue;
        }
        requestItems.push({ kind: "group", groupId: item.groupId });
      }
      const result = await api.moveItems({
        items: requestItems,
        targetDirectoryRelativePath,
      });
      return result.ok ? finish() : reportFailure(result.error.message);
    } catch (error) {
      if (error instanceof Error) {
        return reportFailure("移动失败，磁盘内容未被修改。");
      }
      throw error;
    }
  };

  const move = (targetDirectoryRelativePath: string): Promise<boolean> =>
    moveItems(selectedItems.map(workspaceItemReference), targetDirectoryRelativePath);

  const createGroup = async (groupName: string): Promise<boolean> => {
    const api = withClient();
    const patches = selectedItems.filter((item) => item.kind === "patch");
    if (api === null || patches.length < 2 || patches.length !== selectedItems.length) {
      return false;
    }
    try {
      const result = await api.createGroup({
        categoryRelativePath: categoryPath,
        patchRelativePaths: patches.map((patch) => patch.relativePath),
        groupName,
      });
      return result.ok ? finish() : reportFailure(result.error.message);
    } catch (error) {
      if (error instanceof Error) {
        return reportFailure("创建补丁组失败，磁盘内容未被修改。");
      }
      throw error;
    }
  };

  const addGroupMembers = async (
    groupId: string,
    patches: readonly WorkspaceItemReference[],
  ): Promise<boolean> => {
    const api = withClient();
    const patchRelativePaths = patches.flatMap((item) =>
      item.kind === "patch" ? [item.relativePath] : [],
    );
    if (api === null || patchRelativePaths.length === 0) return false;
    try {
      const result = await api.addGroupMembers({ groupId, patchRelativePaths });
      return result.ok ? finish() : reportFailure(result.error.message);
    } catch (error) {
      if (error instanceof Error) return reportFailure("加入补丁组失败，磁盘内容未被修改。");
      throw error;
    }
  };

  const recycle = async (): Promise<boolean> => {
    const api = withClient();
    if (api === null || selectedItems.length === 0) {
      return false;
    }
    try {
      const result = await api.recycleItems({
        items: selectedItems.map(installReference),
      });
      return result.ok ? finish() : reportFailure(result.error.message);
    } catch (error) {
      if (error instanceof Error) {
        return reportFailure("回收失败，磁盘内容未被修改。");
      }
      throw error;
    }
  };

  const deleteRecycleItems = async (entries: readonly RecycleEntryDto[]): Promise<boolean> => {
    const api = withClient();
    if (api === null || entries.length === 0) {
      return false;
    }
    try {
      const result = await api.deleteRecycleItems({
        ids: entries.map((entry) => entry.id),
      });
      if (!result.ok) {
        return reportFailure(result.error.message);
      }
      await refreshRecycle();
      return true;
    } catch (error) {
      if (error instanceof Error) {
        return reportFailure("删除失败，回收站内容未被修改。");
      }
      throw error;
    }
  };

  return {
    addGroupMembers,
    createGroup,
    dissolveGroup,
    deleteRecycleItems,
    move,
    moveItems,
    recycle,
    rename,
    renameItem,
    setEnabledFor,
  };
}

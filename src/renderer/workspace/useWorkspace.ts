import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DnfApi, RecycleEntryDto } from "../../shared/ipc-contracts";
import type { CategorySnapshot } from "../../shared/library-dto";
import { isLibraryPatchPath } from "../../shared/library-patch-extensions";
import {
  type EnabledCounts,
  type EnabledFilter,
  isRootPatch,
  itemMatches,
  type Notice,
  type WorkspaceItem,
} from "./model";
import { useCategoryCommands } from "./useCategoryCommands";

export type WorkspaceScope = "all" | "uncategorized" | "category" | "group";

type UseWorkspaceOptions = {
  readonly groupId?: string;
  readonly scope?: WorkspaceScope;
};

export function useWorkspace(
  client: DnfApi | undefined,
  { groupId, scope = "all" }: UseWorkspaceOptions = {},
) {
  const [categoryPath, setCategoryPath] = useState("");
  const [navigationSnapshot, setNavigationSnapshot] = useState<CategorySnapshot | null>(null);
  const [snapshot, setSnapshot] = useState<CategorySnapshot | null>(null);
  const [query, setQuery] = useState("");
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>("all");
  const [includeDescendants, setIncludeDescendants] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [recycleEntries, setRecycleEntries] = useState<readonly RecycleEntryDto[]>([]);
  const scanSequence = useRef(0);
  const snapshotPath = useRef<string | null>(null);

  const scan = useCallback(
    async (relativePath: string): Promise<boolean> => {
      const sequence = scanSequence.current + 1;
      scanSequence.current = sequence;
      const snapshotKey = scope === "group" ? `group:${groupId ?? ""}` : relativePath;
      const hasCurrentSnapshot = snapshotPath.current === snapshotKey;
      if (!hasCurrentSnapshot) {
        setLoading(true);
        setSnapshot(null);
      }
      const scanIncludeDescendants =
        scope === "all" || scope === "group"
          ? scope === "all"
          : scope === "uncategorized"
            ? false
            : includeDescendants;

      if (client === undefined) {
        setLoading(false);
        setNotice({ tone: "error", message: "桌面接口不可用，请重新启动应用。" });
        return false;
      }

      try {
        if (scope === "group") {
          if (groupId === undefined) {
            setNotice({ tone: "error", message: "补丁组不存在" });
            return false;
          }
          const result = await client.scanGroup({ groupId });
          if (sequence !== scanSequence.current) return false;
          if (!result.ok) {
            setNotice({ tone: "error", message: result.error.message });
            return false;
          }
          const nextSnapshot: CategorySnapshot = {
            relativePath,
            patchCount: result.value.patches.length,
            patches: result.value.patches,
            groups: [result.value.group],
            childCategories: [],
          };
          setSnapshot(nextSnapshot);
          snapshotPath.current = snapshotKey;
          setNotice(null);
          return true;
        }
        const result = await client.scan({
          includeDescendants: scanIncludeDescendants,
          relativePath,
        });
        if (sequence !== scanSequence.current) return false;
        if (result.ok) {
          setSnapshot(result.value);
          snapshotPath.current = snapshotKey;
          if (relativePath === "") {
            setNavigationSnapshot(result.value);
          }
          setNotice(null);
          return true;
        } else {
          setNotice({ tone: "error", message: result.error.message });
          return false;
        }
      } catch {
        if (sequence === scanSequence.current) {
          setNotice({ tone: "error", message: "扫描补丁库失败，磁盘内容未被修改。" });
        }
        return false;
      } finally {
        if (sequence === scanSequence.current) setLoading(false);
      }
    },
    [client, groupId, includeDescendants, scope],
  );

  const scanNavigation = useCallback(
    async (relativePath: string): Promise<boolean> => {
      if (client === undefined) {
        setNotice({ tone: "error", message: "桌面接口不可用，请重新启动应用。" });
        return false;
      }
      try {
        const result = await client.scan({ includeDescendants, relativePath });
        if (!result.ok) {
          setNotice({ tone: "error", message: result.error.message });
          return false;
        }
        setNavigationSnapshot(result.value);
        setNotice(null);
        return true;
      } catch (error) {
        if (error instanceof Error) {
          setNotice({ tone: "error", message: "刷新分类顺序失败。" });
          return false;
        }
        throw error;
      }
    },
    [client, includeDescendants],
  );

  const scanPath = scope === "category" || scope === "group" ? categoryPath : "";

  const refresh = useCallback(async (): Promise<boolean> => {
    const refreshed = await scan(scanPath);
    if (!refreshed || scanPath === "") {
      return refreshed;
    }
    return scanNavigation("");
  }, [scan, scanNavigation, scanPath]);

  // 主进程在扫描后补生成 BK2 预览属于带外改动：完成后推送事件，这里重新扫描拿新 URL。
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  useEffect(() => {
    if (client === undefined) return;
    return client.subscribeLibraryChanges(() => {
      void refreshRef.current();
    });
  }, [client]);

  useEffect(() => {
    void scan(scanPath);
  }, [scan, scanPath]);

  const items = useMemo<WorkspaceItem[]>(
    () =>
      snapshot === null
        ? []
        : scope === "group"
          ? snapshot.patches
          : scope === "uncategorized"
            ? snapshot.patches.filter(isRootPatch)
            : [...snapshot.groups, ...snapshot.patches],
    [scope, snapshot],
  );
  const enabledCounts = useMemo<EnabledCounts>(
    () => ({
      all: items.length,
      enabled: items.filter((item) => item.enabled).length,
      disabled: items.filter((item) => !item.enabled).length,
    }),
    [items],
  );
  const visibleItems = useMemo(
    () => items.filter((item) => itemMatches(item, query.trim(), enabledFilter)),
    [enabledFilter, items, query],
  );

  const importDroppedPatches = async (files: readonly File[]): Promise<void> => {
    if (client === undefined) {
      setNotice({ tone: "error", message: "桌面接口不可用，请重新启动应用。" });
      return;
    }
    if (files.some((file) => !isLibraryPatchPath(file.name))) {
      setNotice({ tone: "error", message: "只能拖入 NPK 或 BK2 补丁文件。" });
      return;
    }
    try {
      const result = await client.importDroppedPatches({
        categoryRelativePath: categoryPath,
        files,
      });
      if (!result.ok) {
        setNotice({ tone: "error", message: result.error.message });
        return;
      }
      await scan(scanPath);
    } catch (error) {
      if (error instanceof Error) {
        setNotice({ tone: "error", message: "拖入补丁失败，磁盘内容未被修改。" });
        return;
      }
      throw error;
    }
  };

  const revealPatch = async (relativePath: string): Promise<void> => {
    if (client === undefined) {
      setNotice({ tone: "error", message: "桌面接口不可用，请重新启动应用。" });
      return;
    }
    try {
      const result = await client.revealPatch({ relativePath });
      if (!result.ok) setNotice({ tone: "error", message: result.error.message });
    } catch {
      setNotice({ tone: "error", message: "打开补丁所在目录失败。" });
    }
  };

  const setCategoryOrder = async (
    parentRelativePath: string,
    orderedChildRelativePaths: readonly string[],
  ): Promise<boolean> => {
    if (client === undefined) {
      setNotice({ tone: "error", message: "桌面接口不可用，请重新启动应用。" });
      return false;
    }
    try {
      const result = await client.setCategoryOrder({
        parentRelativePath,
        orderedChildRelativePaths: [...orderedChildRelativePaths],
      });
      if (!result.ok) {
        setNotice({ tone: "error", message: result.error.message });
        return false;
      }
      return scanNavigation("");
    } catch (error) {
      if (error instanceof Error) {
        setNotice({ tone: "error", message: "保存分类顺序失败。" });
        return false;
      }
      throw error;
    }
  };

  const categoryCommands = useCategoryCommands({
    categoryPath,
    client,
    scan,
    scanNavigation,
    setCategoryPath,
    setNotice,
  });

  const refreshRecycle = useCallback(async (): Promise<boolean> => {
    if (client === undefined) {
      setNotice({ tone: "error", message: "桌面接口不可用，请重新启动应用。" });
      return false;
    }
    try {
      const result = await client.listRecycle();
      if (!result.ok) {
        setNotice({ tone: "error", message: result.error.message });
        return false;
      }
      setRecycleEntries(result.value.items);
      return true;
    } catch {
      setNotice({ tone: "error", message: "读取回收站失败。" });
      return false;
    }
  }, [client]);

  return {
    categoryPath,
    ...categoryCommands,
    enabledCounts,
    enabledFilter,
    importDroppedPatches,
    revealPatch,
    includeDescendants: scope === "all" || scope === "group" ? scope === "all" : includeDescendants,
    items,
    loading,
    navigationSnapshot,
    notice,
    query,
    recycleEntries,
    refreshRecycle,
    refresh,
    setCategoryPath,
    setCategoryOrder,
    setEnabledFilter,
    setIncludeDescendants,
    setQuery,
    showNotice: setNotice,
    visibleItems,
  };
}

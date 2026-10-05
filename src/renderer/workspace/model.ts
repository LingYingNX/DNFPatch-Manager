import type { GroupItem, PatchItem } from "../../shared/library-dto";
import { pathKey } from "../../shared/path-key";

export type WorkspaceItem = PatchItem | GroupItem;
export type WorkspaceItemReference =
  | { readonly kind: "patch"; readonly relativePath: string }
  | { readonly kind: "group"; readonly groupId: string };
export type NavigationSelection =
  | { readonly kind: "all" }
  | { readonly kind: "uncategorized" }
  | { readonly kind: "recycle" }
  | { readonly kind: "presets" }
  | { readonly kind: "community" }
  | { readonly kind: "category"; readonly relativePath: string }
  | {
      readonly kind: "group";
      readonly groupId: string;
      readonly categoryRelativePath: string;
    };
export type EnabledFilter = "all" | "enabled" | "disabled";
export type EnabledCounts = {
  readonly all: number;
  readonly enabled: number;
  readonly disabled: number;
};
export type ViewMode = "grid" | "list";
export type CardSize = "small" | "medium" | "large";
export type Notice = {
  readonly message: string;
  readonly tone: "success" | "warning" | "info" | "error";
};

export function isRootPatch(item: WorkspaceItem): item is PatchItem {
  return item.kind === "patch" && item.relativePath.split(/[\\/]/u).length === 1;
}

export function workspaceItemKey(item: WorkspaceItem): string {
  return item.kind === "group" ? `group:${item.id}` : `patch:${pathKey(item.relativePath)}`;
}

export function workspaceItemReference(item: WorkspaceItem): WorkspaceItemReference {
  return item.kind === "group"
    ? { kind: "group", groupId: item.id }
    : { kind: "patch", relativePath: item.relativePath };
}

export function itemCategoryPath(item: WorkspaceItem): string {
  return item.kind === "group"
    ? (item.categoryRelativePath ?? item.relativePath)
    : item.relativePath;
}

export function itemMatches(item: WorkspaceItem, query: string, filter: EnabledFilter): boolean {
  const matchesQuery = item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase());
  const matchesEnabled = filter === "all" || (filter === "enabled" ? item.enabled : !item.enabled);
  return matchesQuery && matchesEnabled;
}

export function itemDescription(item: WorkspaceItem): string {
  if (item.kind === "group") {
    return `${item.patchCount} 个补丁`;
  }
  if (item.size < 1024) {
    return `${item.size} B`;
  }
  if (item.size < 1024 * 1024) {
    return `${(item.size / 1024).toFixed(1)} KB`;
  }
  return `${(item.size / 1024 / 1024).toFixed(1)} MB`;
}

export function itemDate(item: WorkspaceItem): string {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(
    new Date(item.kind === "patch" ? item.modifiedAt : item.createdAt),
  );
}

export function itemType(item: WorkspaceItem): string {
  return item.kind === "patch" ? "补丁" : "补丁组";
}

export function itemLocation(item: WorkspaceItem, categoryPath: string): string | null {
  const normalizedPath = itemCategoryPath(item).replaceAll("/", "\\");
  const separatorIndex = normalizedPath.lastIndexOf("\\");
  const parentPath = separatorIndex < 0 ? "" : normalizedPath.slice(0, separatorIndex);
  const normalizedCategory = categoryPath.replaceAll("/", "\\");
  if (parentPath.toLocaleLowerCase() === normalizedCategory.toLocaleLowerCase()) return null;
  if (normalizedCategory === "") return parentPath;
  const prefix = `${normalizedCategory}\\`;
  return parentPath.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())
    ? parentPath.slice(prefix.length)
    : parentPath;
}

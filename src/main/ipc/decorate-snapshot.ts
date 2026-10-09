import type { ManagedImageAssets, ManagedImageError } from "../../core/assets/managed-image-assets";
import { libraryPreviewUrl } from "../../core/library/library-preview";
import type { InstallationState, PreviewState } from "../../core/state/schemas";
import type {
  CategorySnapshot,
  GroupItem,
  GroupSnapshot,
  PatchItem,
} from "../../shared/library-dto";
import { pathKey } from "../../shared/path-key";
import { err, ok, type Result } from "../../shared/result";

export type GroupMemberPaths = ReadonlyMap<string, readonly string[]>;

export function decorateSnapshotWithInstallation(
  snapshot: CategorySnapshot,
  state: InstallationState,
  groupMemberPaths: GroupMemberPaths = new Map(),
): CategorySnapshot {
  const enabledPaths = new Set(state.records.map((record) => record.sourceRelativePath));
  return {
    ...snapshot,
    patches: snapshot.patches.map((patch) => ({
      ...patch,
      enabled: enabledPaths.has(patch.relativePath),
    })),
    groups: snapshot.groups.map((group) => {
      const members = groupMemberPaths.get(group.id) ?? [];
      const enabledCount = members.filter((member) =>
        [...enabledPaths].some((enabled) => pathKey(enabled) === pathKey(member)),
      ).length;
      return { ...group, enabled: members.length > 0 && enabledCount === members.length };
    }),
  };
}

export function decorateGroupSnapshotWithInstallation(
  snapshot: GroupSnapshot,
  state: InstallationState,
): GroupSnapshot {
  const enabledPaths = new Set(state.records.map((record) => record.sourceRelativePath));
  const patches = snapshot.patches.map((patch) => ({
    ...patch,
    enabled: enabledPaths.has(patch.relativePath),
  }));
  return {
    ...snapshot,
    patches,
    group: {
      ...snapshot.group,
      enabled: patches.length > 0 && patches.every((patch) => patch.enabled),
    },
  };
}

export function decorateSnapshotWithPreviews(
  snapshot: CategorySnapshot,
  state: PreviewState,
  assets: ManagedImageAssets,
): Result<CategorySnapshot, ManagedImageError> {
  const patches: PatchItem[] = [];
  for (const patch of snapshot.patches) {
    patches.push({
      ...patch,
      previewUrl:
        patch.previewRelativePath === null
          ? null
          : (patch.previewUrl ?? libraryPreviewUrl(patch.previewRelativePath)),
      videoPreviewUrl: patch.videoPreviewUrl ?? null,
    });
  }
  const groups: GroupItem[] = [];
  for (const group of snapshot.groups) {
    const binding = state.bindings.find(
      (candidate) =>
        candidate.state === "active" &&
        candidate.kind === "group" &&
        "groupId" in candidate &&
        candidate.groupId === group.id,
    );
    if (binding !== undefined) {
      const url = assets.url(binding.assetName);
      if (!url.ok) return err(url.error);
      groups.push({ ...group, previewUrl: url.value });
      continue;
    }
    groups.push({
      ...group,
      previewUrl:
        group.previewRelativePath === null
          ? null
          : (group.previewUrl ?? libraryPreviewUrl(group.previewRelativePath)),
    });
  }
  return ok({
    ...snapshot,
    patches,
    groups,
  });
}

export function decorateGroupSnapshotWithPreviews(
  snapshot: GroupSnapshot,
  state: PreviewState,
  assets: ManagedImageAssets,
): Result<GroupSnapshot, ManagedImageError> {
  const decorated = decorateSnapshotWithPreviews(
    {
      relativePath: snapshot.group.categoryRelativePath ?? snapshot.group.relativePath,
      patchCount: snapshot.patches.length,
      patches: snapshot.patches,
      groups: [snapshot.group],
      childCategories: [],
    },
    state,
    assets,
  );
  if (!decorated.ok) return decorated;
  const group = decorated.value.groups[0] ?? snapshot.group;
  return ok({
    group,
    patches: decorated.value.patches,
  });
}

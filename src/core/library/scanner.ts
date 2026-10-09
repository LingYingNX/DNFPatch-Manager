import { readdir, stat } from "node:fs/promises";
import { win32 } from "node:path";
import type { LibraryRoot } from "../../main/app-paths";
import type {
  CategorySnapshot,
  ChildCategory,
  GroupItem,
  GroupSnapshot,
  PatchItem,
} from "../../shared/library-dto";
import { isLibraryPatchPath, isVideoPatchPath } from "../../shared/library-patch-extensions";
import { pathKey } from "../../shared/path-key";
import { err, ok, type Result } from "../../shared/result";
import type { VirtualGroupService, VirtualGroupServiceError } from "../groups/group-service";
import type { VirtualGroup } from "../groups/group-state";
import { type LibraryPathError, resolveLibraryPath } from "../paths/library-path";
import { readGroupMarker } from "./group-marker";
import { findMatchingPreview, libraryPreviewUrl } from "./library-preview";

export type LibraryScanError =
  | LibraryPathError
  | VirtualGroupServiceError
  | { readonly code: "SCAN_IO"; readonly relativePath: string };

export type ScanCategoryOptions = {
  readonly includeDescendants?: boolean;
  readonly savedOrders?: Readonly<Record<string, readonly string[]>>;
  readonly groups?: VirtualGroupService;
};

function byName<T extends { readonly name: string }>(left: T, right: T): number {
  return left.name.localeCompare(right.name, "zh-CN");
}

function byRelativePath<T extends { readonly relativePath: string }>(left: T, right: T): number {
  return left.relativePath.localeCompare(right.relativePath, "zh-CN");
}

function orderCategories(
  categories: readonly ChildCategory[],
  savedOrder: readonly string[],
): ChildCategory[] {
  const positions = new Map(savedOrder.map((path, index) => [path, index]));
  return [...categories].sort((left, right) => {
    const leftPosition = positions.get(left.relativePath);
    const rightPosition = positions.get(right.relativePath);
    if (leftPosition !== undefined && rightPosition !== undefined) {
      return leftPosition - rightPosition;
    }
    if (leftPosition !== undefined) {
      return -1;
    }
    if (rightPosition !== undefined) {
      return 1;
    }
    return byName(left, right);
  });
}

/** Finds the hover-playback MP4 generated for a BK2 patch, matching it by file stem. */
function findVideoPreview(fileNames: readonly string[], patchName: string): string | null {
  const expected = `${win32.basename(patchName, win32.extname(patchName))}.mp4`.toLocaleLowerCase();
  return fileNames.find((name) => name.toLocaleLowerCase() === expected) ?? null;
}
async function scanPatchFiles(
  directory: string,
  relativePath: string,
  fileNames: readonly string[],
  excludedRelativePaths: ReadonlySet<string> = new Set(),
  includedFileNames: ReadonlySet<string> | undefined = undefined,
): Promise<PatchItem[]> {
  const patchNames = fileNames.filter(
    (name) =>
      isLibraryPatchPath(name) &&
      (includedFileNames === undefined || includedFileNames.has(pathKey(name))) &&
      !excludedRelativePaths.has(pathKey(win32.join(relativePath, name))),
  );
  return Promise.all(
    patchNames.map(async (name): Promise<PatchItem> => {
      const metadata = await stat(win32.join(directory, name));
      const preview = findMatchingPreview(fileNames, win32.basename(name, win32.extname(name)));
      const previewRelativePath = preview === null ? null : win32.join(relativePath, preview);
      const previewMetadata =
        preview === null ? null : await stat(win32.join(directory, preview), { bigint: true });

      const videoName = isVideoPatchPath(name) ? findVideoPreview(fileNames, name) : null;
      // The hover MP4 sits in the same directory as its BK2 patch.
      const videoRelativePath = videoName === null ? null : win32.join(relativePath, videoName);
      const videoMetadata =
        videoName === null
          ? null
          : await stat(win32.join(directory, videoName), { bigint: true }).catch(() => null);

      return {
        kind: "patch",
        name,
        relativePath: win32.join(relativePath, name),
        previewRelativePath,
        previewUrl:
          previewRelativePath === null || previewMetadata === null
            ? null
            : libraryPreviewUrl(previewRelativePath, previewMetadata.mtimeNs),
        videoPreviewUrl:
          videoRelativePath === null || videoMetadata === null
            ? null
            : libraryPreviewUrl(videoRelativePath, videoMetadata.mtimeNs),
        size: metadata.size,
        modifiedAt: metadata.mtime.toISOString(),
        enabled: false,
      };
    }),
  );
}

function virtualGroupItem(group: VirtualGroup, patchCount: number): GroupItem {
  return {
    kind: "group",
    id: group.id,
    name: group.name,
    categoryRelativePath: group.categoryRelativePath,
    relativePath: group.categoryRelativePath,
    previewRelativePath: null,
    previewUrl: null,
    patchCount,
    createdAt: group.createdAt,
    enabled: false,
  };
}

async function virtualGroupsForCategory(
  relativePath: string,
  groups: VirtualGroupService | undefined,
): Promise<Result<readonly VirtualGroup[], LibraryScanError>> {
  if (groups === undefined) return ok([]);
  const state = await groups.list();
  if (!state.ok) return state;
  const categoryKey = pathKey(relativePath);
  return ok(
    state.value.groups.filter((group) => pathKey(group.categoryRelativePath) === categoryKey),
  );
}

async function scanGroupItem(
  directory: string,
  relativePath: string,
  marker: Awaited<ReturnType<typeof readGroupMarker>>,
): Promise<GroupItem> {
  if (marker === null) {
    throw new Error("Group marker is required");
  }
  const groupEntries = await readdir(directory, { withFileTypes: true });
  const groupFileNames = groupEntries
    .filter((candidate) => candidate.isFile())
    .map((candidate) => candidate.name);
  const groupPreview = findMatchingPreview(groupFileNames, marker.displayName);
  const patchCount = groupEntries.filter(
    (candidate) => candidate.isFile() && isLibraryPatchPath(candidate.name),
  ).length;
  return {
    kind: "group",
    id: marker.id,
    name: marker.displayName,
    relativePath,
    previewRelativePath: groupPreview === null ? null : win32.join(relativePath, groupPreview),
    previewUrl: null,
    patchCount,
    createdAt: marker.createdAt,
    enabled: false,
  };
}

type DescendantItems = {
  readonly patches: readonly PatchItem[];
  readonly groups: readonly GroupItem[];
  readonly patchCount: number;
};

export async function scanCategory(
  libraryRoot: LibraryRoot,
  relativePath: string,
  options: ScanCategoryOptions = {},
): Promise<Result<CategorySnapshot, LibraryScanError>> {
  const includeDescendants = options.includeDescendants ?? false;
  const savedOrders = options.savedOrders ?? {};
  const categoryPath = resolveLibraryPath(libraryRoot, relativePath);
  if (!categoryPath.ok) {
    return categoryPath;
  }

  try {
    const entries = await readdir(categoryPath.value, { withFileTypes: true });
    const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    const virtualGroups = await virtualGroupsForCategory(relativePath, options.groups);
    if (!virtualGroups.ok) return virtualGroups;
    const groupedMembers = new Set(
      virtualGroups.value.flatMap((group) =>
        group.memberRelativePaths.map((member) => pathKey(member)),
      ),
    );
    const patches = await scanPatchFiles(
      categoryPath.value,
      relativePath,
      fileNames,
      groupedMembers,
    );

    const groups: GroupItem[] = [];
    let virtualGroupPatchCount = 0;
    groups.push(
      ...virtualGroups.value.map((group) => {
        const patchCount = group.memberRelativePaths.filter((member) =>
          fileNames.some(
            (fileName) => pathKey(win32.join(relativePath, fileName)) === pathKey(member),
          ),
        ).length;
        virtualGroupPatchCount += patchCount;
        return virtualGroupItem(group, patchCount);
      }),
    );
    const childCategories: ChildCategory[] = [];
    let groupedPatchCount = 0;
    for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
      const directory = win32.join(categoryPath.value, entry.name);
      const marker = await readGroupMarker(directory);
      const entryRelativePath = win32.join(relativePath, entry.name);
      if (marker === null) {
        const child = await scanCategoryTree(
          libraryRoot,
          entryRelativePath,
          savedOrders,
          options.groups,
        );
        if (!child.ok) return child;
        childCategories.push(child.value);
      } else {
        const group = await scanGroupItem(directory, entryRelativePath, marker);
        groupedPatchCount += group.patchCount;
        groups.push(group);
      }
    }

    const descendantItems: Result<DescendantItems, LibraryScanError> = includeDescendants
      ? await scanDescendantItems(libraryRoot, childCategories, options.groups)
      : ok({ patches: [], groups: [], patchCount: 0 });
    if (!descendantItems.ok) return descendantItems;

    return ok({
      relativePath,
      patchCount:
        patches.length +
        virtualGroupPatchCount +
        groupedPatchCount +
        descendantItems.value.patchCount,
      patches: includeDescendants
        ? [...patches, ...descendantItems.value.patches].sort(byRelativePath)
        : patches.sort(byName),
      groups: includeDescendants
        ? [...groups, ...descendantItems.value.groups].sort(byName)
        : groups.sort(byName),
      childCategories: orderCategories(childCategories, savedOrders[relativePath] ?? []),
    });
  } catch (error) {
    if (error instanceof Error) {
      return err({ code: "SCAN_IO", relativePath });
    }
    throw error;
  }
}

export async function scanGroup(
  libraryRoot: LibraryRoot,
  groupId: string,
  options: { readonly groups: VirtualGroupService },
): Promise<Result<GroupSnapshot, LibraryScanError>> {
  const group = await options.groups.get(groupId);
  if (!group.ok) return group;
  const category = resolveLibraryPath(libraryRoot, group.value.categoryRelativePath);
  if (!category.ok) return category;

  try {
    const entries = await readdir(category.value, { withFileTypes: true });
    const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    const memberNames = group.value.memberRelativePaths
      .filter((member) =>
        fileNames.some(
          (fileName) =>
            pathKey(win32.join(group.value.categoryRelativePath, fileName)) === pathKey(member),
        ),
      )
      .map((member) => win32.basename(member))
      .filter(isLibraryPatchPath)
      .sort((left, right) => left.localeCompare(right, "zh-CN"));
    const patches = await scanPatchFiles(
      category.value,
      group.value.categoryRelativePath,
      fileNames,
      new Set(),
      new Set(memberNames.map(pathKey)),
    );
    return ok({
      group: virtualGroupItem(group.value, patches.length),
      patches,
    });
  } catch (error) {
    if (error instanceof Error) {
      return err({ code: "SCAN_IO", relativePath: group.value.categoryRelativePath });
    }
    throw error;
  }
}

async function scanDescendantItems(
  libraryRoot: LibraryRoot,
  categories: readonly ChildCategory[],
  groupService?: VirtualGroupService,
): Promise<Result<DescendantItems, LibraryScanError>> {
  const patches: PatchItem[] = [];
  const groupItems: GroupItem[] = [];
  let patchCount = 0;
  for (const category of categories) {
    const categoryPath = resolveLibraryPath(libraryRoot, category.relativePath);
    if (!categoryPath.ok) return categoryPath;
    try {
      const entries = await readdir(categoryPath.value, { withFileTypes: true });
      const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
      const virtualGroups = await virtualGroupsForCategory(category.relativePath, groupService);
      if (!virtualGroups.ok) return virtualGroups;
      const groupedMembers = new Set(
        virtualGroups.value.flatMap((group) =>
          group.memberRelativePaths.map((member) => pathKey(member)),
        ),
      );
      const categoryPatches = await scanPatchFiles(
        categoryPath.value,
        category.relativePath,
        fileNames,
        groupedMembers,
      );
      patches.push(...categoryPatches);
      patchCount += categoryPatches.length;
      for (const group of virtualGroups.value) {
        const count = group.memberRelativePaths.filter((member) =>
          fileNames.some(
            (fileName) => pathKey(win32.join(category.relativePath, fileName)) === pathKey(member),
          ),
        ).length;
        const item = virtualGroupItem(group, count);
        groupItems.push(item);
        patchCount += count;
      }
      for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
        const marker = await readGroupMarker(win32.join(categoryPath.value, entry.name));
        if (marker === null) continue;
        const group = await scanGroupItem(
          win32.join(categoryPath.value, entry.name),
          win32.join(category.relativePath, entry.name),
          marker,
        );
        groupItems.push(group);
        patchCount += group.patchCount;
      }
    } catch (error) {
      if (error instanceof Error) {
        return err({ code: "SCAN_IO", relativePath: category.relativePath });
      }
      throw error;
    }
    const nested = await scanDescendantItems(libraryRoot, category.childCategories, groupService);
    if (!nested.ok) return nested;
    patches.push(...nested.value.patches);
    groupItems.push(...nested.value.groups);
    patchCount += nested.value.patchCount;
  }
  return ok({ patches, groups: groupItems, patchCount });
}

async function scanCategoryTree(
  libraryRoot: LibraryRoot,
  relativePath: string,
  savedOrders: Readonly<Record<string, readonly string[]>>,
  groups?: VirtualGroupService,
): Promise<Result<ChildCategory, LibraryScanError>> {
  const categoryPath = resolveLibraryPath(libraryRoot, relativePath);
  if (!categoryPath.ok) return categoryPath;
  try {
    const entries = await readdir(categoryPath.value, { withFileTypes: true });
    const virtualGroups = await virtualGroupsForCategory(relativePath, groups);
    if (!virtualGroups.ok) return virtualGroups;
    const groupedMembers = new Set(
      virtualGroups.value.flatMap((group) =>
        group.memberRelativePaths.map((member) => pathKey(member)),
      ),
    );
    const children: ChildCategory[] = [];
    let groupedPatchCount = 0;
    for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
      const directory = win32.join(categoryPath.value, entry.name);
      if ((await readGroupMarker(directory)) !== null) {
        const groupEntries = await readdir(directory, { withFileTypes: true });
        groupedPatchCount += groupEntries.filter(
          (candidate) => candidate.isFile() && isLibraryPatchPath(candidate.name),
        ).length;
        continue;
      }
      const child = await scanCategoryTree(
        libraryRoot,
        win32.join(relativePath, entry.name),
        savedOrders,
        groups,
      );
      if (!child.ok) return child;
      children.push(child.value);
    }
    return ok({
      name: win32.basename(relativePath),
      relativePath,
      patchCount:
        entries.filter(
          (entry) =>
            entry.isFile() &&
            isLibraryPatchPath(entry.name) &&
            !groupedMembers.has(pathKey(win32.join(relativePath, entry.name))),
        ).length +
        virtualGroups.value.length +
        groupedPatchCount,
      childCategories: orderCategories(children, savedOrders[relativePath] ?? []),
    });
  } catch (error) {
    if (error instanceof Error) return err({ code: "SCAN_IO", relativePath });
    throw error;
  }
}

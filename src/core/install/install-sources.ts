import { lstat } from "node:fs/promises";
import { win32 } from "node:path";
import type { LibraryRoot } from "../../main/app-paths";
import { isLibraryPatchPath } from "../../shared/library-patch-extensions";
import { err, ok, type Result } from "../../shared/result";
import { isNotFoundError } from "../filesystem/path-exists";
import type { VirtualGroupService, VirtualGroupServiceError } from "../groups/group-service";
import { type LibraryPathError, resolveLibraryPath } from "../paths/library-path";

export type InstallSource = {
  readonly name: string;
  readonly sourcePath: string;
  readonly sourceRelativePath: string;
};

export type InstallSourceError =
  | LibraryPathError
  | VirtualGroupServiceError
  | { readonly code: "SOURCE_TYPE_MISMATCH"; readonly relativePath: string }
  | { readonly code: "SOURCE_EMPTY"; readonly relativePath: string }
  | { readonly code: "GROUP_SERVICE_REQUIRED" }
  | { readonly code: "SOURCE_IO" };

export type InstallItemReference =
  | { readonly kind: "patch"; readonly relativePath: string }
  | { readonly kind: "group"; readonly groupId: string };

export async function resolveInstallSources(
  libraryRoot: LibraryRoot,
  item: InstallItemReference,
  groups?: VirtualGroupService,
): Promise<Result<readonly InstallSource[], InstallSourceError>> {
  if (item.kind === "group") {
    if (groups === undefined) return err({ code: "GROUP_SERVICE_REQUIRED" });
    const group = await groups.get(item.groupId);
    if (!group.ok) return group;
    const sources: InstallSource[] = [];
    for (const relativePath of group.value.memberRelativePaths) {
      const source = resolveLibraryPath(libraryRoot, relativePath);
      if (!source.ok) return source;
      try {
        const metadata = await lstat(source.value);
        if (!metadata.isFile() || !isLibraryPatchPath(relativePath)) {
          continue;
        }
        sources.push({
          name: win32.basename(relativePath),
          sourcePath: source.value,
          sourceRelativePath: relativePath,
        });
      } catch (error) {
        if (isNotFoundError(error)) continue;
        throw error;
      }
    }
    sources.sort(
      (left, right) =>
        left.name.localeCompare(right.name, "zh-CN") ||
        left.sourceRelativePath.localeCompare(right.sourceRelativePath, "zh-CN"),
    );
    return sources.length === 0
      ? err({ code: "SOURCE_EMPTY", relativePath: item.groupId })
      : ok(sources);
  }

  return resolvePatchSource(libraryRoot, item.relativePath);
}

export async function resolveInstallMemberPaths(
  item: InstallItemReference,
  groups?: VirtualGroupService,
): Promise<Result<readonly string[], InstallSourceError>> {
  if (item.kind === "patch") return ok([item.relativePath]);
  if (groups === undefined) return err({ code: "GROUP_SERVICE_REQUIRED" });
  const group = await groups.get(item.groupId);
  return group.ok ? ok(group.value.memberRelativePaths) : group;
}

async function resolvePatchSource(
  libraryRoot: LibraryRoot,
  relativePath: string,
): Promise<Result<readonly InstallSource[], InstallSourceError>> {
  const source = resolveLibraryPath(libraryRoot, relativePath);
  if (!source.ok) return source;

  try {
    const metadata = await lstat(source.value);
    if (!metadata.isFile() || !isLibraryPatchPath(source.value)) {
      return err({ code: "SOURCE_TYPE_MISMATCH", relativePath });
    }
    return ok([
      {
        name: win32.basename(relativePath),
        sourcePath: source.value,
        sourceRelativePath: relativePath,
      },
    ]);
  } catch (error) {
    if (isNotFoundError(error) || error instanceof Error) return err({ code: "SOURCE_IO" });
    throw error;
  }
}

import type { Dirent } from "node:fs";
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { win32 } from "node:path";
import type { LibraryRoot } from "../../main/app-paths";
import { isLibraryPatchPath } from "../../shared/library-patch-extensions";
import { pathKey } from "../../shared/path-key";
import { err, ok, type Result } from "../../shared/result";
import type { FileTransactionError, FileTransactionStep } from "../filesystem/file-transaction";
import { executeFileTransaction } from "../filesystem/file-transaction";
import { pathExists } from "../filesystem/path-exists";
import { type GroupMarker, readGroupMarker } from "../library/group-marker";
import { findMatchingPreview, LIBRARY_PREVIEW_EXTENSIONS } from "../library/library-preview";
import type { LibraryPathError } from "../paths/library-path";
import type { PreviewService, PreviewServiceError } from "../previews/preview-service";
import type { VirtualGroupService, VirtualGroupServiceError } from "./group-service";

type LegacyGroupFile = {
  readonly sourcePath: string;
  readonly sourceRelativePath: string;
  readonly targetPath: string;
  readonly targetRelativePath: string;
};

type LegacyGroup = {
  readonly categoryRelativePath: string;
  readonly directoryPath: string;
  readonly directoryRelativePath: string;
  readonly marker: GroupMarker;
  readonly markerContents: string;
  readonly markerPath: string;
  readonly memberFiles: readonly LegacyGroupFile[];
  readonly previewContents: Buffer | null;
  readonly previewPath: string | null;
  readonly previewRelativePath: string | null;
};

export type LegacyGroupMigrationError =
  | FileTransactionError
  | LibraryPathError
  | PreviewServiceError
  | VirtualGroupServiceError
  | { readonly code: "LEGACY_GROUP_CONFLICT"; readonly relativePath: string }
  | { readonly code: "LEGACY_GROUP_INVALID"; readonly relativePath: string }
  | { readonly code: "LEGACY_GROUP_IO"; readonly relativePath: string };

async function discoverLegacyGroups(
  libraryRoot: LibraryRoot,
): Promise<Result<readonly LegacyGroup[], LegacyGroupMigrationError>> {
  const groups: LegacyGroup[] = [];

  const visit = async (
    directoryPath: string,
    directoryRelativePath: string,
  ): Promise<Result<void, LegacyGroupMigrationError>> => {
    let entries: Dirent[];
    try {
      entries = await readdir(directoryPath, { withFileTypes: true });
    } catch {
      return err({
        code: "LEGACY_GROUP_IO",
        relativePath: directoryRelativePath,
      });
    }

    for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
      const childDirectoryPath = win32.join(directoryPath, entry.name);
      const childRelativePath = win32.join(directoryRelativePath, entry.name);
      let marker: GroupMarker | null;
      try {
        marker = await readGroupMarker(childDirectoryPath);
      } catch {
        return err({ code: "LEGACY_GROUP_IO", relativePath: childRelativePath });
      }
      if (marker !== null) {
        const prepared = await prepareLegacyGroup(
          childDirectoryPath,
          childRelativePath,
          directoryRelativePath,
          marker,
        );
        if (!prepared.ok) return prepared;
        groups.push(prepared.value);
        continue;
      }
      const nested = await visit(childDirectoryPath, childRelativePath);
      if (!nested.ok) return nested;
    }
    return ok(undefined);
  };

  const root = await visit(libraryRoot, "");
  return root.ok ? ok(groups) : root;
}

async function prepareLegacyGroup(
  directoryPath: string,
  directoryRelativePath: string,
  categoryRelativePath: string,
  marker: GroupMarker,
): Promise<Result<LegacyGroup, LegacyGroupMigrationError>> {
  const markerPath = win32.join(directoryPath, ".dnf-group.json");
  try {
    const [entries, markerContents] = await Promise.all([
      readdir(directoryPath, { withFileTypes: true }),
      readFile(markerPath, "utf8"),
    ]);
    const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    const memberNames = fileNames.filter(isLibraryPatchPath);
    if (memberNames.length < 2) {
      return err({ code: "LEGACY_GROUP_INVALID", relativePath: directoryRelativePath });
    }
    const previewName = findMatchingPreview(fileNames, marker.displayName);
    const allowedNames = new Set([".dnf-group.json", ...memberNames]);
    if (previewName !== null) allowedNames.add(previewName);
    if (fileNames.some((name) => !allowedNames.has(name))) {
      return err({ code: "LEGACY_GROUP_INVALID", relativePath: directoryRelativePath });
    }

    const memberFiles: LegacyGroupFile[] = [];
    for (const name of memberNames) {
      const sourceRelativePath = win32.join(directoryRelativePath, name);
      const targetRelativePath = win32.join(categoryRelativePath, name);
      const sourcePath = win32.join(directoryPath, name);
      const metadata = await lstat(sourcePath);
      if (!metadata.isFile() || !isLibraryPatchPath(name)) {
        return err({ code: "LEGACY_GROUP_INVALID", relativePath: sourceRelativePath });
      }
      const targetPath = win32.join(win32.dirname(directoryPath), name);
      if (await pathExists(targetPath)) {
        return err({ code: "LEGACY_GROUP_CONFLICT", relativePath: targetRelativePath });
      }
      memberFiles.push({
        sourcePath,
        sourceRelativePath,
        targetPath,
        targetRelativePath,
      });
    }

    let previewPath: string | null = null;
    let previewRelativePath: string | null = null;
    let previewContents: Buffer | null = null;
    if (previewName !== null) {
      const extension = win32.extname(previewName).toLocaleLowerCase();
      if (!LIBRARY_PREVIEW_EXTENSIONS.has(extension)) {
        return err({ code: "LEGACY_GROUP_INVALID", relativePath: directoryRelativePath });
      }
      previewPath = win32.join(directoryPath, previewName);
      previewRelativePath = win32.join(directoryRelativePath, previewName);
      previewContents = await readFile(previewPath);
    }

    return ok({
      categoryRelativePath,
      directoryPath,
      directoryRelativePath,
      marker,
      markerContents,
      markerPath,
      memberFiles,
      previewContents,
      previewPath,
      previewRelativePath,
    });
  } catch (error) {
    if (error instanceof Error) {
      return err({ code: "LEGACY_GROUP_IO", relativePath: directoryRelativePath });
    }
    throw error;
  }
}

export async function migrateLegacyGroups(options: {
  readonly groups: VirtualGroupService;
  readonly libraryRoot: LibraryRoot;
  readonly previews: PreviewService;
}): Promise<Result<{ readonly migratedCount: number }, LegacyGroupMigrationError>> {
  const discovered = await discoverLegacyGroups(options.libraryRoot);
  if (!discovered.ok) return discovered;
  if (discovered.value.length === 0) return ok({ migratedCount: 0 });

  const state = await options.groups.list();
  if (!state.ok) return state;
  const knownMembers = new Set(
    state.value.groups.flatMap((group) => group.memberRelativePaths.map(pathKey)),
  );
  const knownIds = new Set(state.value.groups.map((group) => group.id));
  const targetMembers = new Set<string>();
  const steps: FileTransactionStep[] = [];

  for (const group of discovered.value) {
    if (knownIds.has(group.marker.id)) {
      return err({ code: "LEGACY_GROUP_CONFLICT", relativePath: group.directoryRelativePath });
    }
    const memberPaths = group.memberFiles.map((member) => pathKey(member.targetRelativePath));
    if (memberPaths.some((path) => knownMembers.has(path) || targetMembers.has(path))) {
      return err({ code: "LEGACY_GROUP_CONFLICT", relativePath: group.directoryRelativePath });
    }
    memberPaths.forEach((path) => {
      targetMembers.add(path);
    });

    for (const member of group.memberFiles) {
      steps.push({
        apply: () => rename(member.sourcePath, member.targetPath),
        compensate: () => rename(member.targetPath, member.sourcePath),
        label: `migrate ${member.sourceRelativePath}`,
        paths: [member.sourcePath, member.targetPath],
      });
    }

    steps.push({
      apply: async () => {
        const created = await options.groups.create({
          categoryRelativePath: group.categoryRelativePath,
          createdAt: group.marker.createdAt,
          id: group.marker.id,
          memberRelativePaths: group.memberFiles.map((member) => member.targetRelativePath),
          name: group.marker.displayName,
        });
        if (!created.ok) throw new Error(`Unable to import group ${group.marker.id}`);
      },
      compensate: async () => {
        const removed = await options.groups.dissolve(group.marker.id);
        if (!removed.ok && removed.error.code !== "GROUP_NOT_FOUND") {
          throw new Error(`Unable to roll back group ${group.marker.id}`);
        }
      },
      label: `write group ${group.marker.id}`,
    });

    if (group.previewPath !== null) {
      const previewPlan = await options.previews.prepareImportGroupPreview({
        groupId: group.marker.id,
        legacyRelativePath: group.directoryRelativePath,
        sourcePath: group.previewPath,
      });
      if (!previewPlan.ok) return previewPlan;
      steps.push(...previewPlan.value.steps);
    }

    steps.push({
      apply: () => rm(group.markerPath),
      compensate: () => writeFile(group.markerPath, group.markerContents, { flag: "wx" }),
      label: `remove marker ${group.directoryRelativePath}`,
      paths: [group.markerPath],
    });
    if (group.previewPath !== null && group.previewContents !== null) {
      steps.push({
        apply: () => rm(group.previewPath as string),
        compensate: () =>
          writeFile(group.previewPath as string, group.previewContents as Buffer, { flag: "wx" }),
        label: `remove preview ${group.previewRelativePath}`,
        paths: [group.previewPath],
      });
    }
    steps.push({
      apply: () => rm(group.directoryPath, { recursive: true }),
      compensate: () => mkdir(group.directoryPath),
      label: `remove legacy group ${group.directoryRelativePath}`,
      paths: [group.directoryPath],
    });
  }

  const previewMigration = await options.previews.prepareMigrateLegacyGroupBindings(
    discovered.value.map((group) => ({
      groupId: group.marker.id,
      legacyRelativePath: group.directoryRelativePath,
    })),
  );
  if (!previewMigration.ok) return previewMigration;
  steps.push(...previewMigration.value.steps);

  const transaction = await executeFileTransaction(steps);
  return transaction.ok ? ok({ migratedCount: discovered.value.length }) : transaction;
}

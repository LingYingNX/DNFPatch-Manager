import { lstat, readdir, rename } from "node:fs/promises";
import { win32 } from "node:path";
import type { DataRoot, LibraryRoot } from "../../main/app-paths";
import { isLibraryPatchPath } from "../../shared/library-patch-extensions";
import { pathKey } from "../../shared/path-key";
import { err, ok, type Result } from "../../shared/result";
import type { FileTransactionError, FileTransactionStep } from "../filesystem/file-transaction";
import { executeFileTransaction } from "../filesystem/file-transaction";
import { pathExists } from "../filesystem/path-exists";
import {
  createVirtualGroupService,
  type GroupRelocation,
  type VirtualGroupService,
  type VirtualGroupServiceError,
} from "../groups/group-service";
import { type LibraryPathError, resolveLibraryPath } from "../paths/library-path";
import { LibraryItemNameSchema } from "./library-item-name";
import { findMatchingMediaPreviews } from "./library-preview";

type MovePath = (source: string, target: string) => Promise<void>;

type MoveLibraryItemBaseRequest = {
  readonly libraryRoot: LibraryRoot;
  readonly targetDirectoryRelativePath: string;
  readonly newName?: string | undefined;
};

export type MoveLibraryPatchRequest = MoveLibraryItemBaseRequest & {
  readonly kind: "patch";
  readonly sourceRelativePath: string;
};

export type MoveLibraryGroupRequest = MoveLibraryItemBaseRequest & {
  readonly kind: "group";
  readonly groupId: string;
};

export type MoveLibraryItemRequest = MoveLibraryPatchRequest | MoveLibraryGroupRequest;

export type MoveLibraryItemError =
  | LibraryPathError
  | FileTransactionError
  | VirtualGroupServiceError
  | { readonly code: "INVALID_ITEM_NAME" }
  | { readonly code: "SOURCE_TYPE_MISMATCH"; readonly relativePath: string }
  | { readonly code: "INVALID_TARGET_DIRECTORY"; readonly relativePath: string }
  | { readonly code: "TARGET_CONFLICT"; readonly relativePath: string }
  | { readonly code: "LIBRARY_IO" };

export type GroupStateUpdate = {
  readonly memberRelativePathsToRemove: readonly string[];
  readonly relocations: readonly GroupRelocation[];
};

export type MoveLibraryItemPlan = {
  readonly relativePath: string;
  readonly fileSourceRelativePaths: readonly string[];
  readonly fileTargetRelativePaths: readonly string[];
  readonly groupStateUpdate: GroupStateUpdate;
  readonly steps: readonly FileTransactionStep[];
};

export type MoveLibraryItemOverrides = {
  readonly dataRoot?: DataRoot;
  readonly deferGroupState?: boolean;
  readonly groups?: VirtualGroupService;
  readonly movePath?: MovePath;
};

function isSamePath(left: string, right: string): boolean {
  return pathKey(left) === pathKey(right);
}

function groupsFor(
  request: MoveLibraryItemRequest,
  overrides: MoveLibraryItemOverrides,
): VirtualGroupService {
  return (
    overrides.groups ??
    createVirtualGroupService({
      dataRoot:
        overrides.dataRoot ?? (win32.join(win32.dirname(request.libraryRoot), "data") as DataRoot),
      libraryRoot: request.libraryRoot,
    })
  );
}

async function preparePatchPreviewMove(options: {
  readonly libraryRoot: LibraryRoot;
  readonly source: string;
  readonly sourceRelativePath: string;
  readonly targetRelativePath: string;
}): Promise<
  Result<readonly { readonly source: string; readonly target: string }[], MoveLibraryItemError>
> {
  const sourceDirectory = win32.dirname(options.source);
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  // 同名媒体可能是多份（静态封面 + MP4 播放素材），必须一起搬走；
  // 只搬封面会让 MP4 留在原目录，跟着一个已经不在那里的补丁。
  const previewNames = findMatchingMediaPreviews(
    entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
    win32.basename(options.sourceRelativePath, win32.extname(options.sourceRelativePath)),
  );
  const targetBaseName = win32.basename(
    options.targetRelativePath,
    win32.extname(options.targetRelativePath),
  );
  const moves: { readonly source: string; readonly target: string }[] = [];
  for (const previewName of previewNames) {
    const targetPreviewName = `${targetBaseName}${win32.extname(previewName)}`;
    const targetPreviewRelativePath = win32.join(
      win32.dirname(options.targetRelativePath),
      targetPreviewName,
    );
    const targetPreview = resolveLibraryPath(options.libraryRoot, targetPreviewRelativePath);
    if (!targetPreview.ok) return targetPreview;
    const sourcePreview = win32.join(sourceDirectory, previewName);
    if (isSamePath(sourcePreview, targetPreview.value)) continue;
    if (await pathExists(targetPreview.value)) {
      return err({ code: "TARGET_CONFLICT", relativePath: targetPreviewRelativePath });
    }
    moves.push({ source: sourcePreview, target: targetPreview.value });
  }
  return ok(moves);
}

export async function moveLibraryItem(
  request: MoveLibraryItemRequest,
  overrides: MoveLibraryItemOverrides = {},
): Promise<Result<{ readonly relativePath: string }, MoveLibraryItemError>> {
  const planned = await prepareMoveLibraryItem(request, overrides);
  if (!planned.ok) return planned;
  const transaction = await executeFileTransaction(planned.value.steps);
  return transaction.ok ? ok({ relativePath: planned.value.relativePath }) : transaction;
}

export async function prepareMoveLibraryItem(
  request: MoveLibraryItemRequest,
  overrides: MoveLibraryItemOverrides = {},
): Promise<Result<MoveLibraryItemPlan, MoveLibraryItemError>> {
  const targetDirectory = resolveLibraryPath(
    request.libraryRoot,
    request.targetDirectoryRelativePath,
  );
  if (!targetDirectory.ok) return targetDirectory;

  try {
    const targetMetadata = await lstat(targetDirectory.value);
    if (!targetMetadata.isDirectory()) {
      return err({
        code: "INVALID_TARGET_DIRECTORY",
        relativePath: request.targetDirectoryRelativePath,
      });
    }

    const groups = groupsFor(request, overrides);
    const movePath = overrides.movePath ?? rename;
    if (request.kind === "group") {
      const groupId = request.groupId;
      const group = await groups.get(groupId);
      if (!group.ok) return group;
      const parsedName = LibraryItemNameSchema.safeParse(request.newName ?? group.value.name);
      if (!parsedName.success) return err({ code: "INVALID_ITEM_NAME" });

      const moves: {
        readonly source: string;
        readonly sourceRelativePath: string;
        readonly target: string;
        readonly targetRelativePath: string;
        readonly previews: readonly { readonly source: string; readonly target: string }[];
      }[] = [];
      for (const sourceRelativePath of group.value.memberRelativePaths) {
        const source = resolveLibraryPath(request.libraryRoot, sourceRelativePath);
        if (!source.ok) return source;
        const targetRelativePath = win32.join(
          request.targetDirectoryRelativePath,
          win32.basename(sourceRelativePath),
        );
        const target = resolveLibraryPath(request.libraryRoot, targetRelativePath);
        if (!target.ok) return target;
        const metadata = await lstat(source.value);
        if (!metadata.isFile() || !isLibraryPatchPath(sourceRelativePath)) {
          return err({ code: "SOURCE_TYPE_MISMATCH", relativePath: sourceRelativePath });
        }
        if (!isSamePath(source.value, target.value) && (await pathExists(target.value))) {
          return err({ code: "TARGET_CONFLICT", relativePath: targetRelativePath });
        }
        const previews = await preparePatchPreviewMove({
          libraryRoot: request.libraryRoot,
          source: source.value,
          sourceRelativePath,
          targetRelativePath,
        });
        if (!previews.ok) return previews;
        moves.push({
          source: source.value,
          sourceRelativePath,
          target: target.value,
          targetRelativePath,
          previews: previews.value,
        });
      }
      const relocation: GroupRelocation = {
        groupId,
        categoryRelativePath: request.targetDirectoryRelativePath,
        ...(parsedName.data === group.value.name ? {} : { name: parsedName.data }),
      };
      const groupStateUpdate: GroupStateUpdate = {
        memberRelativePathsToRemove: [],
        relocations: [relocation],
      };
      const statePlan = overrides.deferGroupState
        ? ok({ steps: [] })
        : await groups.prepareRelocation(relocation);
      if (!statePlan.ok) return statePlan;
      const steps: FileTransactionStep[] = [
        ...moves.flatMap((move) => [
          ...(isSamePath(move.source, move.target)
            ? []
            : [
                {
                  apply: () => movePath(move.source, move.target),
                  compensate: () => movePath(move.target, move.source),
                },
              ]),
          ...move.previews.map(
            (preview): FileTransactionStep => ({
              apply: () => movePath(preview.source, preview.target),
              compensate: () => movePath(preview.target, preview.source),
            }),
          ),
        ]),
        ...statePlan.value.steps,
      ];
      return ok({
        relativePath: groupId,
        fileSourceRelativePaths: moves.map((move) => move.sourceRelativePath),
        fileTargetRelativePaths: moves.map((move) => move.targetRelativePath),
        groupStateUpdate,
        steps,
      });
    }

    const sourceRelativePath = request.sourceRelativePath;
    const source = resolveLibraryPath(request.libraryRoot, sourceRelativePath);
    if (!source.ok) return source;
    const sourceName = win32.basename(sourceRelativePath);
    const parsedName = LibraryItemNameSchema.safeParse(request.newName ?? sourceName);
    if (!parsedName.success || !isLibraryPatchPath(parsedName.data)) {
      return err({ code: "INVALID_ITEM_NAME" });
    }
    const targetRelativePath = win32.join(request.targetDirectoryRelativePath, parsedName.data);
    const target = resolveLibraryPath(request.libraryRoot, targetRelativePath);
    if (!target.ok) return target;
    const metadata = await lstat(source.value);
    if (!metadata.isFile() || !isLibraryPatchPath(sourceName)) {
      return err({ code: "SOURCE_TYPE_MISMATCH", relativePath: sourceRelativePath });
    }
    if (!isSamePath(source.value, target.value) && (await pathExists(target.value))) {
      return err({ code: "TARGET_CONFLICT", relativePath: targetRelativePath });
    }
    const previews = await preparePatchPreviewMove({
      libraryRoot: request.libraryRoot,
      source: source.value,
      sourceRelativePath,
      targetRelativePath,
    });
    if (!previews.ok) return previews;
    const sourceCategory =
      win32.dirname(sourceRelativePath) === "." ? "" : win32.dirname(sourceRelativePath);
    const shouldRemoveMember = !isSamePath(sourceCategory, request.targetDirectoryRelativePath);
    const groupStateUpdate: GroupStateUpdate = {
      memberRelativePathsToRemove: shouldRemoveMember ? [sourceRelativePath] : [],
      relocations: [],
    };
    const statePlan =
      overrides.deferGroupState || !shouldRemoveMember
        ? ok({ steps: [] })
        : await groups.prepareRemoveMembers([sourceRelativePath]);
    if (!statePlan.ok) return statePlan;
    const steps: FileTransactionStep[] = [
      ...(isSamePath(source.value, target.value)
        ? []
        : [
            {
              apply: () => movePath(source.value, target.value),
              compensate: () => movePath(target.value, source.value),
            },
          ]),
      ...previews.value.map(
        (previewMove): FileTransactionStep => ({
          apply: () => movePath(previewMove.source, previewMove.target),
          compensate: () => movePath(previewMove.target, previewMove.source),
        }),
      ),
      ...statePlan.value.steps,
    ];
    return ok({
      relativePath: targetRelativePath,
      fileSourceRelativePaths: [sourceRelativePath],
      fileTargetRelativePaths: [targetRelativePath],
      groupStateUpdate,
      steps,
    });
  } catch (error) {
    if (error instanceof Error) return err({ code: "LIBRARY_IO" });
    throw error;
  }
}

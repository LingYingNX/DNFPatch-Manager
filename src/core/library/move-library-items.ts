import { win32 } from "node:path";
import type { DataRoot, LibraryRoot } from "../../main/app-paths";
import { pathKey } from "../../shared/path-key";
import { err, ok, type Result } from "../../shared/result";
import {
  executeFileTransaction,
  type FileTransactionError,
  type FileTransactionStep,
} from "../filesystem/file-transaction";
import {
  createVirtualGroupService,
  type VirtualGroupService,
  type VirtualGroupServiceError,
} from "../groups/group-service";
import type { LibraryPathError } from "../paths/library-path";
import {
  type MoveLibraryItemError,
  type MoveLibraryItemPlan,
  prepareMoveLibraryItem,
} from "./move-library-item";

type MovePath = (source: string, target: string) => Promise<void>;

export type MoveLibraryItemsRequest = {
  readonly libraryRoot: LibraryRoot;
  readonly items: readonly MoveLibraryItemsItem[];
  readonly targetDirectoryRelativePath: string;
};

export type MoveLibraryItemsItem =
  | { readonly kind: "patch"; readonly sourceRelativePath: string }
  | { readonly kind: "group"; readonly groupId: string };

export type MoveLibraryItemsError =
  | LibraryPathError
  | FileTransactionError
  | VirtualGroupServiceError
  | Exclude<
      MoveLibraryItemError,
      FileTransactionError | LibraryPathError | VirtualGroupServiceError
    >
  | { readonly code: "INVALID_MOVE_SELECTION" };

export type MoveLibraryItemsOverrides = {
  readonly dataRoot?: DataRoot;
  readonly groups?: VirtualGroupService;
  readonly movePath?: MovePath;
};

export type MoveLibraryItemsPlan = {
  readonly relativePaths: readonly string[];
  readonly steps: readonly FileTransactionStep[];
};

function groupsFor(
  request: MoveLibraryItemsRequest,
  overrides: MoveLibraryItemsOverrides,
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

export async function moveLibraryItems(
  request: MoveLibraryItemsRequest,
  overrides: MoveLibraryItemsOverrides = {},
): Promise<Result<{ readonly relativePaths: readonly string[] }, MoveLibraryItemsError>> {
  const planned = await prepareMoveLibraryItems(request, overrides);
  if (!planned.ok) return planned;
  const transaction = await executeFileTransaction(planned.value.steps);
  return transaction.ok ? ok({ relativePaths: planned.value.relativePaths }) : transaction;
}

export async function prepareMoveLibraryItems(
  request: MoveLibraryItemsRequest,
  overrides: MoveLibraryItemsOverrides = {},
): Promise<Result<MoveLibraryItemsPlan, MoveLibraryItemsError>> {
  if (request.items.length === 0) return err({ code: "INVALID_MOVE_SELECTION" });
  const distinctSelectionIds = request.items.map((item) =>
    pathKey(item.kind === "patch" ? item.sourceRelativePath : item.groupId),
  );
  if (new Set(distinctSelectionIds).size !== distinctSelectionIds.length) {
    return err({ code: "INVALID_MOVE_SELECTION" });
  }

  const groups = groupsFor(request, overrides);
  const plannedMoves: MoveLibraryItemPlan[] = [];
  for (const item of request.items) {
    const planned = await prepareMoveLibraryItem(
      item.kind === "patch"
        ? {
            libraryRoot: request.libraryRoot,
            kind: "patch",
            sourceRelativePath: item.sourceRelativePath,
            targetDirectoryRelativePath: request.targetDirectoryRelativePath,
          }
        : {
            libraryRoot: request.libraryRoot,
            kind: "group",
            groupId: item.groupId,
            targetDirectoryRelativePath: request.targetDirectoryRelativePath,
          },
      {
        deferGroupState: true,
        groups,
        ...(overrides.movePath === undefined ? {} : { movePath: overrides.movePath }),
      },
    );
    if (!planned.ok) return planned;
    plannedMoves.push(planned.value);
  }

  const sourcePaths = plannedMoves.flatMap((plan) => plan.fileSourceRelativePaths).map(pathKey);
  const targetPaths = plannedMoves.flatMap((plan) => plan.fileTargetRelativePaths).map(pathKey);
  if (
    new Set(sourcePaths).size !== sourcePaths.length ||
    new Set(targetPaths).size !== targetPaths.length
  ) {
    return err({ code: "INVALID_MOVE_SELECTION" });
  }

  const statePlan = await groups.prepareUpdates({
    memberRelativePathsToRemove: plannedMoves.flatMap(
      (plan) => plan.groupStateUpdate.memberRelativePathsToRemove,
    ),
    memberRelativePathReplacements: plannedMoves.flatMap(
      (plan) => plan.groupStateUpdate.memberRelativePathReplacements,
    ),
    relocations: plannedMoves.flatMap((plan) => plan.groupStateUpdate.relocations),
  });
  if (!statePlan.ok) return statePlan;
  return ok({
    relativePaths: plannedMoves.map((plan) => plan.relativePath),
    steps: [...plannedMoves.flatMap((plan) => plan.steps), ...statePlan.value.steps],
  });
}

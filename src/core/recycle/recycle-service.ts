import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { win32 } from "node:path";
import type { DataRoot, LibraryRoot } from "../../main/app-paths";
import { err, ok, type Result } from "../../shared/result";
import {
  executeFileTransaction,
  type FileTransactionError,
  type FileTransactionStep,
} from "../filesystem/file-transaction";
import { isNotFoundError, pathExists } from "../filesystem/path-exists";
import type { VirtualGroupService, VirtualGroupServiceError } from "../groups/group-service";
import { findMatchingPreview } from "../library/library-preview";
import { type LibraryPathError, resolveLibraryPath } from "../paths/library-path";
import type { PreviewService, PreviewServiceError } from "../previews/preview-service";
import type { StateStoreError } from "../state/atomic-json-store";
import { emptyRecycleManifest, type RecycleEntry, type RecycleManifest } from "../state/schemas";
import { prepareRecycleItems, type RecycleItemsPlan, resolveRecyclePath } from "./recycle-items";
import {
  createRecycleManifestStore,
  readRecycleManifest,
  restoreRecycleManifest,
  writeRecycleManifest,
} from "./recycle-manifest";

export type RecycleBatchContext = {
  readonly createId: () => string;
  readonly libraryRoot: LibraryRoot;
  readonly manifestFile: string;
  readonly now: () => Date;
  readonly recycleRoot: string;
  readonly store: ReturnType<typeof createRecycleManifestStore>;
  readonly groups?: VirtualGroupService | undefined;
  readonly previews?: PreviewService | undefined;
};

type RecycleServiceOptions = {
  readonly libraryRoot: LibraryRoot;
  readonly dataRoot: DataRoot;
  readonly createId?: () => string;
  readonly now?: () => Date;
  readonly groups?: VirtualGroupService;
  readonly previews?: PreviewService;
  readonly executeTransaction?: typeof executeFileTransaction;
};

export type RecycleItem =
  | {
      readonly kind: "patch";
      readonly relativePath: string;
    }
  | {
      readonly kind: "group";
      readonly groupId: string;
    };

export type RecycleServiceError =
  | LibraryPathError
  | VirtualGroupServiceError
  | FileTransactionError
  | StateStoreError
  | PreviewServiceError
  | { readonly code: "SOURCE_TYPE_MISMATCH"; readonly relativePath: string }
  | { readonly code: "RECYCLE_ITEM_NOT_FOUND"; readonly id: string }
  | { readonly code: "TARGET_CONFLICT"; readonly relativePath: string }
  | { readonly code: "CONFIRMATION_REQUIRED" }
  | { readonly code: "GROUP_SERVICE_REQUIRED" }
  | { readonly code: "RECYCLE_IO" };

export interface RecycleService {
  prepareRecycleMany(
    items: readonly RecycleItem[],
  ): Promise<Result<RecycleItemsPlan, RecycleServiceError>>;
  recycleMany(
    items: readonly RecycleItem[],
  ): Promise<Result<{ readonly entries: readonly RecycleEntry[] }, RecycleServiceError>>;
  list(): Promise<Result<readonly RecycleEntry[], StateStoreError>>;
  recycle(
    request:
      | {
          readonly kind: "patch";
          readonly relativePath: string;
        }
      | {
          readonly kind: "group";
          readonly groupId: string;
        },
  ): Promise<Result<{ readonly entry: RecycleEntry }, RecycleServiceError>>;
  restore(request: {
    readonly id: string;
  }): Promise<Result<{ readonly relativePath: string }, RecycleServiceError>>;
  deleteMany(request: {
    readonly ids: readonly string[];
  }): Promise<Result<{ readonly deletedIds: readonly string[] }, RecycleServiceError>>;
  empty(request: {
    readonly confirmed: boolean;
  }): Promise<Result<{ readonly removedCount: number }, RecycleServiceError>>;
}

export function createRecycleService(options: RecycleServiceOptions): RecycleService {
  const createId = options.createId ?? randomUUID;
  const now = options.now ?? (() => new Date());
  const manifestFile = win32.join(options.dataRoot, "recycle-bin.json");
  const recycleRoot = win32.join(options.dataRoot, "recycle-bin");
  const store = createRecycleManifestStore(manifestFile);
  const executeTransaction = options.executeTransaction ?? executeFileTransaction;
  const context: RecycleBatchContext = {
    createId,
    libraryRoot: options.libraryRoot,
    manifestFile,
    now,
    recycleRoot,
    store,
    groups: options.groups,
    previews: options.previews,
  };

  return {
    prepareRecycleMany: (items) => prepareRecycleItems(context, items),
    async recycleMany(items) {
      const planned = await prepareRecycleItems(context, items);
      if (!planned.ok) return planned;
      const transaction = await executeTransaction(planned.value.steps);
      return transaction.ok ? ok({ entries: planned.value.entries }) : transaction;
    },
    async list() {
      const snapshot = await readRecycleManifest(store);
      return snapshot.ok ? ok(snapshot.value.manifest.items) : snapshot;
    },

    async recycle(request) {
      const result = await this.recycleMany([request]);
      if (!result.ok) return result;
      const entry = result.value.entries[0];
      return entry === undefined ? err({ code: "RECYCLE_IO" }) : ok({ entry });
    },

    async restore(request) {
      const snapshot = await readRecycleManifest(store);
      if (!snapshot.ok) {
        return snapshot;
      }
      const entry = snapshot.value.manifest.items.find((item) => item.id === request.id);
      if (entry === undefined) {
        return err({ code: "RECYCLE_ITEM_NOT_FOUND", id: request.id });
      }
      const target = resolveLibraryPath(options.libraryRoot, entry.originalRelativePath);
      if (!target.ok) {
        return target;
      }
      const recycledPath = resolveRecyclePath(recycleRoot, entry.recycledRelativePath);
      if (recycledPath === null) {
        return err({ code: "RECYCLE_IO" });
      }

      try {
        if (await pathExists(target.value)) {
          return err({ code: "TARGET_CONFLICT", relativePath: entry.originalRelativePath });
        }
        if (!(await pathExists(recycledPath))) {
          return err({ code: "RECYCLE_IO" });
        }
        await mkdir(win32.dirname(target.value), { recursive: true });
        const nextManifest: RecycleManifest = {
          ...snapshot.value.manifest,
          items: snapshot.value.manifest.items.filter((item) => item.id !== entry.id),
        };
        const previewPlan = options.previews
          ? await options.previews.prepareRestore(entry)
          : ok({ steps: [] });
        if (!previewPlan.ok) return previewPlan;
        const steps: FileTransactionStep[] = [
          {
            apply: () => rename(recycledPath, target.value),
            compensate: () => rename(target.value, recycledPath),
          },
          {
            apply: () => writeRecycleManifest(store, nextManifest),
            compensate: () => writeRecycleManifest(store, snapshot.value.manifest),
          },
          ...previewPlan.value.steps,
        ];
        const transaction = await executeFileTransaction(steps);
        if (!transaction.ok) {
          return transaction;
        }
        await rm(win32.dirname(recycledPath), { force: true, recursive: true });
        return ok({ relativePath: entry.originalRelativePath });
      } catch (error) {
        if (error instanceof Error) {
          return err({ code: "RECYCLE_IO" });
        }
        throw error;
      }
    },

    async deleteMany(request) {
      const ids = [...new Set(request.ids)];
      if (ids.length === 0) return err({ code: "RECYCLE_IO" });
      const snapshot = await readRecycleManifest(store);
      if (!snapshot.ok) {
        return snapshot;
      }
      const requestedIds = new Set(ids);
      const entries = snapshot.value.manifest.items.filter((item) => requestedIds.has(item.id));
      if (entries.length !== ids.length) {
        return err({ code: "RECYCLE_ITEM_NOT_FOUND", id: request.ids[0] ?? "" });
      }

      try {
        for (const entry of entries) {
          const recycledPath = resolveRecyclePath(recycleRoot, entry.recycledRelativePath);
          if (recycledPath === null || !(await pathExists(recycledPath))) {
            return err({ code: "RECYCLE_IO" });
          }
        }
        const deletedIds = entries.map((entry) => entry.id);
        const nextManifest: RecycleManifest = {
          ...snapshot.value.manifest,
          items: snapshot.value.manifest.items.filter((item) => !requestedIds.has(item.id)),
        };
        const previewPlan = options.previews
          ? await options.previews.prepareDeleteMany(entries)
          : ok({ steps: [], cleanup: async () => {} });
        if (!previewPlan.ok) return previewPlan;
        const steps: FileTransactionStep[] = [
          ...entries.map(
            (entry): FileTransactionStep => ({
              apply: async () => {
                const recycledPath = resolveRecyclePath(recycleRoot, entry.recycledRelativePath);
                if (recycledPath === null) throw new Error("Invalid recycle path");
                await rm(win32.dirname(recycledPath), { force: true, recursive: true });
              },
              compensate: async () => {
                // 已删除的回收文件没有保留副本，事务只能保证清单一致后停止。
                throw new Error("Recycled file deletion cannot be compensated");
              },
            }),
          ),
          {
            apply: () => writeRecycleManifest(store, nextManifest),
            compensate: () => writeRecycleManifest(store, snapshot.value.manifest),
          },
          ...previewPlan.value.steps,
        ];
        const transaction = await executeFileTransaction(steps);
        if (!transaction.ok) {
          return transaction;
        }
        await previewPlan.value.cleanup();
        for (const entry of entries) {
          if (entry.kind !== "patch") continue;
          await removeMatchingLibraryPreview(options.libraryRoot, entry.originalRelativePath);
        }
        return ok({ deletedIds });
      } catch (error) {
        if (error instanceof Error) {
          return err({ code: "RECYCLE_IO" });
        }
        throw error;
      }
    },

    async empty(request) {
      if (!request.confirmed) {
        return err({ code: "CONFIRMATION_REQUIRED" });
      }
      const snapshot = await readRecycleManifest(store);
      if (!snapshot.ok) {
        return snapshot;
      }

      try {
        const stagingRoot = `${recycleRoot}.empty-${randomUUID()}`;
        const steps: FileTransactionStep[] = [];
        if (await pathExists(recycleRoot)) {
          if (await pathExists(stagingRoot)) {
            return err({ code: "RECYCLE_IO" });
          }
          steps.push({
            apply: () => rename(recycleRoot, stagingRoot),
            compensate: () => rename(stagingRoot, recycleRoot),
          });
        }
        steps.push({
          apply: () => writeRecycleManifest(store, emptyRecycleManifest()),
          compensate: () => restoreRecycleManifest(store, manifestFile, snapshot.value),
        });
        const transaction = await executeFileTransaction(steps);
        if (!transaction.ok) {
          return transaction;
        }
        await rm(stagingRoot, { force: true, recursive: true });
        for (const item of snapshot.value.manifest.items) {
          if (item.kind !== "patch") continue;
          await removeMatchingLibraryPreview(options.libraryRoot, item.originalRelativePath);
        }
        return ok({ removedCount: snapshot.value.manifest.items.length });
      } catch (error) {
        if (error instanceof Error) {
          return err({ code: "RECYCLE_IO" });
        }
        throw error;
      }
    },
  };
}

async function removeMatchingLibraryPreview(
  libraryRoot: LibraryRoot,
  originalRelativePath: string,
): Promise<void> {
  const directoryRelativePath = win32.dirname(originalRelativePath);
  const directory = resolveLibraryPath(libraryRoot, directoryRelativePath);
  if (!directory.ok) return;
  const baseName = win32.basename(originalRelativePath, win32.extname(originalRelativePath));
  let names: string[];
  try {
    names = await readdir(directory.value);
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
  const previewName = findMatchingPreview(names, baseName);
  if (previewName === null) return;
  await rm(win32.join(directory.value, previewName), { force: true });
}

import { lstat, readdir } from "node:fs/promises";
import { win32 } from "node:path";
import type { LibraryRoot } from "../../main/app-paths";
import { isLibraryPatchPath } from "../../shared/library-patch-extensions";
import { pathKey } from "../../shared/path-key";
import { err, ok, type Result } from "../../shared/result";
import type { ManagedImageAssets, ManagedImageError } from "../assets/managed-image-assets";
import type { FileTransactionStep } from "../filesystem/file-transaction";
import { isNotFoundError } from "../filesystem/path-exists";
import {
  copyLibraryPreview,
  findMatchingPreview,
  type LibraryPreviewError,
} from "../library/library-preview";
import { resolveLibraryPath } from "../paths/library-path";
import type { AtomicJsonStore, StateStoreError } from "../state/atomic-json-store";
import type { PreviewState } from "../state/schemas";
import { readPreviewState, writePreviewState } from "./preview-state";

export type PreviewReference =
  | { readonly kind: "patch"; readonly relativePath: string }
  | { readonly kind: "group"; readonly groupId: string };

type LegacyGroupPreviewReference = { readonly kind: "group"; readonly relativePath: string };
type PreviewBindingReference = PreviewReference | LegacyGroupPreviewReference;
type PreviewItem = PreviewReference;

type PreviewMove = {
  readonly kind: "patch";
  readonly fromRelativePath: string;
  readonly toRelativePath: string;
};

export type PreviewServiceError = StateStoreError | ManagedImageError | LibraryPreviewError;

export type PreviewService = {
  readonly read: () => Promise<Result<PreviewState, StateStoreError>>;
  readonly listActive: () => Promise<
    Result<
      readonly (
        | {
            readonly kind: "patch";
            readonly relativePath: string;
            readonly previewUrl: string;
          }
        | {
            readonly kind: "group";
            readonly groupId: string;
            readonly previewUrl: string;
          }
      )[],
      PreviewServiceError
    >
  >;
  readonly set: (
    request: PreviewItem & { readonly sourcePath: string },
  ) => Promise<Result<{ readonly previewUrl: string }, PreviewServiceError>>;
  readonly migratePatchBindingsToLibrary: (
    libraryRoot: LibraryRoot,
  ) => Promise<Result<{ readonly migratedCount: number }, PreviewServiceError>>;
  readonly prepareMoveMany: (
    moves: readonly PreviewMove[],
  ) => Promise<Result<{ readonly steps: readonly FileTransactionStep[] }, StateStoreError>>;
  readonly prepareImportGroupPreview: (request: {
    readonly groupId: string;
    readonly legacyRelativePath?: string;
    readonly sourcePath: string;
  }) => Promise<Result<{ readonly steps: readonly FileTransactionStep[] }, PreviewServiceError>>;
  readonly prepareMigrateLegacyGroupBindings: (
    mappings: readonly { readonly groupId: string; readonly legacyRelativePath: string }[],
  ) => Promise<Result<{ readonly steps: readonly FileTransactionStep[] }, StateStoreError>>;
  readonly prepareRemoveGroupBindingById: (
    groupId: string,
  ) => Promise<Result<{ readonly steps: readonly FileTransactionStep[] }, StateStoreError>>;
  readonly prepareRecycleMany: (
    entries: readonly {
      readonly id: string;
      readonly kind: "patch" | "group";
      readonly originalRelativePath: string;
    }[],
  ) => Promise<Result<{ readonly steps: readonly FileTransactionStep[] }, StateStoreError>>;
  readonly prepareRestore: (entry: {
    readonly id: string;
    readonly kind: "patch" | "group";
    readonly originalRelativePath: string;
  }) => Promise<Result<{ readonly steps: readonly FileTransactionStep[] }, StateStoreError>>;
  readonly prepareDeleteMany: (
    entries: readonly {
      readonly id: string;
    }[],
  ) => Promise<
    Result<
      {
        readonly steps: readonly FileTransactionStep[];
        readonly cleanup: () => Promise<void>;
      },
      StateStoreError
    >
  >;
};

type PreviewServiceOptions = {
  readonly assets: ManagedImageAssets;
  readonly store: AtomicJsonStore<PreviewState>;
};

function identity(item: PreviewBindingReference): string {
  return item.kind === "patch"
    ? `patch:${pathKey(item.relativePath)}`
    : "groupId" in item
      ? `group:${item.groupId.toLocaleLowerCase()}`
      : `group-path:${pathKey(item.relativePath)}`;
}

function referenceForBinding(
  binding: Extract<PreviewState["bindings"][number], { readonly state: "active" }>,
): PreviewBindingReference {
  return binding.kind === "patch"
    ? { kind: "patch", relativePath: binding.relativePath }
    : "groupId" in binding
      ? { kind: "group", groupId: binding.groupId }
      : { kind: "group", relativePath: binding.relativePath };
}

async function hasMatchingLibraryPreview(
  libraryRoot: LibraryRoot,
  relativePath: string,
): Promise<Result<boolean | null, LibraryPreviewError>> {
  const directoryRelativePath = win32.dirname(relativePath);
  const directory = resolveLibraryPath(libraryRoot, directoryRelativePath);
  if (!directory.ok) return directory;
  const patch = resolveLibraryPath(libraryRoot, relativePath);
  if (!patch.ok) return patch;
  try {
    const [metadata, fileNames] = await Promise.all([lstat(patch.value), readdir(directory.value)]);
    if (!metadata.isFile() || !isLibraryPatchPath(relativePath)) {
      return ok(null);
    }
    const baseName = win32.basename(relativePath, win32.extname(relativePath));
    return ok(findMatchingPreview(fileNames, baseName) !== null);
  } catch (error) {
    if (isNotFoundError(error)) {
      return ok(null);
    }
    if (error instanceof Error) {
      return err({ code: "LIBRARY_IO", relativePath });
    }
    throw error;
  }
}

export function createPreviewService(options: PreviewServiceOptions): PreviewService {
  return {
    read: () => readPreviewState(options.store),
    async listActive() {
      const current = await readPreviewState(options.store);
      if (!current.ok) return current;
      const items: Array<PreviewReference & { readonly previewUrl: string }> = [];
      for (const binding of current.value.bindings) {
        if (binding.state !== "active") continue;
        if (binding.kind === "group" && !("groupId" in binding)) continue;
        const url = options.assets.url(binding.assetName);
        if (!url.ok) return url;
        items.push({
          ...(binding.kind === "patch"
            ? { kind: "patch" as const, relativePath: binding.relativePath }
            : { kind: "group" as const, groupId: binding.groupId }),
          previewUrl: url.value,
        });
      }
      return ok(items);
    },
    async set(request) {
      const current = await readPreviewState(options.store);
      if (!current.ok) return current;
      const copied = await options.assets.copyFrom(request.sourcePath);
      if (!copied.ok) return copied;
      const requestIdentity = identity(request);
      const existing = current.value.bindings.find(
        (binding) =>
          binding.state === "active" && identity(referenceForBinding(binding)) === requestIdentity,
      );
      const nextBinding =
        request.kind === "patch"
          ? {
              state: "active" as const,
              kind: "patch" as const,
              relativePath: request.relativePath,
              assetName: copied.value.assetName,
            }
          : {
              state: "active" as const,
              kind: "group" as const,
              groupId: request.groupId,
              assetName: copied.value.assetName,
            };
      const next: PreviewState = {
        formatVersion: 1,
        bindings: [
          ...current.value.bindings.filter(
            (binding) =>
              binding.state !== "active" ||
              identity(referenceForBinding(binding)) !== requestIdentity,
          ),
          nextBinding,
        ],
      };
      const written = await options.store.write(next);
      if (!written.ok) {
        const cleanup = await options.assets.remove(copied.value.assetName);
        return cleanup.ok ? written : cleanup;
      }
      if (existing !== undefined) {
        const removed = await options.assets.remove(existing.assetName);
        if (!removed.ok) return removed;
      }
      return ok({ previewUrl: copied.value.url });
    },
    async migratePatchBindingsToLibrary(libraryRoot) {
      const current = await readPreviewState(options.store);
      if (!current.ok) return current;
      const bindingsToRemove: Extract<
        PreviewState["bindings"][number],
        { readonly state: "active"; readonly kind: "patch" }
      >[] = [];
      for (const binding of current.value.bindings) {
        if (binding.state !== "active" || binding.kind !== "patch") continue;
        const matchingPreview = await hasMatchingLibraryPreview(libraryRoot, binding.relativePath);
        if (!matchingPreview.ok) return matchingPreview;
        if (matchingPreview.value === null) continue;
        if (!matchingPreview.value) {
          const source = options.assets.path(binding.assetName);
          if (!source.ok) return source;
          const copied = await copyLibraryPreview({
            kind: "patch",
            libraryRoot,
            relativePath: binding.relativePath,
            sourcePath: source.value,
          });
          if (!copied.ok) return copied;
        }
        bindingsToRemove.push(binding);
      }
      if (bindingsToRemove.length === 0) return ok({ migratedCount: 0 });
      const bindingIds = new Set(bindingsToRemove.map(identity));
      const next: PreviewState = {
        ...current.value,
        bindings: current.value.bindings.filter(
          (binding) =>
            binding.state !== "active" ||
            binding.kind !== "patch" ||
            !bindingIds.has(identity(binding)),
        ),
      };
      const written = await options.store.write(next);
      if (!written.ok) return written;
      for (const binding of bindingsToRemove) {
        const removed = await options.assets.remove(binding.assetName);
        if (!removed.ok) return removed;
      }
      return ok({ migratedCount: bindingsToRemove.length });
    },
    async prepareMoveMany(moves) {
      const current = await readPreviewState(options.store);
      if (!current.ok) return current;
      const targets = new Map(
        moves.map((move) => [
          identity({ kind: "patch", relativePath: move.fromRelativePath }),
          move.toRelativePath,
        ]),
      );
      let changed = false;
      const next: PreviewState = {
        ...current.value,
        bindings: current.value.bindings.map((binding) => {
          if (binding.state !== "active") return binding;
          if (binding.kind !== "patch") return binding;
          const target = targets.get(identity(referenceForBinding(binding)));
          if (target === undefined) return binding;
          changed = true;
          return { ...binding, relativePath: target };
        }),
      };
      const steps: readonly FileTransactionStep[] = changed
        ? [
            {
              apply: () => writePreviewState(options.store, next),
              compensate: () => writePreviewState(options.store, current.value),
            },
          ]
        : [];
      return ok({ steps });
    },
    async prepareImportGroupPreview({ groupId, legacyRelativePath, sourcePath }) {
      const current = await readPreviewState(options.store);
      if (!current.ok) return current;
      const legacyGroupKey = legacyRelativePath === undefined ? null : pathKey(legacyRelativePath);
      const isImportedGroupBinding = (binding: PreviewState["bindings"][number]): boolean => {
        if (binding.state !== "active" || binding.kind !== "group") return false;
        if ("groupId" in binding) return binding.groupId === groupId;
        return legacyGroupKey !== null && pathKey(binding.relativePath) === legacyGroupKey;
      };
      let copiedAssetName: string | null = null;
      return ok({
        steps: [
          {
            apply: async () => {
              const copied = await options.assets.copyFrom(sourcePath);
              if (!copied.ok) throw new Error("Unable to copy imported group preview");
              copiedAssetName = copied.value.assetName;
              const latest = await readPreviewState(options.store);
              if (!latest.ok) {
                await options.assets.remove(copied.value.assetName);
                throw new Error("Unable to read preview state before importing group preview");
              }
              const next: PreviewState = {
                ...latest.value,
                bindings: [
                  ...latest.value.bindings.filter((binding) => !isImportedGroupBinding(binding)),
                  {
                    state: "active",
                    kind: "group",
                    groupId,
                    assetName: copied.value.assetName,
                  },
                ],
              };
              const written = await options.store.write(next);
              if (!written.ok) {
                await options.assets.remove(copied.value.assetName);
                throw new Error("Unable to write imported group preview");
              }
            },
            compensate: async () => {
              await writePreviewState(options.store, current.value);
              if (copiedAssetName !== null) await options.assets.remove(copiedAssetName);
            },
          },
        ],
      });
    },
    async prepareMigrateLegacyGroupBindings(mappings) {
      const current = await readPreviewState(options.store);
      if (!current.ok) return current;
      const groupIdsByPath = new Map(
        mappings.map((mapping) => [pathKey(mapping.legacyRelativePath), mapping.groupId]),
      );
      let changed = false;
      const migrate = (state: PreviewState): PreviewState => ({
        ...state,
        bindings: state.bindings.map((binding) => {
          if (binding.state !== "active" || binding.kind !== "group" || "groupId" in binding) {
            return binding;
          }
          const groupId = groupIdsByPath.get(pathKey(binding.relativePath));
          if (groupId === undefined) return binding;
          changed = true;
          return {
            state: "active",
            kind: "group",
            groupId,
            assetName: binding.assetName,
          };
        }),
      });
      migrate(current.value);
      if (!changed) return ok({ steps: [] });
      return ok({
        steps: [
          {
            apply: async () => {
              const latest = await readPreviewState(options.store);
              if (!latest.ok) throw new Error("Unable to read preview state during migration");
              await writePreviewState(options.store, migrate(latest.value));
            },
            compensate: () => writePreviewState(options.store, current.value),
          },
        ],
      });
    },
    async prepareRemoveGroupBindingById(groupId) {
      const current = await readPreviewState(options.store);
      if (!current.ok) return current;
      const next: PreviewState = {
        ...current.value,
        bindings: current.value.bindings.filter(
          (binding) =>
            binding.state !== "active" ||
            binding.kind !== "group" ||
            !("groupId" in binding) ||
            binding.groupId !== groupId,
        ),
      };
      const steps: readonly FileTransactionStep[] =
        next.bindings.length !== current.value.bindings.length
          ? [
              {
                apply: () => writePreviewState(options.store, next),
                compensate: () => writePreviewState(options.store, current.value),
              },
            ]
          : [];
      return ok({ steps });
    },
    async prepareRecycleMany(entries) {
      const current = await readPreviewState(options.store);
      if (!current.ok) return current;
      const entryIds = new Map(
        entries.map((entry) => [
          identity(
            entry.kind === "patch"
              ? { kind: "patch", relativePath: entry.originalRelativePath }
              : { kind: "group", groupId: entry.originalRelativePath },
          ),
          entry.id,
        ]),
      );
      let changed = false;
      const next: PreviewState = {
        ...current.value,
        bindings: current.value.bindings.map((binding) => {
          if (binding.state !== "active") return binding;
          const recycleEntryId = entryIds.get(identity(referenceForBinding(binding)));
          if (recycleEntryId === undefined) return binding;
          changed = true;
          return { state: "recycled", recycleEntryId, assetName: binding.assetName };
        }),
      };
      const steps: readonly FileTransactionStep[] = changed
        ? [
            {
              apply: () => writePreviewState(options.store, next),
              compensate: () => writePreviewState(options.store, current.value),
            },
          ]
        : [];
      return ok({ steps });
    },
    async prepareRestore(entry) {
      const current = await readPreviewState(options.store);
      if (!current.ok) return current;
      let changed = false;
      const next: PreviewState = {
        ...current.value,
        bindings: current.value.bindings.map((binding) => {
          if (binding.state !== "recycled" || binding.recycleEntryId !== entry.id) return binding;
          changed = true;
          return entry.kind === "patch"
            ? {
                state: "active",
                kind: "patch",
                relativePath: entry.originalRelativePath,
                assetName: binding.assetName,
              }
            : {
                state: "active",
                kind: "group",
                groupId: entry.originalRelativePath,
                assetName: binding.assetName,
              };
        }),
      };
      const steps: readonly FileTransactionStep[] = changed
        ? [
            {
              apply: () => writePreviewState(options.store, next),
              compensate: () => writePreviewState(options.store, current.value),
            },
          ]
        : [];
      return ok({ steps });
    },
    async prepareDeleteMany(entries) {
      const current = await readPreviewState(options.store);
      if (!current.ok) return current;
      const deletedIds = new Set(entries.map((entry) => entry.id));
      const removedBindings = current.value.bindings.filter(
        (binding) => binding.state === "recycled" && deletedIds.has(binding.recycleEntryId),
      );
      if (removedBindings.length === 0) return ok({ steps: [], cleanup: async () => {} });
      const assetNames = removedBindings.map((binding) => binding.assetName);
      const next: PreviewState = {
        ...current.value,
        bindings: current.value.bindings.filter(
          (binding) => binding.state !== "recycled" || !deletedIds.has(binding.recycleEntryId),
        ),
      };
      return ok({
        steps: [
          {
            apply: () => writePreviewState(options.store, next),
            compensate: () => writePreviewState(options.store, current.value),
          },
        ],
        cleanup: async () => {
          for (const assetName of assetNames) {
            const removed = await options.assets.remove(assetName);
            if (!removed.ok) throw new Error("Unable to remove recycled preview asset");
          }
        },
      });
    },
  };
}

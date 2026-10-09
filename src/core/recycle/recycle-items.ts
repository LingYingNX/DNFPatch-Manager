import { lstat, mkdir, rename, rm } from "node:fs/promises";
import { win32 } from "node:path";
import { isLibraryPatchPath } from "../../shared/library-patch-extensions";
import { err, ok, type Result } from "../../shared/result";
import type { FileTransactionStep } from "../filesystem/file-transaction";
import { isNotFoundError, pathExists } from "../filesystem/path-exists";
import { resolveLibraryPath } from "../paths/library-path";
import { normalizedPathKey } from "../paths/relative-path";
import { type RecycleEntry, RecycleEntrySchema, type RecycleManifest } from "../state/schemas";
import {
  readRecycleManifest,
  restoreRecycleManifest,
  writeRecycleManifest,
} from "./recycle-manifest";
import type { RecycleBatchContext, RecycleItem, RecycleServiceError } from "./recycle-service";

export type RecycleItemsPlan = {
  readonly entries: readonly RecycleEntry[];
  readonly steps: readonly FileTransactionStep[];
};

export function resolveRecyclePath(root: string, relativePath: string): string | null {
  if (win32.isAbsolute(relativePath)) return null;
  const candidate = win32.resolve(root, relativePath);
  const relativeToRoot = win32.relative(root, candidate);
  return relativeToRoot === ".." ||
    relativeToRoot.startsWith(`..${win32.sep}`) ||
    win32.isAbsolute(relativeToRoot)
    ? null
    : candidate;
}

export async function prepareRecycleItems(
  context: RecycleBatchContext,
  items: readonly RecycleItem[],
): Promise<Result<RecycleItemsPlan, RecycleServiceError>> {
  if (items.length === 0) return err({ code: "RECYCLE_IO" });
  const identities = items.map((item) =>
    item.kind === "patch"
      ? `patch:${normalizedPathKey(item.relativePath)}`
      : `group:${item.groupId.toLocaleLowerCase()}`,
  );
  if (new Set(identities).size !== identities.length) return err({ code: "RECYCLE_IO" });
  const snapshot = await readRecycleManifest(context.store);
  if (!snapshot.ok) return snapshot;

  try {
    const expanded = await expandRecycleItems(context, items);
    if (!expanded.ok) return expanded;
    const candidates: {
      readonly container: string;
      readonly entry: RecycleEntry;
      readonly recycledPath: string;
      readonly source: string;
    }[] = [];
    for (const item of expanded.value.items) {
      const source = resolveLibraryPath(context.libraryRoot, item.relativePath);
      if (!source.ok) return source;
      const metadata = await lstat(source.value);
      const matches = metadata.isFile() && isLibraryPatchPath(source.value);
      if (!matches) return err({ code: "SOURCE_TYPE_MISMATCH", relativePath: item.relativePath });

      const id = context.createId();
      const recycledRelativePath = win32.join(id, win32.basename(item.relativePath));
      const recycledPath = resolveRecyclePath(context.recycleRoot, recycledRelativePath);
      if (recycledPath === null) return err({ code: "RECYCLE_IO" });
      const container = win32.dirname(recycledPath);
      if (await pathExists(container)) return err({ code: "RECYCLE_IO" });
      candidates.push({
        container,
        recycledPath,
        source: source.value,
        entry: RecycleEntrySchema.parse({
          id,
          kind: "patch",
          originalRelativePath: item.relativePath,
          recycledRelativePath,
          recycledAt: context.now().toISOString(),
        }),
      });
    }
    const entries = candidates.map((candidate) => candidate.entry);
    const nextManifest: RecycleManifest = {
      ...snapshot.value.manifest,
      items: [...snapshot.value.manifest.items, ...entries],
    };
    const steps: FileTransactionStep[] = [
      ...candidates.flatMap((candidate): FileTransactionStep[] => [
        {
          apply: () => mkdir(candidate.container, { recursive: true }).then(() => undefined),
          compensate: () => rm(candidate.container, { force: true, recursive: true }),
        },
        {
          apply: () => rename(candidate.source, candidate.recycledPath),
          compensate: () => rename(candidate.recycledPath, candidate.source),
        },
      ]),
      {
        apply: () => writeRecycleManifest(context.store, nextManifest),
        compensate: () =>
          restoreRecycleManifest(context.store, context.manifestFile, snapshot.value),
      },
    ];
    if (context.groups !== undefined) {
      for (const groupId of expanded.value.groupIds) {
        const groupPlan = await context.groups.prepareDissolve(groupId);
        if (!groupPlan.ok) return groupPlan;
        steps.push(...groupPlan.value.steps);
        if (context.previews !== undefined) {
          const previewPlan = await context.previews.prepareRemoveGroupBindingById(groupId);
          if (!previewPlan.ok) return previewPlan;
          steps.push(...previewPlan.value.steps);
        }
      }
    }
    return ok({ entries, steps });
  } catch (error) {
    if (error instanceof Error) return err({ code: "RECYCLE_IO" });
    throw error;
  }
}

async function expandRecycleItems(
  context: RecycleBatchContext,
  items: readonly RecycleItem[],
): Promise<
  Result<
    {
      readonly items: readonly Extract<RecycleItem, { readonly kind: "patch" }>[];
      readonly groupIds: readonly string[];
    },
    RecycleServiceError
  >
> {
  const expanded: Extract<RecycleItem, { readonly kind: "patch" }>[] = [];
  const groupIds: string[] = [];
  const seenPaths = new Set<string>();
  for (const item of items) {
    if (item.kind === "patch") {
      const key = normalizedPathKey(item.relativePath);
      if (seenPaths.has(key)) return err({ code: "RECYCLE_IO" });
      seenPaths.add(key);
      expanded.push(item);
      continue;
    }
    if (context.groups === undefined) return err({ code: "GROUP_SERVICE_REQUIRED" });
    const group = await context.groups.get(item.groupId);
    if (!group.ok) return group;
    groupIds.push(item.groupId);
    for (const relativePath of group.value.memberRelativePaths) {
      const source = resolveLibraryPath(context.libraryRoot, relativePath);
      if (!source.ok) return source;
      try {
        const metadata = await lstat(source.value);
        if (!metadata.isFile() || !isLibraryPatchPath(relativePath)) {
          continue;
        }
        const key = normalizedPathKey(relativePath);
        if (seenPaths.has(key)) return err({ code: "RECYCLE_IO" });
        seenPaths.add(key);
        expanded.push({ kind: "patch", relativePath });
      } catch (error) {
        if (isNotFoundError(error)) continue;
        throw error;
      }
    }
  }
  return ok({ items: expanded, groupIds });
}

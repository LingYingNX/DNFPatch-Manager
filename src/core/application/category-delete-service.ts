import { readdir } from "node:fs/promises";
import { win32 } from "node:path";
import type { LibraryRoot } from "../../main/app-paths";
import { isLibraryPatchPath } from "../../shared/library-patch-extensions";
import { isPathWithin, pathKey } from "../../shared/path-key";
import { err, type Result } from "../../shared/result";
import type { VirtualGroupService } from "../groups/group-service";
import { createCategoryCommands } from "../library/category-commands";
import { resolveLibraryPath } from "../paths/library-path";
import type { RecycleItem } from "../recycle/recycle-service";

type CategoryDeleteError = { readonly code: string };

type CategoryDeleteOptions = {
  readonly groups?: VirtualGroupService;
  readonly libraryRoot: LibraryRoot;
  readonly recycleMany: (
    items: readonly RecycleItem[],
  ) => Promise<Result<unknown, CategoryDeleteError>>;
};

type CategoryDeleteService = {
  readonly remove: (request: {
    readonly confirmed: boolean;
    readonly relativePath: string;
  }) => Promise<Result<{ readonly relativePath: string }, CategoryDeleteError>>;
};

async function collectNpkFiles(directory: string, relativePath: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const childRelativePath = win32.join(relativePath, entry.name);
    if (entry.isFile() && isLibraryPatchPath(entry.name)) {
      files.push(childRelativePath);
    } else if (entry.isDirectory()) {
      files.push(...(await collectNpkFiles(win32.join(directory, entry.name), childRelativePath)));
    }
  }
  return files;
}

export function createCategoryDeleteService({
  groups,
  libraryRoot,
  recycleMany,
}: CategoryDeleteOptions): CategoryDeleteService {
  const categories = createCategoryCommands(libraryRoot);

  return {
    async remove(request) {
      const removed = await categories.remove({ relativePath: request.relativePath });
      if (removed.ok || removed.error.code !== "CATEGORY_NOT_EMPTY" || !request.confirmed) {
        return removed;
      }

      const target = resolveLibraryPath(libraryRoot, request.relativePath);
      if (!target.ok) return target;

      try {
        const npkPaths = await collectNpkFiles(target.value, request.relativePath);
        const groupMemberPaths = new Set<string>();
        const items: RecycleItem[] = [];
        if (groups !== undefined) {
          const state = await groups.list();
          if (!state.ok) return state;
          for (const group of state.value.groups) {
            if (!isPathWithin(group.categoryRelativePath, request.relativePath)) continue;
            items.push({ kind: "group", groupId: group.id });
            for (const member of group.memberRelativePaths) {
              groupMemberPaths.add(pathKey(member));
            }
          }
        }
        items.push(
          ...npkPaths
            .filter((relativePath) => !groupMemberPaths.has(pathKey(relativePath)))
            .map((relativePath) => ({ kind: "patch" as const, relativePath })),
        );

        if (items.length > 0) {
          const recycled = await recycleMany(items);
          if (!recycled.ok) return err(recycled.error);
        }
        return categories.remove({ relativePath: request.relativePath, allowNonEmpty: true });
      } catch (error) {
        if (error instanceof Error) return err({ code: "LIBRARY_IO" });
        throw error;
      }
    },
  };
}

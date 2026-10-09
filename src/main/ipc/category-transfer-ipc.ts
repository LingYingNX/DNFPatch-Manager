import { win32 } from "node:path";
import { ipcMain } from "electron";
import { createCategoryCommands } from "../../core/library/category-commands";
import type { CategoryOrderService } from "../../core/library/category-order-service";
import type { CategoryStyleService } from "../../core/library/category-style-service";
import { importPatches } from "../../core/library/import-patches";
import {
  CategoryOrderRequestSchema,
  ImportDroppedPatchesRequestSchema,
  IPC_CHANNELS,
  MoveCategoryRequestSchema,
} from "../../shared/ipc-contracts";
import { isVideoPatchPath } from "../../shared/library-patch-extensions";
import { pathKey } from "../../shared/path-key";
import type { AppPaths } from "../app-paths";
import { generateVideoPreviews as defaultGenerateVideoPreviews } from "../library/video-preview-generator";
import { toApiResult } from "./api-result";
import { createValidatedHandler } from "./validated-handler";

/** 导入 BK2 后生成同名缩略图与播放素材；best-effort，失败不影响导入结果。 */
export type VideoPreviewsGenerator = (request: {
  readonly libraryRoot: AppPaths["libraryRoot"];
  readonly relativePaths: readonly string[];
  readonly searchRoots?: readonly string[] | undefined;
}) => Promise<void>;

type CategoryTransferDependencies = {
  readonly categoryOrder: CategoryOrderService;
  readonly paths: AppPaths;
  readonly categoryStyle?: CategoryStyleService;
  readonly generateVideoPreviews?: VideoPreviewsGenerator | undefined;
  /**
   * 额外搜索根：用于发现随应用放置的 `tools/bink2nvenc`（例如解压到程序目录）。
   * 缺省为库根的父目录，即开发模式的工程根 / 便携模式的 exe 目录。
   */
  readonly videoToolRoots?: readonly string[] | undefined;
};

export function registerCategoryTransferIpc({
  categoryOrder,
  paths,
  categoryStyle,
  generateVideoPreviews: generatePreviews = defaultGenerateVideoPreviews,
  videoToolRoots,
}: CategoryTransferDependencies): void {
  const categories = createCategoryCommands(paths.libraryRoot);
  // 库根固定为 <应用根>\patch-categories，因此父目录就是应用根。
  const searchRoots = videoToolRoots ?? [win32.dirname(paths.libraryRoot)];

  ipcMain.removeHandler(IPC_CHANNELS.importDroppedPatches);
  const importDropped = createValidatedHandler(
    ImportDroppedPatchesRequestSchema,
    async (request) => {
      const result = await importPatches({
        libraryRoot: paths.libraryRoot,
        categoryRelativePath: request.categoryRelativePath,
        sourcePaths: request.sourcePaths,
      });
      if (!result.ok) return toApiResult(result);

      const videoRelativePaths = result.value.importedRelativePaths.filter((relativePath) =>
        isVideoPatchPath(relativePath),
      );
      if (videoRelativePaths.length > 0) {
        try {
          await generatePreviews({
            libraryRoot: paths.libraryRoot,
            relativePaths: videoRelativePaths,
            searchRoots,
          });
        } catch {
          // 生成预览是尽力而为：转换器缺失或失败都不应让导入失败。
        }
      }

      return {
        ok: true,
        value: {
          importedCount: result.value.importedRelativePaths.length,
          duplicateCount: result.value.duplicateRelativePaths.length,
        },
      };
    },
  );
  ipcMain.handle(IPC_CHANNELS.importDroppedPatches, (_event, input: unknown) =>
    importDropped(input),
  );

  ipcMain.removeHandler(IPC_CHANNELS.setCategoryOrder);
  const setOrder = createValidatedHandler(CategoryOrderRequestSchema, async (request) => {
    const result = await categoryOrder.set(
      request.parentRelativePath,
      request.orderedChildRelativePaths,
    );
    return result.ok
      ? { ok: true, value: { orderedCount: request.orderedChildRelativePaths.length } }
      : toApiResult(result);
  });
  ipcMain.handle(IPC_CHANNELS.setCategoryOrder, (_event, input: unknown) => setOrder(input));

  ipcMain.removeHandler(IPC_CHANNELS.moveCategory);
  const moveCategory = createValidatedHandler(MoveCategoryRequestSchema, async (request) => {
    const sourceRelativePath = request.sourceRelativePath.replaceAll("/", "\\");
    const sourceParentRelativePath = win32.dirname(sourceRelativePath);
    const normalizedSourceParent = sourceParentRelativePath === "." ? "" : sourceParentRelativePath;
    const targetRelativePath = win32.join(
      request.targetParentRelativePath,
      win32.basename(sourceRelativePath),
    );
    const targetAtIndex = request.targetParentChildRelativePaths[request.targetIndex];
    if (
      pathKey(normalizedSourceParent) !== pathKey(request.sourceParentRelativePath) ||
      request.sourceParentChildRelativePaths.some(
        (path) => pathKey(path) === pathKey(sourceRelativePath),
      ) ||
      targetAtIndex === undefined ||
      pathKey(targetAtIndex) !== pathKey(targetRelativePath)
    ) {
      return { ok: false, error: { code: "INVALID_INPUT", message: "请求参数无效" } };
    }

    const moved = await categories.move({
      sourceRelativePath,
      targetParentRelativePath: request.targetParentRelativePath,
    });
    if (!moved.ok) return toApiResult(moved);
    const movedRelativePath = moved.value.relativePath;
    const order = await categoryOrder.move({
      sourceRelativePath,
      targetRelativePath: movedRelativePath,
      sourceParentRelativePath: request.sourceParentRelativePath,
      sourceParentChildRelativePaths: request.sourceParentChildRelativePaths,
      targetParentRelativePath: request.targetParentRelativePath,
      targetParentChildRelativePaths: request.targetParentChildRelativePaths,
    });
    const rollback = async (): Promise<void> => {
      await categories.move({
        sourceRelativePath: movedRelativePath,
        targetParentRelativePath: request.sourceParentRelativePath,
      });
    };
    if (!order.ok) {
      await rollback();
      return toApiResult(order);
    }
    if (categoryStyle !== undefined) {
      const styles = await categoryStyle.relocate(sourceRelativePath, movedRelativePath);
      if (!styles.ok) {
        await rollback();
        await categoryOrder.move({
          sourceRelativePath: movedRelativePath,
          targetRelativePath: sourceRelativePath,
          sourceParentRelativePath: request.targetParentRelativePath,
          sourceParentChildRelativePaths: request.targetParentChildRelativePaths,
          targetParentRelativePath: request.sourceParentRelativePath,
          targetParentChildRelativePaths: request.sourceParentChildRelativePaths,
        });
        return toApiResult(styles);
      }
    }
    return { ok: true, value: moved.value };
  });
  ipcMain.handle(IPC_CHANNELS.moveCategory, (_event, input: unknown) => moveCategory(input));
}

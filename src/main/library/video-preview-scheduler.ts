import { isVideoPatchPath } from "../../shared/library-patch-extensions";
import type { LibraryRoot } from "../app-paths";
import {
  type ConverterRunner,
  generateVideoPreview,
  resolveVideoPreviewTools,
  type VideoPreviewTools,
} from "./video-preview-generator";

/**
 * 扫描期补生成 BK2 预览的调度器。
 *
 * 用户既可能用拖入导入补丁，也可能直接把 `.bk2` 复制进 `patch-categories`；后者不经过
 * 导入 IPC，因此只在导入时生成预览会漏掉这类文件。这里挂在扫描之后：发现缺预览的
 * `.bk2` 就后台补生成，完成后通知渲染进程刷新。
 *
 * 三条约束：
 * - 绝不阻塞扫描返回（`schedule` 返回 void，转换在后台串行执行）。
 * - 同一路径本进程内只尝试一次，避免每次导航都重跑约 3 秒的转换。
 * - 检测不到转换器时不记入「已尝试」，装上工具后下一次扫描即可生效。
 */

export type VideoPreviewCandidate = {
  readonly relativePath: string;
  readonly previewRelativePath: string | null;
  readonly videoPreviewUrl?: string | null | undefined;
};

/** 挑出既是 BK2、又缺封面或缺播放素材的补丁。 */
export function collectMissingVideoPreviews(
  patches: readonly VideoPreviewCandidate[],
): readonly string[] {
  const missing: string[] = [];
  for (const patch of patches) {
    if (!isVideoPatchPath(patch.relativePath)) continue;
    const hasPlayback = patch.videoPreviewUrl !== null && patch.videoPreviewUrl !== undefined;
    const hasCover = patch.previewRelativePath !== null;
    if (hasPlayback && hasCover) continue;
    missing.push(patch.relativePath);
  }
  return missing;
}

export type VideoPreviewSchedulerOptions = {
  readonly libraryRoot: LibraryRoot;
  /** 额外搜索根，通常是应用根目录（库根的上一级）。 */
  readonly searchRoots?: readonly string[] | undefined;
  /** 生成成功后的回调，用于通知渲染进程刷新。 */
  readonly onGenerated: (relativePaths: readonly string[]) => void;
  readonly runner?: ConverterRunner | undefined;
  readonly resolveTools?: (() => Promise<VideoPreviewTools>) | undefined;
  readonly generate?: typeof generateVideoPreview | undefined;
};

export type VideoPreviewScheduler = {
  schedule(relativePaths: readonly string[]): void;
};

export function createVideoPreviewScheduler(
  options: VideoPreviewSchedulerOptions,
): VideoPreviewScheduler {
  const attempted = new Set<string>();
  const inFlight = new Set<string>();
  let toolsPromise: Promise<VideoPreviewTools> | null = null;
  let queue: Promise<void> = Promise.resolve();
  const resolveTools =
    options.resolveTools ?? (() => resolveVideoPreviewTools(options.searchRoots ?? []));
  const generate = options.generate ?? generateVideoPreview;

  async function run(pending: readonly string[]): Promise<void> {
    let tools: VideoPreviewTools;
    try {
      toolsPromise ??= resolveTools();
      tools = await toolsPromise;
    } catch {
      toolsPromise = null;
      for (const relativePath of pending) inFlight.delete(relativePath);
      return;
    }
    if (tools.nvenc === null && tools.radVideo === null) {
      // 没有可用转换器时不缓存探测结果、也不记入已尝试：装上工具后下一次扫描还会再触发。
      toolsPromise = null;
      for (const relativePath of pending) inFlight.delete(relativePath);
      return;
    }

    const generated: string[] = [];
    for (const relativePath of pending) {
      try {
        const result = await generate({
          libraryRoot: options.libraryRoot,
          relativePath,
          tools,
          ...(options.runner === undefined ? {} : { runner: options.runner }),
        });
        if (result.coverRelativePath !== null || result.playbackRelativePath !== null) {
          generated.push(relativePath);
        }
      } catch {
        // best-effort：单个文件失败不影响同批其余补生成。
      } finally {
        attempted.add(relativePath);
        inFlight.delete(relativePath);
      }
    }
    if (generated.length > 0) options.onGenerated(generated);
  }

  return {
    schedule(relativePaths) {
      const pending = relativePaths.filter(
        (relativePath) => !attempted.has(relativePath) && !inFlight.has(relativePath),
      );
      if (pending.length === 0) return;
      for (const relativePath of pending) inFlight.add(relativePath);
      // 全局串行：转换器进程可能驻留，不允许两批并发。
      queue = queue.then(() => run(pending)).catch(() => undefined);
    },
  };
}

import { z } from "zod";

/**
 * 主进程向渲染进程推送的「补丁库媒体已变化」事件。
 *
 * 目前只有一个来源：扫描后发现缺预览的 BK2 被后台补生成完成，渲染进程需要重新
 * 扫描才能拿到新的 `videoPreviewUrl`。事件只带受影响的相对路径，不携带 URL，
 * 避免主进程替渲染进程决定资源定位方式。
 */
export const LibraryChangedEventSchema = z.object({
  kind: z.literal("video-previews-generated"),
  relativePaths: z.array(z.string().min(1)).min(1),
});
export type LibraryChangedEvent = z.infer<typeof LibraryChangedEventSchema>;

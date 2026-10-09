/**
 * 自定义协议的 scheme 名与特权声明。
 *
 * 必须在 `app.whenReady()` 之前交给 `protocol.registerSchemesAsPrivileged`，
 * 否则渲染进程不会把这些 scheme 当作可加载的 URL 来源。
 *
 * 独立成不依赖 electron 的模块：scheme 名与特权内容可以被单测直接断言，
 * 也能让 CSP（`src/renderer/index.html`）与这里保持同一个来源。
 */

export const ASSET_SCHEME = "dnf-asset";
export const LIBRARY_SCHEME = "dnf-library";

/** 静态图片资源：只需被当作安全来源并可 fetch。 */
export const ASSET_SCHEME_PRIVILEGES = {
  secure: true,
  standard: true,
  supportFetchAPI: true,
} as const;

/**
 * 库预览资源（图片与视频共用）。
 *
 * 实测（Electron 主进程探针，对一个 `video/mp4` 响应）：
 * - `stream: true` 对 `<video>` 播放**不是必需的**：不带该特权时同样能
 *   `loadedmetadata` → `playing` 并播完，`Range` / 206 也照常工作。
 * - 真正拦下播放的是 CSP：`media-src` 未列出该 scheme 时，`<video>` 报
 *   `MEDIA_ELEMENT_ERROR: Media load rejected by URL safety check`，元素渲染出来
 *   但永远拿不到帧（表现为悬停时一个黑框）。
 *
 * 因此这里只保留必要特权，CSP 侧由 `tests/unit/media-scheme-contracts.test.ts` 守护。
 */
export const LIBRARY_SCHEME_PRIVILEGES = {
  secure: true,
  standard: true,
  supportFetchAPI: true,
} as const;

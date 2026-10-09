import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { libraryPreviewUrl } from "../../src/core/library/library-preview";
import {
  ASSET_SCHEME_PRIVILEGES,
  LIBRARY_SCHEME,
  LIBRARY_SCHEME_PRIVILEGES,
} from "../../src/main/library-schemes";

const projectRoot = resolve(import.meta.dirname, "../..");

/** 从 renderer 的 index.html 里取出 CSP meta 的 content。 */
async function readContentSecurityPolicy(): Promise<string> {
  const html = await readFile(resolve(projectRoot, "src/renderer/index.html"), "utf8");
  const match = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/u.exec(html);
  if (match?.[1] === undefined) throw new Error("CSP meta tag not found");
  return match[1];
}

function directive(policy: string, name: string): string | null {
  const found = policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));
  return found ?? null;
}

describe("renderer media loading contracts", () => {
  it("allows the library scheme in media-src so hover playback is not blocked", async () => {
    // 回归：`media-src` 未列出 dnf-library: 时，<video> 报
    // `MEDIA_ELEMENT_ERROR: Media load rejected by URL safety check`，元素渲染出来
    // 但永远没有帧，表现为卡片悬停时一个黑框。
    const policy = await readContentSecurityPolicy();
    const mediaSrc = directive(policy, "media-src");
    expect(mediaSrc).not.toBeNull();
    expect(mediaSrc).toContain(`${LIBRARY_SCHEME}:`);
    expect(mediaSrc).toContain("'self'");
  });

  it("keeps the scheme used by preview URLs aligned with the privileged scheme", () => {
    const url = libraryPreviewUrl("88\\clip.mp4");
    expect(url.startsWith(`${LIBRARY_SCHEME}://`)).toBe(true);
  });

  it("declares only the privileges that were measured to be necessary", () => {
    // 实测：不带 stream 特权时 <video> 仍能 playing 并播完，Range/206 也正常。
    // 若有人凭直觉把 stream 加回来，这里会失败并指向 library-schemes.ts 的证据注释。
    expect(LIBRARY_SCHEME_PRIVILEGES).not.toHaveProperty("stream");
    expect(ASSET_SCHEME_PRIVILEGES).not.toHaveProperty("stream");
    expect(LIBRARY_SCHEME_PRIVILEGES.standard).toBe(true);
    expect(LIBRARY_SCHEME_PRIVILEGES.supportFetchAPI).toBe(true);
  });
});

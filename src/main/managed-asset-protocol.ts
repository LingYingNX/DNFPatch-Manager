import { open, readFile } from "node:fs/promises";
import { win32 } from "node:path";
import { protocol } from "electron";
import { resolveManagedAssetUrl } from "../core/assets/managed-image-assets";
import { parseByteRange, statLibraryPreviewFile } from "../core/library/library-preview";
import type { AppPaths } from "./app-paths";
import {
  ASSET_SCHEME,
  ASSET_SCHEME_PRIVILEGES,
  LIBRARY_SCHEME,
  LIBRARY_SCHEME_PRIVILEGES,
} from "./library-schemes";

protocol.registerSchemesAsPrivileged([
  { scheme: ASSET_SCHEME, privileges: ASSET_SCHEME_PRIVILEGES },
  { scheme: LIBRARY_SCHEME, privileges: LIBRARY_SCHEME_PRIVILEGES },
]);

export function registerManagedAssetProtocol(paths: AppPaths): void {
  const roots = {
    previewRoot: win32.join(paths.dataRoot, "previews"),
    wallpaperRoot: win32.join(paths.dataRoot, "wallpapers"),
  };
  protocol.handle(ASSET_SCHEME, async (request) => {
    const resolved = resolveManagedAssetUrl(roots, request.url);
    if (!resolved.ok) return new Response(null, { status: 404 });
    try {
      const extension = win32.extname(resolved.value).slice(1).toLocaleLowerCase();
      const mime = extension === "jpg" ? "jpeg" : extension;
      return new Response(await readFile(resolved.value), {
        headers: { "Content-Type": `image/${mime}` },
      });
    } catch (error) {
      if (error instanceof Error) return new Response(null, { status: 404 });
      throw error;
    }
  });
}

export function registerLibraryPreviewProtocol(paths: AppPaths): void {
  protocol.handle(LIBRARY_SCHEME, async (request) => {
    const info = await statLibraryPreviewFile(paths.libraryRoot, request.url);
    if (!info.ok) return new Response(null, { status: 404 });

    const { absolutePath, size, contentType } = info.value;
    const range = parseByteRange(request.headers.get("range"), size);
    if (range !== null && !range.ok) {
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }

    try {
      if (range === null) {
        // Still images and small files keep the plain 200 response.
        return new Response(new Uint8Array(await readFile(absolutePath)), {
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(size),
            "Accept-Ranges": "bytes",
          },
        });
      }

      const { start, end } = range.value;
      const length = end - start + 1;
      const handle = await open(absolutePath, "r");
      try {
        const buffer = Buffer.allocUnsafe(length);
        await handle.read(buffer, 0, length, start);
        return new Response(new Uint8Array(buffer), {
          status: 206,
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(length),
            "Content-Range": `bytes ${start}-${end}/${size}`,
            "Accept-Ranges": "bytes",
          },
        });
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (error instanceof Error) return new Response(null, { status: 404 });
      throw error;
    }
  });
}

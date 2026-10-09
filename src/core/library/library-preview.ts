import { copyFile, readdir, readFile, rm, stat } from "node:fs/promises";
import { win32 } from "node:path";
import type { LibraryRoot } from "../../main/app-paths";
import { err, ok, type Result } from "../../shared/result";
import { type LibraryPathError, resolveLibraryPath } from "../paths/library-path";

/** Extensions accepted for still previews, both auto-matched and manually picked. */
export const LIBRARY_IMAGE_PREVIEW_EXTENSIONS = new Set([
  ".bmp",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp",
]);

/** Extensions accepted for hover-played preview media (videos only, never stills). */
export const LIBRARY_VIDEO_PREVIEW_EXTENSIONS = new Set([".mp4", ".webm"]);

/**
 * Still-preview extension set kept under its historical name: callers that bind a
 * same-named file to a patch or group, and the manual preview picker, must stay image-only.
 */
export const LIBRARY_PREVIEW_EXTENSIONS = LIBRARY_IMAGE_PREVIEW_EXTENSIONS;

/** Everything the dnf-library protocol may serve: stills plus hover videos. */
export const LIBRARY_MEDIA_PREVIEW_EXTENSIONS = new Set([
  ...LIBRARY_IMAGE_PREVIEW_EXTENSIONS,
  ...LIBRARY_VIDEO_PREVIEW_EXTENSIONS,
]);

export type LibraryPreviewError =
  | LibraryPathError
  | { readonly code: "UNSUPPORTED_IMAGE" }
  | { readonly code: "LIBRARY_IO"; readonly relativePath: string };

export type LibraryPreviewUrlError = {
  readonly code: "LIBRARY_PREVIEW_URL_INVALID";
};

export type LibraryPreviewReadError =
  | LibraryPreviewUrlError
  | { readonly code: "LIBRARY_PREVIEW_NOT_FOUND" };

export type CopyLibraryPreviewRequest = {
  readonly libraryRoot: LibraryRoot;
  readonly kind: "patch" | "group";
  readonly relativePath: string;
  readonly sourcePath: string;
};

function itemBaseName(kind: CopyLibraryPreviewRequest["kind"], relativePath: string): string {
  const itemName = win32.basename(relativePath);
  return kind === "patch" ? win32.basename(itemName, win32.extname(itemName)) : itemName;
}

export function findMatchingPreview(fileNames: readonly string[], baseName: string): string | null {
  const normalizedBaseName = baseName.toLocaleLowerCase();
  return (
    fileNames.find((name) => {
      const extension = win32.extname(name).toLocaleLowerCase();
      return (
        LIBRARY_PREVIEW_EXTENSIONS.has(extension) &&
        win32.basename(name, win32.extname(name)).toLocaleLowerCase() === normalizedBaseName
      );
    }) ?? null
  );
}

/**
 * Every same-named media file for a patch base name: still previews plus hover videos.
 *
 * Callers that move, recycle or delete a patch must go through this instead of
 * `findMatchingPreview`, otherwise the companion MP4 survives the patch it belongs to
 * and keeps being served for a file that no longer exists.
 */
export function findMatchingMediaPreviews(
  fileNames: readonly string[],
  baseName: string,
): readonly string[] {
  const normalizedBaseName = baseName.toLocaleLowerCase();
  return fileNames
    .filter((name) => {
      const extension = win32.extname(name).toLocaleLowerCase();
      return (
        LIBRARY_MEDIA_PREVIEW_EXTENSIONS.has(extension) &&
        win32.basename(name, win32.extname(name)).toLocaleLowerCase() === normalizedBaseName
      );
    })
    .sort();
}

export function libraryPreviewUrl(relativePath: string, version?: bigint): string {
  const suffix = version === undefined ? "" : `?v=${encodeURIComponent(String(version))}`;
  return `dnf-library://library/${encodeURIComponent(relativePath.replaceAll("/", "\\"))}${suffix}`;
}

export function resolveLibraryPreviewUrl(
  libraryRoot: LibraryRoot,
  value: string,
): Result<string, LibraryPreviewUrlError> {
  try {
    const url = new URL(value);
    const version = url.searchParams.get("v");
    if (
      url.protocol !== "dnf-library:" ||
      url.hostname !== "library" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      (url.search !== "" &&
        (url.searchParams.size !== 1 || version === null || !/^\d+$/u.test(version))) ||
      url.hash !== ""
    ) {
      return err({ code: "LIBRARY_PREVIEW_URL_INVALID" });
    }

    const encodedPath = url.pathname.slice(1);
    if (encodedPath === "" || encodedPath.includes("/")) {
      return err({ code: "LIBRARY_PREVIEW_URL_INVALID" });
    }
    const relativePath = decodeURIComponent(encodedPath);
    const extension = win32.extname(relativePath).toLocaleLowerCase();
    if (!LIBRARY_MEDIA_PREVIEW_EXTENSIONS.has(extension)) {
      return err({ code: "LIBRARY_PREVIEW_URL_INVALID" });
    }
    const resolved = resolveLibraryPath(libraryRoot, relativePath);
    return resolved.ok ? ok(resolved.value) : err({ code: "LIBRARY_PREVIEW_URL_INVALID" });
  } catch (error) {
    if (error instanceof Error) return err({ code: "LIBRARY_PREVIEW_URL_INVALID" });
    throw error;
  }
}

export function imageContentType(path: string): string {
  const extension = win32.extname(path).toLocaleLowerCase();
  return extension === ".jpg" || extension === ".jpeg"
    ? "image/jpeg"
    : `image/${extension.slice(1)}`;
}

export function mediaContentType(path: string): string {
  const extension = win32.extname(path).toLocaleLowerCase();
  if (extension === ".mp4") return "video/mp4";
  if (extension === ".webm") return "video/webm";
  return imageContentType(path);
}

export type LibraryPreviewFileInfo = {
  readonly absolutePath: string;
  readonly size: number;
  readonly contentType: string;
};

/** Stats a preview/media URL without reading it, so range requests can be served lazily. */
export async function statLibraryPreviewFile(
  libraryRoot: LibraryRoot,
  value: string,
): Promise<Result<LibraryPreviewFileInfo, LibraryPreviewReadError>> {
  const resolved = resolveLibraryPreviewUrl(libraryRoot, value);
  if (!resolved.ok) return resolved;
  try {
    const metadata = await stat(resolved.value);
    return ok({
      absolutePath: resolved.value,
      size: metadata.size,
      contentType: mediaContentType(resolved.value),
    });
  } catch (error) {
    if (error instanceof Error) return err({ code: "LIBRARY_PREVIEW_NOT_FOUND" });
    throw error;
  }
}

export type ByteRangeError = { readonly code: "RANGE_UNSATISFIABLE" };

export type ByteRange = { readonly start: number; readonly end: number };

/**
 * Parses a single `bytes=` request range.
 * Returns `null` when there is no usable range header (caller should answer 200),
 * and an error only for a syntactically valid but unsatisfiable range (416).
 */
export function parseByteRange(
  header: string | null,
  size: number,
): Result<ByteRange, ByteRangeError> | null {
  if (header === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (match === null) return null;
  const [, rawStart = "", rawEnd = ""] = match;
  if (rawStart === "" && rawEnd === "") return null;

  if (rawStart === "") {
    const suffix = Number(rawEnd);
    if (suffix === 0) return err({ code: "RANGE_UNSATISFIABLE" });
    const start = Math.max(0, size - suffix);
    return ok({ start, end: size - 1 });
  }

  const start = Number(rawStart);
  if (start >= size) return err({ code: "RANGE_UNSATISFIABLE" });
  if (rawEnd === "") return ok({ start, end: size - 1 });
  const end = Math.min(Number(rawEnd), size - 1);
  if (end < start) return err({ code: "RANGE_UNSATISFIABLE" });
  return ok({ start, end });
}

export async function readLibraryPreviewFile(
  libraryRoot: LibraryRoot,
  value: string,
): Promise<
  Result<{ readonly data: Buffer; readonly contentType: string }, LibraryPreviewReadError>
> {
  const resolved = resolveLibraryPreviewUrl(libraryRoot, value);
  if (!resolved.ok) return resolved;
  try {
    return ok({
      data: await readFile(resolved.value),
      contentType: mediaContentType(resolved.value),
    });
  } catch (error) {
    if (error instanceof Error) return err({ code: "LIBRARY_PREVIEW_NOT_FOUND" });
    throw error;
  }
}

export async function copyLibraryPreview(
  request: CopyLibraryPreviewRequest,
): Promise<Result<{ readonly previewRelativePath: string }, LibraryPreviewError>> {
  const sourceExtension = win32.extname(request.sourcePath).toLocaleLowerCase();
  if (!LIBRARY_PREVIEW_EXTENSIONS.has(sourceExtension)) {
    return err({ code: "UNSUPPORTED_IMAGE" });
  }

  const directoryRelativePath =
    request.kind === "patch" ? win32.dirname(request.relativePath) : request.relativePath;
  const directory = resolveLibraryPath(request.libraryRoot, directoryRelativePath);
  if (!directory.ok) return directory;

  const baseName = itemBaseName(request.kind, request.relativePath);
  const previewRelativePath = win32.join(directoryRelativePath, `${baseName}${sourceExtension}`);
  const target = resolveLibraryPath(request.libraryRoot, previewRelativePath);
  if (!target.ok) return target;
  const targetName = win32.basename(previewRelativePath).toLocaleLowerCase();

  try {
    await copyFile(request.sourcePath, target.value);
    const entries = await readdir(directory.value, { withFileTypes: true });
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.isFile() &&
            entry.name.toLocaleLowerCase() !== targetName &&
            findMatchingPreview([entry.name], baseName) !== null,
        )
        .map((entry) => rm(win32.join(directory.value, entry.name), { force: true })),
    );
    return ok({ previewRelativePath });
  } catch (error) {
    if (error instanceof Error) {
      return err({ code: "LIBRARY_IO", relativePath: request.relativePath });
    }
    throw error;
  }
}

import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  libraryPreviewUrl,
  parseByteRange,
  readLibraryPreviewFile,
  resolveLibraryPreviewUrl,
  statLibraryPreviewFile,
} from "../../src/core/library/library-preview";
import { resolveAppPaths } from "../../src/main/app-paths";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("library preview protocol", () => {
  it("creates and resolves a safe library preview URL", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "dnf-library-protocol-"));
    temporaryDirectories.push(projectRoot);
    const { libraryRoot } = resolveAppPaths({ mode: "development", projectRoot });
    await mkdir(join(libraryRoot, "Armor"), { recursive: true });

    const url = libraryPreviewUrl("Armor\\A.png");

    expect(url).toBe("dnf-library://library/Armor%5CA.png");
    expect(resolveLibraryPreviewUrl(libraryRoot, url)).toEqual({
      ok: true,
      value: join(libraryRoot, "Armor", "A.png"),
    });

    const versionedUrl = libraryPreviewUrl("Armor\\A.png", 123456789n);
    expect(versionedUrl).toBe("dnf-library://library/Armor%5CA.png?v=123456789");
    expect(resolveLibraryPreviewUrl(libraryRoot, versionedUrl)).toEqual({
      ok: true,
      value: join(libraryRoot, "Armor", "A.png"),
    });
  });

  it("rejects traversal, absolute paths, query strings, hashes, and unsupported extensions", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "dnf-library-protocol-invalid-"));
    temporaryDirectories.push(projectRoot);
    const { libraryRoot } = resolveAppPaths({ mode: "development", projectRoot });

    const invalidUrls = [
      "dnf-library://library/..%5Csecret.png",
      "dnf-library://library/C%3A%5Csecret.png",
      "dnf-library://library/Armor%5CA.png?download=1",
      "dnf-library://library/Armor%5CA.png?v=1.5",
      "dnf-library://library/Armor%5CA.png?v=1&v=2",
      "dnf-library://library/Armor%5CA.png#preview",
      "dnf-library://library/Armor/A.png",
      "dnf-library://library/Armor%5CA.txt",
      "dnf-library://library/Armor%5Cclip.bk2",
      "dnf-asset://preview/A.png",
    ];

    for (const url of invalidUrls) {
      expect(resolveLibraryPreviewUrl(libraryRoot, url)).toEqual({
        ok: false,
        error: { code: "LIBRARY_PREVIEW_URL_INVALID" },
      });
    }
  });

  it("reads an existing image and rejects a missing image", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "dnf-library-protocol-read-"));
    temporaryDirectories.push(projectRoot);
    const { libraryRoot } = resolveAppPaths({ mode: "development", projectRoot });
    const category = join(libraryRoot, "Armor");
    await mkdir(category, { recursive: true });
    await writeFile(join(category, "A.jpg"), "preview bytes");

    const existing = await readLibraryPreviewFile(libraryRoot, libraryPreviewUrl("Armor\\A.jpg"));
    expect(existing.ok).toBe(true);
    if (existing.ok) {
      expect(existing.value.contentType).toBe("image/jpeg");
      expect(existing.value.data.toString("utf8")).toBe("preview bytes");
    }

    await expect(
      readLibraryPreviewFile(libraryRoot, libraryPreviewUrl("Armor\\Missing.png")),
    ).resolves.toEqual({
      ok: false,
      error: { code: "LIBRARY_PREVIEW_NOT_FOUND" },
    });
    await expect(access(join(category, "A.jpg"))).resolves.toBeUndefined();
  });

  it("stats a video preview and reports its media content type", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "dnf-library-protocol-stat-"));
    temporaryDirectories.push(projectRoot);
    const { libraryRoot } = resolveAppPaths({ mode: "development", projectRoot });
    const category = join(libraryRoot, "88");
    await mkdir(category, { recursive: true });
    await writeFile(join(category, "clip.mp4"), "0123456789");

    await expect(
      statLibraryPreviewFile(libraryRoot, libraryPreviewUrl("88\\clip.mp4")),
    ).resolves.toEqual({
      ok: true,
      value: {
        absolutePath: join(category, "clip.mp4"),
        size: 10,
        contentType: "video/mp4",
      },
    });

    await expect(
      statLibraryPreviewFile(libraryRoot, libraryPreviewUrl("88\\missing.mp4")),
    ).resolves.toEqual({ ok: false, error: { code: "LIBRARY_PREVIEW_NOT_FOUND" } });
  });

  it("parses satisfiable byte ranges and rejects unsatisfiable ones", () => {
    // Given: a 1000-byte resource.
    const size = 1000;

    // Then: absent and unparsable headers fall back to a full 200 response.
    expect(parseByteRange(null, size)).toBeNull();
    expect(parseByteRange("items=0-10", size)).toBeNull();
    expect(parseByteRange("bytes=", size)).toBeNull();
    expect(parseByteRange("bytes=-", size)).toBeNull();

    // And: bounded, open-ended and suffix ranges resolve to inclusive offsets.
    expect(parseByteRange("bytes=0-99", size)).toEqual({ ok: true, value: { start: 0, end: 99 } });
    expect(parseByteRange("bytes=990-", size)).toEqual({
      ok: true,
      value: { start: 990, end: 999 },
    });
    expect(parseByteRange("bytes=-10", size)).toEqual({
      ok: true,
      value: { start: 990, end: 999 },
    });
    expect(parseByteRange("bytes=0-5000", size)).toEqual({
      ok: true,
      value: { start: 0, end: 999 },
    });

    // And: out-of-bounds or inverted ranges are unsatisfiable (416).
    expect(parseByteRange("bytes=1000-", size)).toEqual({
      ok: false,
      error: { code: "RANGE_UNSATISFIABLE" },
    });
    expect(parseByteRange("bytes=-0", size)).toEqual({
      ok: false,
      error: { code: "RANGE_UNSATISFIABLE" },
    });
    expect(parseByteRange("bytes=50-10", size)).toEqual({
      ok: false,
      error: { code: "RANGE_UNSATISFIABLE" },
    });
  });
});

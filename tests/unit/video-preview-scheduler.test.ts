import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAppPaths } from "../../src/main/app-paths";
import type { VideoPreviewGenerationResult } from "../../src/main/library/video-preview-generator";
import {
  collectMissingVideoPreviews,
  createVideoPreviewScheduler,
  type VideoPreviewCandidate,
} from "../../src/main/library/video-preview-scheduler";

const temporaryDirectories: string[] = [];

type GeneratePreview = (request: {
  readonly relativePath: string;
}) => Promise<VideoPreviewGenerationResult>;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function createLibraryRoot() {
  const projectRoot = await mkdtemp(join(tmpdir(), "dnf-preview-scheduler-"));
  temporaryDirectories.push(projectRoot);
  return resolveAppPaths({ mode: "development", projectRoot }).libraryRoot;
}

function candidate(overrides: Partial<VideoPreviewCandidate> = {}): VideoPreviewCandidate {
  return {
    relativePath: "88\\0A 冰雪女剑buff.bk2",
    previewRelativePath: null,
    videoPreviewUrl: null,
    ...overrides,
  };
}

describe("collectMissingVideoPreviews", () => {
  it("picks BK2 patches that miss a cover or a playback asset", () => {
    const picked = collectMissingVideoPreviews([
      // 缺封面与播放素材：需要补生成。
      candidate({ relativePath: "88\\a.bk2" }),
      // 只有封面，缺播放素材：仍需要补生成。
      candidate({ relativePath: "88\\b.bk2", previewRelativePath: "88\\b.gif" }),
      // 封面与播放素材齐全：跳过。
      candidate({
        relativePath: "88\\c.bk2",
        previewRelativePath: "88\\c.jpg",
        videoPreviewUrl: "dnf-library://library/88%5Cc.mp4",
      }),
      // 非 BK2：跳过。
      candidate({ relativePath: "88\\d.npk" }),
      // videoPreviewUrl 未提供的旧快照同样视为缺播放素材。
      candidate({ relativePath: "88\\e.bk2", previewRelativePath: "88\\e.jpg" }),
    ]);

    expect(picked).toEqual(["88\\a.bk2", "88\\b.bk2", "88\\e.bk2"]);
  });
});

describe("createVideoPreviewScheduler", () => {
  it("generates in the background, reports the results, and never repeats a path", async () => {
    const libraryRoot = await createLibraryRoot();
    const generate = vi.fn<GeneratePreview>(async () => ({
      coverRelativePath: "88\\clip.jpg",
      playbackRelativePath: "88\\clip.mp4",
    }));
    const onGenerated = vi.fn();
    const scheduler = createVideoPreviewScheduler({
      libraryRoot,
      onGenerated,
      generate,
      resolveTools: async () => ({
        nvenc: "C:\\tools\\bink2nvenc.exe",
        radVideo: null,
        ffmpeg: null,
      }),
    });

    // When: the same path shows up in two consecutive scans.
    scheduler.schedule(["88\\clip.bk2"]);
    scheduler.schedule(["88\\clip.bk2"]);
    await vi.waitFor(() => expect(onGenerated).toHaveBeenCalledTimes(1));

    // Then: it converts once and reports the affected path afterwards.
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0]?.[0]).toMatchObject({
      libraryRoot,
      relativePath: "88\\clip.bk2",
    });
    expect(onGenerated).toHaveBeenCalledWith(["88\\clip.bk2"]);

    // And: a later scan does not re-run the conversion.
    scheduler.schedule(["88\\clip.bk2"]);
    await Promise.resolve();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("keeps a path retryable while no converter is installed", async () => {
    const libraryRoot = await createLibraryRoot();
    const generate = vi.fn<GeneratePreview>(async () => ({
      coverRelativePath: null,
      playbackRelativePath: null,
    }));
    let tools = { nvenc: null, radVideo: null, ffmpeg: null } as {
      nvenc: string | null;
      radVideo: string | null;
      ffmpeg: string | null;
    };
    const resolvedTools = vi.fn();
    const onGenerated = vi.fn();
    const scheduler = createVideoPreviewScheduler({
      libraryRoot,
      onGenerated,
      generate,
      resolveTools: async () => {
        resolvedTools();
        return tools;
      },
    });

    // Given: a scan with no converter available.
    scheduler.schedule(["88\\clip.bk2"]);
    await vi.waitFor(() => expect(resolvedTools).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(generate).not.toHaveBeenCalled();
    expect(onGenerated).not.toHaveBeenCalled();

    // When: the user installs the tools and the category is scanned again.
    tools = { nvenc: "C:\\tools\\bink2nvenc.exe", radVideo: null, ffmpeg: null };
    scheduler.schedule(["88\\clip.bk2"]);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1));

    // Then: nothing was reported because the conversion produced no artifact.
    expect(onGenerated).not.toHaveBeenCalled();
  });

  it("ignores failures of one file without dropping the rest of the batch", async () => {
    const libraryRoot = await createLibraryRoot();
    const generate = vi.fn<GeneratePreview>(async (request) => {
      if (request.relativePath === "88\\broken.bk2") throw new Error("converter crashed");
      return { coverRelativePath: "88\\ok.jpg", playbackRelativePath: null };
    });
    const onGenerated = vi.fn();
    const scheduler = createVideoPreviewScheduler({
      libraryRoot,
      onGenerated,
      generate,
      resolveTools: async () => ({
        nvenc: "C:\\tools\\bink2nvenc.exe",
        radVideo: null,
        ffmpeg: null,
      }),
    });

    scheduler.schedule(["88\\broken.bk2", "88\\ok.bk2"]);

    await vi.waitFor(() => expect(onGenerated).toHaveBeenCalledWith(["88\\ok.bk2"]));
    expect(generate).toHaveBeenCalledTimes(2);
  });
});

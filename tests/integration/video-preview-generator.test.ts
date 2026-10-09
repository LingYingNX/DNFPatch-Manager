import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LibraryRoot } from "../../src/main/app-paths";
import { resolveAppPaths } from "../../src/main/app-paths";
import {
  binkConverterArgs,
  type ConverterInvocation,
  generateVideoPreview,
  readBink2Header,
  resolveVideoPreviewTools,
} from "../../src/main/library/video-preview-generator";

/** 构造最小 KB2 头部：魔数 + 帧数(u8@8) + 宽/高/帧率(u32LE@20/24/28)。 */
function buildBk2Bytes(options: {
  readonly frameCount: number;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
}): Buffer {
  const buffer = Buffer.alloc(64);
  buffer.write("KB2n", 0, "latin1");
  buffer.writeUInt8(options.frameCount, 8);
  buffer.writeUInt32LE(options.width, 20);
  buffer.writeUInt32LE(options.height, 24);
  buffer.writeUInt32LE(options.frameRate, 28);
  return buffer;
}

const temporaryDirectories: string[] = [];

/**
 * 假执行器：把产物写到该次调用请求的输出文件。
 * 输出总是最后一个 `.jpg` / `.mp4` 参数（前面的可能是输入文件），因此从尾部找。
 */
function writeRequestedArtifact(
  invocations: ConverterInvocation[],
): (invocation: ConverterInvocation) => Promise<string | null> {
  return async (invocation) => {
    invocations.push(invocation);
    let target: string | undefined;
    for (let index = invocation.args.length - 1; index >= 0; index -= 1) {
      const arg = invocation.args[index];
      if (arg !== undefined && /\.(?:jpg|mp4)$/iu.test(arg)) {
        target = arg;
        break;
      }
    }
    if (target === undefined) return null;
    await writeFile(target, "artifact");
    return target;
  };
}

/** 判断一个 Windows 路径是否只含可打印 ASCII（0x20–0x7E）。 */
function isAsciiPath(value: string): boolean {
  return /^[\x20-\x7e]*$/u.test(value);
}

async function createLibrary(): Promise<{
  readonly libraryRoot: LibraryRoot;
  readonly category: string;
}> {
  const projectRoot = await mkdtemp(join(tmpdir(), "dnf-video-preview-"));
  temporaryDirectories.push(projectRoot);
  const { libraryRoot } = resolveAppPaths({ mode: "development", projectRoot });
  const category = win32.join(libraryRoot, "88");
  await mkdir(category, { recursive: true });
  return { libraryRoot, category };
}

function restoreEnvironment(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("resolveVideoPreviewTools", () => {
  it("honours the environment overrides", async () => {
    const { libraryRoot } = await createLibrary();
    const nvenc = join(libraryRoot, "fake-bink2nvenc.exe");
    const radVideo = join(libraryRoot, "fake-radvideo64.exe");
    const ffmpeg = join(libraryRoot, "fake-ffmpeg.exe");
    await Promise.all([
      writeFile(nvenc, "stub"),
      writeFile(radVideo, "stub"),
      writeFile(ffmpeg, "stub"),
    ]);

    const previous = {
      nvenc: process.env["DNF_BINK2NVENC"],
      radVideo: process.env["DNF_RADVIDEO"],
      ffmpeg: process.env["DNF_FFMPEG"],
    };
    process.env["DNF_BINK2NVENC"] = nvenc;
    process.env["DNF_RADVIDEO"] = radVideo;
    process.env["DNF_FFMPEG"] = ffmpeg;
    try {
      const tools = await resolveVideoPreviewTools();
      expect(tools).toEqual({ nvenc, radVideo, ffmpeg });
    } finally {
      restoreEnvironment("DNF_BINK2NVENC", previous.nvenc);
      restoreEnvironment("DNF_RADVIDEO", previous.radVideo);
      restoreEnvironment("DNF_FFMPEG", previous.ffmpeg);
    }
  });

  it("finds a bundled tool directory below the given search root", async () => {
    const { libraryRoot } = await createLibrary();
    const appRoot = await mkdtemp(join(tmpdir(), "dnf-video-tools-"));
    temporaryDirectories.push(appRoot);
    const toolsDirectory = join(appRoot, "tools", "bink2nvenc");
    await mkdir(toolsDirectory, { recursive: true });
    await Promise.all([
      writeFile(join(toolsDirectory, "bink2nvenc.exe"), "stub"),
      writeFile(join(toolsDirectory, "radvideo64.exe"), "stub"),
    ]);

    const previous = {
      nvenc: process.env["DNF_BINK2NVENC"],
      radVideo: process.env["DNF_RADVIDEO"],
      ffmpeg: process.env["DNF_FFMPEG"],
    };
    delete process.env["DNF_BINK2NVENC"];
    delete process.env["DNF_RADVIDEO"];
    delete process.env["DNF_FFMPEG"];
    try {
      const tools = await resolveVideoPreviewTools([appRoot]);
      expect(tools.nvenc).toBe(join(toolsDirectory, "bink2nvenc.exe"));
      // radvideo64.exe 与 nvenc 同目录，应当被顺带找到。
      expect(tools.radVideo).toBe(join(toolsDirectory, "radvideo64.exe"));
    } finally {
      restoreEnvironment("DNF_BINK2NVENC", previous.nvenc);
      restoreEnvironment("DNF_RADVIDEO", previous.radVideo);
      restoreEnvironment("DNF_FFMPEG", previous.ffmpeg);
    }
    expect(libraryRoot).toBeDefined();
  });

  it("ignores an environment override that does not point at a file", async () => {
    const previousNvenc = process.env["DNF_BINK2NVENC"];
    process.env["DNF_BINK2NVENC"] = join(tmpdir(), "definitely-missing-bink2nvenc.exe");
    try {
      const tools = await resolveVideoPreviewTools();
      expect(tools.nvenc).not.toBe(process.env["DNF_BINK2NVENC"]);
    } finally {
      restoreEnvironment("DNF_BINK2NVENC", previousNvenc);
    }
  });
});

describe("readBink2Header", () => {
  it("reads frame count, size and frame rate from the KB2n header", async () => {
    const { libraryRoot } = await createLibrary();
    const sample = join(libraryRoot, "sample.bk2");
    await writeFile(
      sample,
      buildBk2Bytes({ frameCount: 63, width: 970, height: 668, frameRate: 60 }),
    );

    await expect(readBink2Header(sample)).resolves.toEqual({
      frameCount: 63,
      width: 970,
      height: 668,
      frameRate: 60,
    });
  });

  it("returns null for a file that is not a KB2n container", async () => {
    const { libraryRoot } = await createLibrary();
    const sample = join(libraryRoot, "not-bk2.bk2");
    await writeFile(sample, Buffer.alloc(64, 0x41));

    await expect(readBink2Header(sample)).resolves.toBeNull();
  });
});

describe("binkConverterArgs", () => {
  it("prepends the BinkConv subcommand for the official dispatcher", () => {
    expect(binkConverterArgs("C:\\RAD Gametools\\radvideo64.exe", ["in.bk2"])).toEqual([
      "BinkConv",
      "in.bk2",
    ]);
  });

  it("passes arguments through for a standalone binkconv.exe", () => {
    expect(binkConverterArgs("C:\\tools\\binkconv.exe", ["in.bk2"])).toEqual(["in.bk2"]);
  });
});

describe("generateVideoPreview", () => {
  it("encodes the playback MP4 at full resolution with the highest quality preset", async () => {
    const { libraryRoot, category } = await createLibrary();
    await writeFile(
      win32.join(category, "0A 冰雪女剑buff.bk2"),
      buildBk2Bytes({ frameCount: 63, width: 970, height: 668, frameRate: 60 }),
    );

    const invocations: ConverterInvocation[] = [];
    const result = await generateVideoPreview({
      libraryRoot,
      relativePath: "88\\0A 冰雪女剑buff.bk2",
      tools: { nvenc: "C:\\tools\\bink2nvenc.exe", radVideo: null, ffmpeg: null },
      runner: writeRequestedArtifact(invocations),
    });

    expect(result).toEqual({
      coverRelativePath: null,
      playbackRelativePath: "88\\0A 冰雪女剑buff.mp4",
    });
    const encode = invocations[0];
    expect(encode?.executable).toBe("C:\\tools\\bink2nvenc.exe");
    // 最高的预设与最低的量化值，且绝不能带 --width/--height（那会把画面缩小）。
    expect(encode?.args).toContain("p7");
    expect(encode?.args).toContain("--cq");
    expect(encode?.args).toContain("1");
    expect(encode?.args).not.toContain("--width");
    expect(encode?.args).not.toContain("--height");
    // 补丁库路径含中文时 bink2nvenc 打不开，必须走 ASCII 工作目录里的副本。
    const input = encode?.args[0];
    expect(input).toBeDefined();
    expect(input).not.toContain("冰雪");
    expect(isAsciiPath(input ?? "")).toBe(true);
    expect(win32.basename(input ?? "")).toBe("input.bk2");
    expect(win32.basename(win32.dirname(encode?.args[1] ?? ""))).toBe("encode");
    // bink2nvenc 的输出路径同样必须是纯 ASCII，产物名沿用英文固定名。
    const encodeOutput = encode?.args[1] ?? "";
    expect(isAsciiPath(encodeOutput)).toBe(true);
    expect(win32.basename(encodeOutput)).toBe("playback.mp4");
  });

  it("extracts the middle frame as a same-name JPG via the official BinkConv dispatcher", async () => {
    const { libraryRoot, category } = await createLibrary();
    await writeFile(
      win32.join(category, "0A 冰雪女剑buff.bk2"),
      buildBk2Bytes({ frameCount: 63, width: 970, height: 668, frameRate: 60 }),
    );

    const invocations: ConverterInvocation[] = [];
    const result = await generateVideoPreview({
      libraryRoot,
      relativePath: "88\\0A 冰雪女剑buff.bk2",
      tools: { nvenc: null, radVideo: "C:\\RAD Gametools\\radvideo64.exe", ffmpeg: null },
      runner: writeRequestedArtifact(invocations),
    });

    expect(result).toEqual({
      coverRelativePath: "88\\0A 冰雪女剑buff.jpg",
      playbackRelativePath: null,
    });
    const cover = invocations[0];
    expect(cover?.args[0]).toBe("BinkConv");
    // 63 帧的中间帧是第 32 帧（1 基）。
    expect(cover?.args).toContain("/S32");
    expect(cover?.args).toContain("/E32");
    // 封面保持源分辨率，不带缩放开关。
    expect(cover?.args.some((arg) => arg.startsWith("/("))).toBe(false);
    await expect(readFile(win32.join(category, "0A 冰雪女剑buff.jpg"), "utf8")).resolves.toBe(
      "artifact",
    );
  });

  it("produces both artifacts when every tool is available", async () => {
    const { libraryRoot, category } = await createLibrary();
    await writeFile(
      win32.join(category, "clip.bk2"),
      buildBk2Bytes({ frameCount: 10, width: 320, height: 240, frameRate: 30 }),
    );

    const invocations: ConverterInvocation[] = [];
    const result = await generateVideoPreview({
      libraryRoot,
      relativePath: "88\\clip.bk2",
      tools: {
        nvenc: "C:\\tools\\bink2nvenc.exe",
        radVideo: "C:\\RAD Gametools\\radvideo64.exe",
        ffmpeg: "C:\\ffmpeg.exe",
      },
      runner: writeRequestedArtifact(invocations),
    });

    expect(result).toEqual({
      coverRelativePath: "88\\clip.jpg",
      playbackRelativePath: "88\\clip.mp4",
    });
    // 播放素材用 nvenc，封面用 radvideo64，全程不需要 ffmpeg。
    expect(invocations.map((invocation) => win32.basename(invocation.executable))).toEqual([
      "bink2nvenc.exe",
      "radvideo64.exe",
    ]);
  });

  it("falls back to ffmpeg frame extraction when radvideo64 is missing", async () => {
    const { libraryRoot, category } = await createLibrary();
    await writeFile(
      win32.join(category, "clip.bk2"),
      buildBk2Bytes({ frameCount: 10, width: 320, height: 240, frameRate: 30 }),
    );

    const invocations: ConverterInvocation[] = [];
    const result = await generateVideoPreview({
      libraryRoot,
      relativePath: "88\\clip.bk2",
      tools: { nvenc: "C:\\tools\\bink2nvenc.exe", radVideo: null, ffmpeg: "C:\\ffmpeg.exe" },
      runner: writeRequestedArtifact(invocations),
    });

    expect(result).toEqual({
      coverRelativePath: "88\\clip.jpg",
      playbackRelativePath: "88\\clip.mp4",
    });
    const ffmpegCall = invocations.find(
      (invocation) => win32.basename(invocation.executable) === "ffmpeg.exe",
    );
    expect(ffmpegCall?.args).toContain("-frames:v");
  });

  it("produces nothing when no converter can be found", async () => {
    const { libraryRoot, category } = await createLibrary();
    await writeFile(
      win32.join(category, "clip.bk2"),
      buildBk2Bytes({ frameCount: 5, width: 320, height: 240, frameRate: 30 }),
    );

    const result = await generateVideoPreview({
      libraryRoot,
      relativePath: "88\\clip.bk2",
      tools: { nvenc: null, radVideo: null, ffmpeg: "C:\\ffmpeg.exe" },
      runner: async () => {
        throw new Error("the runner must not be reached without a converter");
      },
    });

    expect(result).toEqual({ coverRelativePath: null, playbackRelativePath: null });
  });

  it("stays silent when the converter yields no artifact", async () => {
    const { libraryRoot, category } = await createLibrary();
    await writeFile(
      win32.join(category, "clip.bk2"),
      buildBk2Bytes({ frameCount: 5, width: 320, height: 240, frameRate: 30 }),
    );

    const result = await generateVideoPreview({
      libraryRoot,
      relativePath: "88\\clip.bk2",
      tools: {
        nvenc: "C:\\tools\\bink2nvenc.exe",
        radVideo: "C:\\RAD Gametools\\radvideo64.exe",
        ffmpeg: "C:\\ffmpeg.exe",
      },
      runner: async () => null,
    });

    expect(result).toEqual({ coverRelativePath: null, playbackRelativePath: null });
  });

  it("reports nothing for a path that escapes the library root", async () => {
    const { libraryRoot } = await createLibrary();

    const result = await generateVideoPreview({
      libraryRoot,
      relativePath: "..\\outside.bk2",
      tools: {
        nvenc: "C:\\tools\\bink2nvenc.exe",
        radVideo: "C:\\RAD Gametools\\radvideo64.exe",
        ffmpeg: "C:\\ffmpeg.exe",
      },
      runner: async () => {
        throw new Error("the runner must not be reached for a rejected path");
      },
    });

    expect(result).toEqual({ coverRelativePath: null, playbackRelativePath: null });
  });
});

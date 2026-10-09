import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, open, readdir, rename, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { win32 } from "node:path";
import { resolveLibraryPath } from "../../core/paths/library-path";
import type { LibraryRoot } from "../app-paths";

/**
 * BK2（Bink 2）预览生成：导入补丁后尽力调用用户本机已有的外部工具，生成
 * 同名 JPG 静态封面（中间帧）与同名 MP4（卡片悬停播放）。
 *
 * 刻意不随包分发任何 Bink / FFmpeg 二进制：RAD 官方许可禁止再分发，NVENC 工具包
 * 也受 GPL-3.0 与 Unreal 许可约束，只在运行时探测用户机器上已安装/已解压的工具；
 * 探测不到或转换失败时静默跳过，不影响导入本身。
 *
 * 已知坑（实测）：
 * - `bink2nvenc.exe` 只能打开**纯 ASCII 路径**，中文路径直接 `BinkOpen failed:
 *   Error opening file.`（退出码 1，无产物）。补丁库通常含中文目录名，因此源文件
 *   必须先复制进 ASCII 工作目录再转换。见 `resolveWorkspaceRoot`。
 * - `bink2nvenc.exe` 的 `--start N --count M` 组合不可靠（不同 N 会产出 byte 相同
 *   的结果），封面抽取一律走 `radvideo64.exe` 的单帧 JPG，不用它抽帧。
 * - `radvideo64.exe` 与 `Bink2ForUnreal.exe` 都是**命令分发器**，转换必须写成
 *   `<exe> BinkConv <输入> <输出> [/开关]`。漏掉 `BinkConv` 时进程立刻静默
 *   `exit=1`、不留任何产物，容易被误判成「该工具不支持 BK2」。
 * - `radvideo64.exe` 转换完成后进程仍驻留，必须等产物稳定后显式结束进程树。
 */

export type Bink2Header = {
  readonly frameCount: number;
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
};

/** 读取 BK2 头部：魔数 `KB2n`、帧数 u8@8、宽 u32@20、高 u32@24、帧率 u32@28。 */
export async function readBink2Header(filePath: string): Promise<Bink2Header | null> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(filePath, "r");
    const buffer = Buffer.alloc(40);
    const { bytesRead } = await handle.read(buffer, 0, 40, 0);
    if (bytesRead < 40 || buffer.toString("latin1", 0, 4) !== "KB2n") return null;
    const frameCount = buffer.readUInt8(8);
    const width = buffer.readUInt32LE(20);
    const height = buffer.readUInt32LE(24);
    const frameRate = buffer.readUInt32LE(28);
    if (frameCount === 0 || width === 0 || height === 0) return null;
    return { frameCount, width, height, frameRate: frameRate === 0 ? 60 : frameRate };
  } catch {
    return null;
  } finally {
    await handle?.close();
  }
}

const NVENC_NAMES = ["bink2nvenc.exe", "BK2ConverterCLI.exe"] as const;
const RAD_VIDEO_NAMES = ["radvideo64.exe"] as const;
const FFMPEG_NAMES = ["ffmpeg.exe"] as const;

/**
 * `radvideo64.exe` 是命令分发器，必须把 `BinkConv` 作为第一个参数才会真正执行转换；
 * 缺失时进程静默 `exit=1` 且不产出任何文件（实测：漏掉时 78 秒零产物，补上后
 * 约 1 秒出 16,655 字节 GIF）。
 */
const BINK_SUBCOMMAND = "BinkConv";

/** 按可执行文件名决定是否需要补上 `BinkConv` 子命令。 */
export function binkConverterArgs(executable: string, args: readonly string[]): readonly string[] {
  const name = win32.basename(executable).toLocaleLowerCase();
  return name === "binkconv.exe" ? args : [BINK_SUBCOMMAND, ...args];
}

async function isFile(path: string): Promise<boolean> {
  return stat(path)
    .then((metadata) => metadata.isFile())
    .catch(() => false);
}

async function findInDirectories(
  names: readonly string[],
  directories: readonly string[],
): Promise<string | null> {
  for (const directory of directories) {
    for (const name of names) {
      const candidate = win32.join(directory, name);
      if (await isFile(candidate)) return candidate;
    }
  }
  return null;
}

/** 递归查找 `bink2nvenc.exe`，用于定位用户自行解压的 NVENC 工具包目录。 */
async function findToolDirectory(
  depth: number,
  names: readonly string[],
  directories: readonly string[],
): Promise<string | null> {
  for (const directory of directories) {
    const direct = await findInDirectories(names, [directory]);
    if (direct !== null) return directory;
  }
  if (depth <= 0) return null;
  for (const directory of directories) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const children = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => win32.join(directory, entry.name));
    if (children.length === 0) continue;
    const found = await findToolDirectory(depth - 1, names, children);
    if (found !== null) return found;
  }
  return null;
}

export type VideoPreviewTools = {
  /** `bink2nvenc.exe`：全分辨率 MP4 硬件编码器，播放素材来源。 */
  readonly nvenc: string | null;
  /** `radvideo64.exe`：官方工具，用 `BinkConv /S<n> /E<n>` 抽单帧 JPG 封面。 */
  readonly radVideo: string | null;
  /** `ffmpeg.exe`：无 `radVideo` 时从 MP4 抽帧的兜底。 */
  readonly ffmpeg: string | null;
};

/** 可执行文件的环境变量覆盖，便于自定义安装位置与测试注入。 */
const NVENC_ENV = "DNF_BINK2NVENC";
const RAD_VIDEO_ENV = "DNF_RADVIDEO";
const FFMPEG_ENV = "DNF_FFMPEG";

/**
 * 探测本机可用的转换工具：环境变量 → 调用方给定的应用目录（`tools/`）→ PATH →
 * 桌面/下载里用户自行解压的 NVENC 工具包。
 */
export async function resolveVideoPreviewTools(
  searchRoots: readonly string[] = [],
): Promise<VideoPreviewTools> {
  const pathDirectories = (process.env["PATH"] ?? "").split(";").filter((entry) => entry !== "");
  const toolDirectories = searchRoots.flatMap((root) => [
    win32.join(root, "tools", "bink2nvenc"),
    win32.join(root, "tools"),
    root,
  ]);
  const desktop = win32.join(homedir(), "Desktop");

  const customNvenc = process.env[NVENC_ENV];
  const nvenc =
    customNvenc !== undefined && (await isFile(customNvenc))
      ? customNvenc
      : ((await findInDirectories(NVENC_NAMES, [...toolDirectories, ...pathDirectories])) ??
        (await findToolDirectory(2, NVENC_NAMES, [desktop, win32.join(homedir(), "Downloads")])));

  // radvideo64.exe 与 ffmpeg.exe 通常与 bink2nvenc.exe 同目录，先在同目录找一次。
  const bundledDirectories =
    nvenc === null ? [] : [win32.dirname(nvenc), win32.dirname(win32.dirname(nvenc))];

  const customRad = process.env[RAD_VIDEO_ENV];
  const radVideo =
    customRad !== undefined && (await isFile(customRad))
      ? customRad
      : ((await findInDirectories(RAD_VIDEO_NAMES, [
          ...bundledDirectories,
          ...toolDirectories,
          ...pathDirectories,
        ])) ?? (await findToolDirectory(2, RAD_VIDEO_NAMES, [desktop])));

  const customFfmpeg = process.env[FFMPEG_ENV];
  const ffmpeg =
    customFfmpeg !== undefined && (await isFile(customFfmpeg))
      ? customFfmpeg
      : ((await findInDirectories(FFMPEG_NAMES, [
          ...bundledDirectories,
          ...toolDirectories,
          ...pathDirectories,
        ])) ?? (await findToolDirectory(2, FFMPEG_NAMES, [desktop])));

  return { nvenc, radVideo, ffmpeg };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 转换完成后部分工具仍会驻留，必须显式结束整棵进程树。 */
async function killProcessTree(pid: number | undefined): Promise<void> {
  if (pid === undefined) return;
  await new Promise<void>((resolve) => {
    const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    killer.on("error", () => resolve());
    killer.on("exit", () => resolve());
  });
}

async function directorySnapshot(
  directory: string,
): Promise<{ readonly key: string; readonly ok: boolean }> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  if (files.length === 0) return { key: "", ok: false };
  const sizes = await Promise.all(
    files.map(
      async (name) => (await stat(win32.join(directory, name)).catch(() => null))?.size ?? 0,
    ),
  );
  // key 必须带上大小：只有文件名的话，正在写入的文件会被误判成「已稳定」。
  const key = files.map((name, index) => `${name}:${String(sizes[index] ?? 0)}`).join("|");
  return { key, ok: sizes.every((size) => size > 0) };
}

/**
 * 一次转换器调用。抽成显式类型是为了让测试注入假执行器：外部 Bink/FFmpeg 二进制
 * 既不该随包分发，也不该出现在单元测试的依赖里。
 */
export type ConverterInvocation = {
  readonly executable: string;
  readonly args: readonly string[];
  readonly outputDirectory: string;
  readonly timeoutMs: number;
  readonly stableMs: number;
};

export type ConverterRunner = (invocation: ConverterInvocation) => Promise<string | null>;

/**
 * 启动转换器，等到产物稳定或进程退出后结束它；返回产物路径（无产物为 null）。
 * `stableMs` 是需要连续保持不变的时长：`radvideo64.exe` 需要更长的窗口，ffmpeg 与
 * bink2nvenc 会自己退出。
 */
async function spawnConverter(invocation: ConverterInvocation): Promise<string | null> {
  const child = spawn(invocation.executable, [...invocation.args], {
    stdio: "ignore",
    windowsHide: true,
  });
  let exited = false;
  let failed = false;
  child.on("error", () => {
    failed = true;
    exited = true;
  });
  child.on("exit", () => {
    exited = true;
  });

  const deadline = Date.now() + invocation.timeoutMs;
  let previousKey = "";
  let stable = 0;
  let exitedAt: number | null = null;
  try {
    while (Date.now() < deadline) {
      await delay(250);
      if (failed) return null;
      if (exited && exitedAt === null) exitedAt = Date.now();
      const snapshot = await directorySnapshot(invocation.outputDirectory);
      if (snapshot.ok && snapshot.key === previousKey) {
        stable += 250;
        if (stable >= invocation.stableMs) break;
      } else {
        stable = 0;
      }
      previousKey = snapshot.key;
      // 进程自主退出且产物已就绪：不必继续等满超时。
      if (exitedAt !== null && snapshot.ok) break;
      // 进程已退出却迟迟没有产物（bink2nvenc 编码极快，产物落盘可能晚于进程退出），
      // 给一段宽限再放弃；否则会把已经成功的转换误判成失败。
      if (exitedAt !== null && Date.now() - exitedAt >= EXIT_GRACE_MS) break;
    }
  } finally {
    await killProcessTree(child.pid);
  }

  const entries = await readdir(invocation.outputDirectory, { withFileTypes: true }).catch(
    () => [],
  );
  const first = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort()[0];
  return first === undefined ? null : win32.join(invocation.outputDirectory, first);
}

/** 复制到临时名再改名，避免把半成品暴露给正在扫描的 UI。 */
async function moveIntoLibrary(sourcePath: string, targetPath: string): Promise<boolean> {
  const stagingPath = `${targetPath}.staging-${process.pid.toString()}`;
  try {
    await copyFile(sourcePath, stagingPath);
    await rename(stagingPath, targetPath);
    return true;
  } catch {
    await rm(stagingPath, { force: true });
    return false;
  }
}

/** 路径是否只含可打印 ASCII（0x20–0x7E）；bink2nvenc 无法打开其它字符的路径。 */
function isAsciiOnly(value: string): boolean {
  return /^[\x20-\x7e]*$/u.test(value);
}

/**
 * `bink2nvenc.exe` 打不开非 ASCII 路径，工作目录必须是纯 ASCII。
 * 临时目录通常满足；用户名或系统盘含中文时回落到系统盘根目录。
 */
function resolveWorkspaceRoot(): string {
  const preferred = tmpdir();
  if (isAsciiOnly(preferred)) return preferred;
  const fallback = win32.join(process.env["SystemDrive"] ?? "C:", "dnf-bk2-workspace");
  return isAsciiOnly(fallback) ? fallback : preferred;
}

export type VideoPreviewGenerationRequest = {
  readonly libraryRoot: LibraryRoot;
  /** 相对库根目录的 BK2 路径。 */
  readonly relativePath: string;
  readonly tools?: VideoPreviewTools | undefined;
  /** 覆盖实际执行器（测试注入）。缺省为真实 spawn。 */
  readonly runner?: ConverterRunner | undefined;
};

export type VideoPreviewGenerationResult = {
  /** 同名 JPG 静态封面（中间帧，保持源分辨率）。 */
  readonly coverRelativePath: string | null;
  /** 同名 MP4，用于卡片悬停播放。 */
  readonly playbackRelativePath: string | null;
};

/**
 * 播放素材按最高质量档导出：NVENC 最慢预设 + 最低 CQ，并**保持源分辨率不缩放**。
 * 早期实现把视频缩到 240 宽再编码，正是预览「太模糊」的根因。
 */
const PLAYBACK_PRESET = "p7";
const PLAYBACK_CQ = "1";
const PLAYBACK_CODEC = "h264";
const PLAYBACK_TIMEOUT_MS = 120_000;

const BINK_STABLE_MS = 1500;
const COVER_TIMEOUT_MS = 60_000;
const FFMPEG_STABLE_MS = 250;
/** 进程已退出但产物尚未出现时的额外等待窗口。 */
const EXIT_GRACE_MS = 5_000;

/** 生成同名 JPG 封面与同名 MP4。任一步失败都不抛错，也不会回滚已完成的导入。 */
export async function generateVideoPreview(
  request: VideoPreviewGenerationRequest,
): Promise<VideoPreviewGenerationResult> {
  const empty: VideoPreviewGenerationResult = {
    coverRelativePath: null,
    playbackRelativePath: null,
  };

  const resolved = resolveLibraryPath(request.libraryRoot, request.relativePath);
  if (!resolved.ok) return empty;
  const sourcePath = resolved.value;
  if (!(await isFile(sourcePath))) return empty;

  const tools = request.tools ?? (await resolveVideoPreviewTools());
  if (tools.nvenc === null && tools.radVideo === null) return empty;
  const runConverter: ConverterRunner = request.runner ?? spawnConverter;

  const directory = win32.dirname(request.relativePath);
  const fileName = win32.basename(request.relativePath);
  const baseName = win32.basename(fileName, win32.extname(fileName));
  const header = await readBink2Header(sourcePath);
  const middleFrame = header === null ? 1 : Math.max(1, Math.ceil((header.frameCount + 1) / 2));
  const coverName = `${baseName}.jpg`;
  const playbackName = `${baseName}.mp4`;

  const workspace = await mkdtemp(win32.join(resolveWorkspaceRoot(), "dnf-bk2-preview-"));
  let coverRelativePath: string | null = null;
  let playbackRelativePath: string | null = null;

  try {
    // bink2nvenc 只认 ASCII 路径，而补丁库路径通常含中文，因此统一在 ASCII 工作
    // 目录里转换，产物最后再搬回库目录。
    const asciiInput = win32.join(workspace, "input.bk2");
    await copyFile(sourcePath, asciiInput);

    // 1) 播放素材：全分辨率 H.264（NVENC），最高质量档。
    if (tools.nvenc !== null) {
      const encodeDirectory = win32.join(workspace, "encode");
      await mkdir(encodeDirectory, { recursive: true });
      // nvenc 的输入与输出路径都必须是纯 ASCII，因此临时产物用固定英文名，
      // 搬回补丁库时才改成与 BK2 同名的 `<base>.mp4`。
      const encoded = await runConverter({
        executable: tools.nvenc,
        args: [
          asciiInput,
          win32.join(encodeDirectory, "playback.mp4"),
          "--preset",
          PLAYBACK_PRESET,
          "--codec",
          PLAYBACK_CODEC,
          "--depth",
          "8",
          "--fps",
          (header?.frameRate ?? 60).toString(),
          "--cq",
          PLAYBACK_CQ,
        ],
        outputDirectory: encodeDirectory,
        timeoutMs: PLAYBACK_TIMEOUT_MS,
        stableMs: FFMPEG_STABLE_MS,
      });
      if (encoded !== null) {
        const target = resolveLibraryPath(request.libraryRoot, win32.join(directory, playbackName));
        if (target.ok && (await moveIntoLibrary(encoded, target.value))) {
          playbackRelativePath = win32.join(directory, playbackName);
        }
      }
    }

    // 2) 静态封面：官方工具抽最中间一帧为 JPG，保持源分辨率。
    if (tools.radVideo !== null) {
      const coverDirectory = win32.join(workspace, "cover");
      await mkdir(coverDirectory, { recursive: true });
      const coverSource = await runConverter({
        executable: tools.radVideo,
        args: binkConverterArgs(tools.radVideo, [
          asciiInput,
          win32.join(coverDirectory, coverName),
          `/S${middleFrame.toString()}`,
          `/E${middleFrame.toString()}`,
          "/O",
        ]),
        outputDirectory: coverDirectory,
        timeoutMs: COVER_TIMEOUT_MS,
        stableMs: BINK_STABLE_MS,
      });
      if (coverSource !== null) {
        const target = resolveLibraryPath(request.libraryRoot, win32.join(directory, coverName));
        if (target.ok && (await moveIntoLibrary(coverSource, target.value))) {
          coverRelativePath = win32.join(directory, coverName);
        }
      }
    }

    // 3) 没有 radvideo64 时，从编码出的 MP4 里抽一帧作为兜底封面。
    if (coverRelativePath === null && tools.ffmpeg !== null) {
      const fallbackDirectory = win32.join(workspace, "fallback");
      await mkdir(fallbackDirectory, { recursive: true });
      // 优先复用刚生成的播放素材；否则先让 nvenc 编一份临时 MP4。
      // 不用 `--start/--count` 抽单帧：实测该组合不可靠（不同起点产出 byte 相同）。
      const libraryClipPath =
        playbackRelativePath === null
          ? null
          : win32.join(request.libraryRoot, playbackRelativePath);
      let clipPath =
        libraryClipPath !== null && (await isFile(libraryClipPath)) ? libraryClipPath : null;
      if (clipPath === null && tools.nvenc !== null) {
        const clipDirectory = win32.join(workspace, "clip");
        await mkdir(clipDirectory, { recursive: true });
        // 同 1)：nvenc 的输出路径也必须是纯 ASCII。
        const encoded = await runConverter({
          executable: tools.nvenc,
          args: [
            asciiInput,
            win32.join(clipDirectory, "clip.mp4"),
            "--preset",
            PLAYBACK_PRESET,
            "--codec",
            PLAYBACK_CODEC,
            "--depth",
            "8",
            "--fps",
            (header?.frameRate ?? 60).toString(),
            "--cq",
            PLAYBACK_CQ,
          ],
          outputDirectory: clipDirectory,
          timeoutMs: PLAYBACK_TIMEOUT_MS,
          stableMs: FFMPEG_STABLE_MS,
        });
        if (encoded !== null) clipPath = encoded;
      }
      if (clipPath !== null) {
        const extracted = await runConverter({
          executable: tools.ffmpeg,
          args: [
            "-y",
            "-i",
            clipPath,
            "-vf",
            `select=eq(n\\,${(middleFrame - 1).toString()})`,
            "-frames:v",
            "1",
            "-q:v",
            "2",
            win32.join(fallbackDirectory, coverName),
          ],
          outputDirectory: fallbackDirectory,
          timeoutMs: COVER_TIMEOUT_MS,
          stableMs: FFMPEG_STABLE_MS,
        });
        if (extracted !== null) {
          const target = resolveLibraryPath(request.libraryRoot, win32.join(directory, coverName));
          if (target.ok && (await moveIntoLibrary(extracted, target.value))) {
            coverRelativePath = win32.join(directory, coverName);
          }
        }
      }
    }
  } catch {
    // best-effort：任何失败都只意味着没有预览，导入本身仍然成功。
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }

  return { coverRelativePath, playbackRelativePath };
}

export type VideoPreviewsGenerationRequest = {
  readonly libraryRoot: LibraryRoot;
  readonly relativePaths: readonly string[];
  readonly tools?: VideoPreviewTools | undefined;
  readonly runner?: ConverterRunner | undefined;
  /** 额外搜索根（通常是应用目录），用于发现随应用放置的 `tools/bink2nvenc`。 */
  readonly searchRoots?: readonly string[] | undefined;
};

/** 批量生成：串行执行，避免同时拉起多个会驻留的转换进程。 */
export async function generateVideoPreviews(
  request: VideoPreviewsGenerationRequest,
): Promise<void> {
  if (request.relativePaths.length === 0) return;
  const tools = request.tools ?? (await resolveVideoPreviewTools(request.searchRoots ?? []));
  if (tools.nvenc === null && tools.radVideo === null) return;
  for (const relativePath of request.relativePaths) {
    await generateVideoPreview({
      libraryRoot: request.libraryRoot,
      relativePath,
      tools,
      ...(request.runner === undefined ? {} : { runner: request.runner }),
    });
  }
}

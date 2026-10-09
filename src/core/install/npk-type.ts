import { type FileHandle, open } from "node:fs/promises";
import { isVideoPatchPath } from "../../shared/library-patch-extensions";

/**
 * NPK 目录头结构（还原自 ExtractorSharp NpkCoder.cs）：
 * 16 字节魔数 "NeoplePack_Bill\0"、int32 条目数、每条 264 字节
 * （int32 offset、int32 length、256 字节 XOR 加密内部路径）。
 */
const NPK_FLAG = "NeoplePack_Bill";
const NPK_FLAG_BYTES = 16;
const ENTRY_PATH_BYTES = 256;
const ENTRY_BYTES = 8 + ENTRY_PATH_BYTES;
const OGG_FLAG = "OggS";
const KEY_HEADER = "puchikon@neople dungeon and fighter ";
const KEY_FILLER = "DNF";

/**
 * 索引分块读取的字节数：按块顺序扫描条目并把单次分配量固定住，
 * 使「条目数极大」的补丁（如 4.3 亿字节的韩服语音包，12820 条 = 3.38 MB 索引）
 * 不必整体读入内存，也不因总字节数超限而误回落。
 */
const INDEX_READ_BYTES = 64 * 1024;

const xorKey: readonly number[] = buildXorKey();

function buildXorKey(): readonly number[] {
  const key = new Array<number>(ENTRY_PATH_BYTES).fill(0);
  const header = Buffer.from(KEY_HEADER, "utf8");
  const filler = Buffer.from(KEY_FILLER, "utf8");
  for (let i = 0; i < header.length && i < ENTRY_PATH_BYTES; i += 1) key[i] = header[i] ?? 0;
  for (let i = header.length; i < ENTRY_PATH_BYTES - 1; i += 1) key[i] = filler[i % 3] ?? 0;
  return key;
}

export type NpkPatchKind = "image" | "sound" | "video";

/**
 * 解析补丁头部并按格式与内部条目路径分类补丁类型。
 * 扩展名为 `.bk2` 的补丁按扩展名直接分类为 "video"（BK2 不是 NPK 容器，
 * 不能按 NPK 头部读取）；其余按 NPK 头部判定。
 * 任何读取失败、结构损坏或条目数异常都回落为 "image"，
 * 与既有安装行为保持一致，不阻塞安装。
 */
export async function classifyPatch(filePath: string): Promise<NpkPatchKind> {
  if (isVideoPatchPath(filePath)) return "video";
  try {
    return await withFileHandle(filePath);
  } catch {
    return "image";
  }
}

/** 旧名保留：语义已扩展为「按格式与内容分类」，调用方应逐步迁移到 classifyPatch。 */
export const classifyNpk = classifyPatch;

async function withFileHandle(filePath: string): Promise<NpkPatchKind> {
  const handle = await open(filePath, "r");
  try {
    const head = Buffer.alloc(NPK_FLAG_BYTES + 4);
    const { bytesRead: headBytes } = await handle.read(head, 0, head.length, 0);
    if (headBytes < head.length) return "image";
    if (head.subarray(0, NPK_FLAG_BYTES).toString("utf8").replace(/\0.*$/, "") !== NPK_FLAG) {
      return await sniffNonNpk(handle);
    }
    const entryCount = head.readInt32LE(NPK_FLAG_BYTES);
    if (entryCount <= 0) return "image";
    // 按条目顺序分块扫描：第一个命中 sounds/.ogg 的条目即可判定，
    // 大索引补丁（数千条以上）通常在前几块内即命中，无需读完整索引。
    const chunkEntries = Math.max(1, Math.floor(INDEX_READ_BYTES / ENTRY_BYTES));
    const chunk = Buffer.alloc(chunkEntries * ENTRY_BYTES);
    for (let scanned = 0; scanned < entryCount; scanned += chunkEntries) {
      const want = Math.min(chunkEntries, entryCount - scanned) * ENTRY_BYTES;
      const { bytesRead } = await handle.read(chunk, 0, want, head.length + scanned * ENTRY_BYTES);
      // 索引不完整（截断、count 被改大）仍按结构损坏回落，与整体读取时的语义一致。
      if (bytesRead < want) return "image";
      for (let offset = 0; offset + ENTRY_BYTES <= want; offset += ENTRY_BYTES) {
        const entryPath = decryptEntryPath(chunk, offset + 8);
        if (isSoundEntryPath(entryPath)) return "sound";
      }
    }
    return "image";
  } finally {
    await handle.close();
  }
}

async function sniffNonNpk(handle: FileHandle): Promise<NpkPatchKind> {
  const magic = Buffer.alloc(4);
  const { bytesRead } = await handle.read(magic, 0, 4, 0);
  return bytesRead === 4 && magic.toString("utf8") === OGG_FLAG ? "sound" : "image";
}

function decryptEntryPath(index: Buffer, offset: number): string {
  const bytes: number[] = [];
  for (let i = 0; i < ENTRY_PATH_BYTES; i += 1) {
    const byte = (index[offset + i] ?? 0) ^ (xorKey[i] ?? 0);
    if (byte === 0) break;
    bytes.push(byte);
  }
  return Buffer.from(bytes).toString("utf8");
}

/**
 * 只看条目扩展名：`.ogg` 即音效补丁。
 *
 * 不再要求 `sounds/` 前缀。判别依据与 ExtractorSharp 展示内容类型的方式一致
 * （打开 NPK 看到条目是 `.img` 还是 `.ogg`）：目录前缀是补丁作者的书写习惯，
 * 不是格式事实，把前缀当作必要条件会在前缀非 `sounds/` 的合法音效包上漏判成
 * 贴图补丁、装错目录，而漏判没有补救机会（游戏读不到该补丁）。
 * 实测 22 个真实音效包（含韩服语音、日服各职业音效）条目全部命中 `.ogg`。
 *
 * 代价：条目同时含 `.img` 与 `.ogg` 的混合包会整体判为音效补丁。实测 31 个真实
 * 补丁中混合包为 0；若将来出现，应按内容占比细分，见 openspec spec 的说明。
 */
function isSoundEntryPath(entryPath: string): boolean {
  return entryPath.toLocaleLowerCase().endsWith(".ogg");
}

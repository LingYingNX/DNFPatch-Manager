import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { classifyNpk } from "../../src/core/install/npk-type";

const XOR_KEY = buildXorKey();

function buildXorKey(): Buffer {
  const key = Buffer.alloc(256);
  const header = Buffer.from("puchikon@neople dungeon and fighter ", "utf8");
  const filler = Buffer.from("DNF", "utf8");
  key.set(header);
  for (let i = header.length; i < 255; i += 1) key[i] = filler[i % 3] ?? 0;
  return key;
}

/** 与 ExtractorSharp WritePath 一致：整段 256 字节与密钥异或，路径结束处的密文解密后为 0。 */
function encodeEntryPath(path: string): Buffer {
  const raw = Buffer.from(path, "utf8");
  const encrypted = Buffer.alloc(256);
  for (let i = 0; i < 255 && i < raw.length; i += 1) {
    encrypted[i] = (raw[i] ?? 0) ^ (XOR_KEY[i] ?? 0);
  }
  for (let i = raw.length; i < 255; i += 1) encrypted[i] = XOR_KEY[i] ?? 0;
  return encrypted;
}

function buildNpk(entryPaths: readonly string[]): Buffer {
  const header = Buffer.alloc(20);
  header.write("NeoplePack_Bill", 0, "utf8");
  header.writeInt32LE(entryPaths.length, 16);
  const entries: Buffer[] = [];
  for (const path of entryPaths) {
    const entry = Buffer.alloc(264);
    entry.writeInt32LE(0, 0);
    entry.writeInt32LE(0, 4);
    encodeEntryPath(path).copy(entry, 8);
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries]);
}

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "npk-type-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("classifyNpk", () => {
  it("classifies an NPK containing sounds entries as sound", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "sound.npk");
      await writeFile(file, buildNpk(["sprite/character/xxx.img", "sounds/bgm/xxx.ogg"]));
      expect(await classifyNpk(file)).toBe("sound");
    });
  });

  it("classifies an image-only NPK as image regardless of case", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "image.npk");
      await writeFile(file, buildNpk(["SPRITE/item/xxx.img"]));
      expect(await classifyNpk(file)).toBe("image");
    });
  });

  it("treats sounds paths with uppercase and mixed separators as sound", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "upper.npk");
      await writeFile(file, buildNpk(["Sounds/Jungle/XXX.OGG"]));
      expect(await classifyNpk(file)).toBe("sound");
    });
  });

  it("classifies an ogg outside the sounds directory as sound", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "music.npk");
      await writeFile(file, buildNpk(["music/bgm/theme.ogg"]));
      expect(await classifyNpk(file)).toBe("sound");
    });
  });

  it("falls back to image when the flag is not NPK and the head is not OggS", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "broken.npk");
      await writeFile(file, Buffer.from("not an npk at all"));
      expect(await classifyNpk(file)).toBe("image");
    });
  });

  it("classifies a bare OggS file as sound", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "bare.ogg");
      await writeFile(file, Buffer.concat([Buffer.from("OggS"), Buffer.alloc(32)]));
      expect(await classifyNpk(file)).toBe("sound");
    });
  });

  it("classifies a large-index NPK whose sound entry sits beyond the first read chunk", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "large-index.npk");
      const imageEntries = Array.from({ length: 300 }, (_value, index) => `sprite/a${index}.img`);
      await writeFile(file, buildNpk([...imageEntries, "sounds/bgm/xxx.ogg"]));
      expect(await classifyNpk(file)).toBe("sound");
    });
  });

  it("falls back to image when the declared entry count is absurd", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "huge-count.npk");
      const header = Buffer.alloc(20);
      header.write("NeoplePack_Bill", 0, "utf8");
      header.writeInt32LE(0x7fffffff, 16);
      await writeFile(file, header);
      expect(await classifyNpk(file)).toBe("image");
    });
  });

  it("falls back to image when the file is truncated mid-index", async () => {
    await withTempDir(async (dir) => {
      const file = join(dir, "truncated.npk");
      const full = buildNpk(["sounds/a.ogg", "sounds/b.ogg"]);
      await writeFile(file, full.subarray(0, full.length - 40));
      expect(await classifyNpk(file)).toBe("image");
    });
  });

  it("falls back to image when the file does not exist", async () => {
    await withTempDir(async (dir) => {
      expect(await classifyNpk(join(dir, "missing.npk"))).toBe("image");
    });
  });
});

afterAll(async () => {
  // 临时目录已用后即删，无需清理钩子；保留以对齐 vitest 生命周期约定。
});

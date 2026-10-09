import { describe, expect, it } from "vitest";
import { createValidatedHandler } from "../../src/main/ipc/validated-handler";
import {
  CategoryOrderRequestSchema,
  CreateGroupRequestSchema,
  DissolveGroupRequestSchema,
  ImportDroppedPatchesRequestSchema,
  InstallRequestSchema,
  IPC_CHANNELS,
  MoveItemRequestSchema,
  MoveItemsRequestSchema,
  OpenExternalUrlRequestSchema,
  RecycleBatchRequestSchema,
  ScanGroupRequestSchema,
  ScanRequestSchema,
} from "../../src/shared/ipc-contracts";
import {
  AddItemsToPresetRequestSchema,
  CreatePresetRequestSchema,
  InstallPresetRequestSchema,
  PresetInstallResultSchema,
  PresetItemReferenceSchema,
} from "../../src/shared/preset-contracts";

describe("IPC request contracts", () => {
  it("accepts a patch-only preset request", () => {
    expect(
      CreatePresetRequestSchema.safeParse({
        name: "战斗预设",
        items: [{ kind: "patch", relativePath: "Armor/coat.npk" }],
      }).success,
    ).toBe(true);
    expect(
      PresetItemReferenceSchema.safeParse({ kind: "patch", relativePath: "coat.npk" }).success,
    ).toBe(true);
  });

  it.each([
    { name: "", items: [{ kind: "patch", relativePath: "coat.npk" }] },
    { name: "组预设", items: [{ kind: "group", relativePath: "套装" }] },
    { name: "越界", items: [{ kind: "patch", relativePath: "../coat.npk" }] },
    { name: "绝对路径", items: [{ kind: "patch", relativePath: "C:/coat.npk" }] },
  ])("rejects invalid preset input", (input) => {
    expect(CreatePresetRequestSchema.safeParse(input).success).toBe(false);
  });

  it("parses append and install preset requests", () => {
    expect(
      AddItemsToPresetRequestSchema.safeParse({
        id: "0552babf-49b5-4390-96a7-1846a0c1e9f8",
        items: [{ kind: "patch", relativePath: "coat.npk" }],
      }).success,
    ).toBe(true);
    expect(
      InstallPresetRequestSchema.safeParse({
        id: "0552babf-49b5-4390-96a7-1846a0c1e9f8",
      }).success,
    ).toBe(true);
    expect(
      PresetInstallResultSchema.safeParse({
        installedCount: 2,
        missingPaths: ["Armor/removed.npk"],
      }).success,
    ).toBe(true);
  });

  it("exposes typed preset IPC channels", () => {
    expect([
      IPC_CHANNELS.presetsList,
      IPC_CHANNELS.presetsCreate,
      IPC_CHANNELS.presetsRename,
      IPC_CHANNELS.presetsDelete,
      IPC_CHANNELS.presetsAddItems,
      IPC_CHANNELS.presetsInstall,
    ]).toEqual([
      "presets:list",
      "presets:create",
      "presets:rename",
      "presets:delete",
      "presets:add-items",
      "presets:install",
    ]);
  });

  it("parses a valid create-group request", () => {
    const result = CreateGroupRequestSchema.safeParse({
      categoryRelativePath: "分类A",
      patchRelativePaths: ["分类A\\top.npk", "分类A\\bottom.npk"],
      groupName: "套装",
    });

    expect(result.success).toBe(true);
  });

  it("parses a valid dissolve-group request and rejects invalid group IDs", () => {
    expect(
      DissolveGroupRequestSchema.safeParse({ groupId: "0552babf-49b5-4390-96a7-1846a0c1e9f8" })
        .success,
    ).toBe(true);
    expect(DissolveGroupRequestSchema.safeParse({ groupId: "not-a-uuid" }).success).toBe(false);
  });

  it("exposes the dissolve-group IPC channel", () => {
    expect(IPC_CHANNELS.dissolveGroup).toBe("library:dissolve-group");
  });

  it("accepts a UUID-based group scan request", () => {
    expect(
      ScanGroupRequestSchema.safeParse({
        groupId: "0552babf-49b5-4390-96a7-1846a0c1e9f8",
      }).success,
    ).toBe(true);
    expect(ScanGroupRequestSchema.safeParse({ groupId: "分类A\\套装" }).success).toBe(false);
    expect(IPC_CHANNELS.scanGroup).toBe("library:scan-group");
  });

  it.each([
    { relativePath: "..\\outside" },
    { relativePath: "C:\\absolute" },
    { relativePath: "分类A\\..\\分类B" },
  ])("rejects an unsafe scan path", (input) => {
    expect(ScanRequestSchema.safeParse(input).success).toBe(false);
  });

  it("does not call the application service when input is invalid", async () => {
    let callCount = 0;
    const handler = createValidatedHandler(MoveItemRequestSchema, async () => {
      callCount += 1;
      return { ok: true as const, value: { relativePath: "分类B\\coat.npk" } };
    });

    const result = await handler({
      kind: "patch",
      sourceRelativePath: "..\\coat.npk",
      targetDirectoryRelativePath: "分类B",
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "INVALID_INPUT", message: "请求参数无效" },
    });
    expect(callCount).toBe(0);
  });

  it("rejects Windows-equivalent sources in one batch move", () => {
    expect(
      MoveItemsRequestSchema.safeParse({
        items: [
          { kind: "patch", sourceRelativePath: "分类A\\coat.npk" },
          { kind: "patch", sourceRelativePath: "分类A/COAT.NPK" },
        ],
        targetDirectoryRelativePath: "分类B",
      }).success,
    ).toBe(false);
  });

  it("requires virtual group move requests to use group IDs", () => {
    expect(
      MoveItemRequestSchema.safeParse({
        kind: "group",
        groupId: "0552babf-49b5-4390-96a7-1846a0c1e9f8",
        targetDirectoryRelativePath: "分类B",
      }).success,
    ).toBe(true);
    expect(
      MoveItemRequestSchema.safeParse({
        kind: "group",
        sourceRelativePath: "分类A\\旧套装",
        targetDirectoryRelativePath: "分类B",
      }).success,
    ).toBe(false);
    expect(
      MoveItemsRequestSchema.safeParse({
        items: [{ kind: "group", groupId: "0552babf-49b5-4390-96a7-1846a0c1e9f8" }],
        targetDirectoryRelativePath: "分类B",
      }).success,
    ).toBe(true);
  });

  it("rejects Windows-equivalent items in one batch recycle", () => {
    expect(
      RecycleBatchRequestSchema.safeParse({
        items: [
          { kind: "patch", relativePath: "分类A\\coat.npk" },
          { kind: "patch", relativePath: "分类A/COAT.NPK" },
        ],
      }).success,
    ).toBe(false);
  });

  it("uses group IDs for install and recycle item references", () => {
    const group = { kind: "group", groupId: "0552babf-49b5-4390-96a7-1846a0c1e9f8" } as const;
    expect(InstallRequestSchema.safeParse(group).success).toBe(true);
    expect(RecycleBatchRequestSchema.safeParse({ items: [group] }).success).toBe(true);
    expect(
      InstallRequestSchema.safeParse({ kind: "group", relativePath: "分类A\\套装" }).success,
    ).toBe(false);
  });

  it.each([
    "https://docs.qq.com/smartsheet/DRXZyb2N2eUFmWHVC",
    "https://github.com/LingYingNX/DNFguanliqi",
    "https://qm.qq.com/q/ZxPw28W7eg",
    "https://space.bilibili.com/41344302",
    "https://afdian.com/a/naixu",
  ])("accepts allowlisted external urls", (url) => {
    expect(OpenExternalUrlRequestSchema.safeParse({ url }).success).toBe(true);
  });

  it("rejects external urls outside the allowlist", () => {
    expect(
      OpenExternalUrlRequestSchema.safeParse({ url: "https://example.com/evil" }).success,
    ).toBe(false);
  });

  it("rejects category order entries outside the requested parent", () => {
    // Given: an order request for one parent category.
    const input = {
      parentRelativePath: "Armor",
      orderedChildRelativePaths: ["Armor\\Cloth", "Weapons\\Sword"],
    };

    // When: the IPC boundary parses the request.
    const result = CategoryOrderRequestSchema.safeParse(input);

    // Then: a child from another parent is rejected.
    expect(result.success).toBe(false);
  });

  it.each([
    {
      parentRelativePath: "Armor",
      orderedChildRelativePaths: ["Armor\\Cloth", "Armor/Cloth"],
    },
    { parentRelativePath: "", orderedChildRelativePaths: ["Armor", "armor"] },
  ])("rejects Windows-equivalent category order duplicates", (input) => {
    // Given/When: separator or case aliases cross the IPC boundary in one order.
    const result = CategoryOrderRequestSchema.safeParse(input);

    // Then: Windows-equivalent children are rejected as duplicates.
    expect(result.success).toBe(false);
  });

  it.each([
    { categoryRelativePath: "", sourcePaths: ["relative.npk"] },
    { categoryRelativePath: "", sourcePaths: ["C:\\drop\\notes.txt"] },
    { categoryRelativePath: "", sourcePaths: ["C:\\drop\\clip.bik"] },
    { categoryRelativePath: "", sourcePaths: ["C:\\drop\\clip.bk2.bak"] },
  ])("rejects an invalid dropped-patch IPC request", (input) => {
    // Given/When: an untrusted dropped-file request reaches the IPC schema.
    const result = ImportDroppedPatchesRequestSchema.safeParse(input);

    // Then: only absolute NPK/BK2 paths can cross into the main process.
    expect(result.success).toBe(false);
  });

  it.each(["C:\\drop\\coat.npk", "C:\\drop\\coat.NPK", "D:\\视频\\0A 冰雪女剑buff.bk2"])(
    "accepts an absolute NPK or BK2 dropped path (%s)",
    (sourcePath) => {
      expect(
        ImportDroppedPatchesRequestSchema.safeParse({
          categoryRelativePath: "",
          sourcePaths: [sourcePath],
        }).success,
      ).toBe(true);
    },
  );
});

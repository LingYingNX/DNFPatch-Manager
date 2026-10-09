import { describe, expect, it } from "vitest";
import { toApiResult } from "../../src/main/ipc/api-result";

describe("API error translation", () => {
  it("explains invalid group contents", () => {
    expect(toApiResult({ ok: false, error: { code: "GROUP_CONTENT_NOT_PATCHES" } })).toEqual({
      ok: false,
      error: {
        code: "GROUP_CONTENT_NOT_PATCHES",
        message: "补丁组包含无效内容，只允许 NPK、BK2 和支持格式的预览图",
      },
    });
  });

  it("explains a missing group", () => {
    expect(toApiResult({ ok: false, error: { code: "GROUP_NOT_FOUND" } })).toEqual({
      ok: false,
      error: {
        code: "GROUP_NOT_FOUND",
        message: "补丁组不存在或标记无效",
      },
    });
  });
});

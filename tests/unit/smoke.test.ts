import { describe, expect, it } from "vitest";
import { APP_NAME, APP_VERSION } from "../../src/shared/contracts";

describe("application identity", () => {
  it("keeps the visible and packaged identity aligned", () => {
    expect(APP_NAME).toBe("DNF 补丁管理器");
    expect(APP_VERSION).toBe("1.3.0");
  });
});

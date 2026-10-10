import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "../../src/renderer/components/Dialog";

afterEach(cleanup);

describe("dialog focus management", () => {
  it("keeps the field the user is editing focused when the dialog re-renders", () => {
    const { rerender } = render(
      <Dialog onClose={() => {}} title="测试对话框">
        <button data-dialog-initial-focus={true} type="button">
          首个
        </button>
        <input aria-label="名称" />
      </Dialog>,
    );
    const input = screen.getByRole("textbox", { name: "名称" });
    input.focus();
    expect(document.activeElement).toBe(input);

    // 父组件重渲染会传新的内联 onClose，不能因此重跑初始聚焦。
    rerender(
      <Dialog onClose={() => {}} title="测试对话框">
        <button data-dialog-initial-focus={true} type="button">
          首个
        </button>
        <input aria-label="名称" />
      </Dialog>,
    );

    expect(document.activeElement).toBe(input);
  });

  it("closes with the latest onClose callback when Escape is pressed", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <Dialog onClose={first} title="测试对话框">
        <span>内容</span>
      </Dialog>,
    );
    rerender(
      <Dialog onClose={second} title="测试对话框">
        <span>内容</span>
      </Dialog>,
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});

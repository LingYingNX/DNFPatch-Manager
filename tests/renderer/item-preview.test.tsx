import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/renderer/App";
import { createFakeApi, WORKSPACE_SNAPSHOT } from "./fake-api";

describe("item previews", () => {
  afterEach(cleanup);
  it("uses a hover-preview double click to choose an image", async () => {
    const api = createFakeApi(WORKSPACE_SNAPSHOT);
    const selectItemPreview = vi.fn(async () => ({
      ok: true as const,
      value: { previewUrl: "dnf-asset://preview/test.png" },
    }));
    const scan = vi.fn(api.scan);
    const { container } = render(<App api={{ ...api, scan, selectItemPreview }} />);
    const card = await screen.findByRole("button", { name: "coat.npk" });
    const hoverZone = card.parentElement?.querySelector(".item-preview-hover-zone");
    expect(hoverZone).not.toBeNull();

    fireEvent.doubleClick(hoverZone ?? container);

    await waitFor(() =>
      expect(selectItemPreview).toHaveBeenCalledWith({ kind: "patch", relativePath: "coat.npk" }),
    );
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it("renders a hover affordance for every card and zooms only matching previews", async () => {
    const api = createFakeApi({
      ...WORKSPACE_SNAPSHOT,
      patches: WORKSPACE_SNAPSHOT.patches.map((patch) =>
        patch.name === "coat.npk"
          ? { ...patch, previewUrl: "dnf-library://library/coat.png" }
          : patch,
      ),
    });
    render(<App api={api} />);

    const patchCard = await screen.findByRole("button", { name: "coat.npk" });
    const patchShell = patchCard.parentElement;
    expect(patchShell?.querySelector(".item-preview-hover-zone")).toBeInTheDocument();
    expect(patchShell?.querySelector(".item-preview-hover-dot")).toBeInTheDocument();
    expect(patchShell?.querySelector(".item-preview-hover-image")).toHaveAttribute(
      "src",
      "dnf-library://library/coat.png",
    );

    const missingPreviewCard = screen.getByRole("button", { name: "sword.npk" });
    expect(
      missingPreviewCard.parentElement?.querySelector(".item-preview-hover-zone"),
    ).toBeInTheDocument();
    expect(missingPreviewCard.parentElement?.querySelector(".item-preview-hover-image")).toBeNull();
    expect(patchCard).toHaveAttribute("aria-pressed", "false");
  });

  it("plays the routed video on hover instead of zooming the still image", async () => {
    const api = createFakeApi({
      ...WORKSPACE_SNAPSHOT,
      patches: WORKSPACE_SNAPSHOT.patches.map((patch) =>
        patch.name === "coat.npk"
          ? {
              ...patch,
              previewUrl: "dnf-library://library/coat.png",
              videoPreviewUrl: "dnf-library://library/coat.mp4",
            }
          : patch,
      ),
    });
    render(<App api={api} />);

    const patchShell = (await screen.findByRole("button", { name: "coat.npk" })).parentElement;
    const hoverVideo = patchShell?.querySelector(".item-preview-hover-video");
    expect(hoverVideo).toBeInTheDocument();
    expect(hoverVideo).toHaveAttribute("src", "dnf-library://library/coat.mp4");
    // React assigns `muted` as a live DOM property rather than an attribute.
    expect((hoverVideo as HTMLVideoElement).muted).toBe(true);
    expect((hoverVideo as HTMLVideoElement).loop).toBe(true);
    // The still image is the fallback only: it must not render beside the video.
    expect(patchShell?.querySelector(".item-preview-hover-image")).toBeNull();

    const missingVideoShell = screen.getByRole("button", { name: "sword.npk" }).parentElement;
    expect(missingVideoShell?.querySelector(".item-preview-hover-video")).toBeNull();
  });
});

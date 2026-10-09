import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, type Page, test } from "@playwright/test";

type Bounds = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

type EmptyStateLayout = {
  readonly emptyState: Bounds;
  readonly content: Bounds;
};

function center(bounds: Bounds): { readonly x: number; readonly y: number } {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

function contentBounds(boxes: readonly Bounds[]): Bounds {
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

async function readEmptyStateLayout(page: Page): Promise<EmptyStateLayout> {
  const emptyState = page.getByRole("region", { name: "无匹配项目" });
  await expect(emptyState).toBeVisible();

  const [emptyStateBox, iconBox, headingBox, messageBox] = await Promise.all([
    emptyState.boundingBox(),
    emptyState.locator(".empty-icon").boundingBox(),
    emptyState.getByRole("heading", { name: "补丁库还是空的" }).boundingBox(),
    emptyState.getByText("将 NPK 或 BK2 文件拖入此处开始整理。").boundingBox(),
  ]);
  expect(emptyStateBox).not.toBeNull();
  expect(iconBox).not.toBeNull();
  expect(headingBox).not.toBeNull();
  expect(messageBox).not.toBeNull();
  if (emptyStateBox === null || iconBox === null || headingBox === null || messageBox === null) {
    throw new Error("Empty state did not expose visible bounds");
  }

  return {
    emptyState: emptyStateBox,
    content: contentBounds([iconBox, headingBox, messageBox]),
  };
}

test("keeps the empty state centered while the workspace resizes", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-empty-state-centering-e2e-"));
  const application = await electron.launch({ args: [projectRoot], cwd: runtimeRoot });

  try {
    const page = await application.firstWindow();
    await page.setViewportSize({ width: 1080, height: 720 });
    const minimumLayout = await readEmptyStateLayout(page);

    await page.setViewportSize({ width: 1440, height: 900 });
    const expandedLayout = await readEmptyStateLayout(page);

    const minimumCenter = center(minimumLayout.emptyState);
    const minimumContentCenter = center(minimumLayout.content);
    const expandedCenter = center(expandedLayout.emptyState);
    const expandedContentCenter = center(expandedLayout.content);

    expect(Math.abs(minimumContentCenter.x - minimumCenter.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(minimumContentCenter.y - minimumCenter.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(expandedContentCenter.x - expandedCenter.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(expandedContentCenter.y - expandedCenter.y)).toBeLessThanOrEqual(1);
    expect(expandedLayout.emptyState.height).toBeGreaterThan(minimumLayout.emptyState.height + 40);
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

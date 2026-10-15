import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, type Locator, type Page, test } from "@playwright/test";

/**
 * 把指针移到卡片的取点上，并在两步之间各留一帧。
 *
 * 卡片左上角那块热点（`.item-preview-hover-zone`）默认 `pointer-events: none`，
 * 由 `.item-card-shell:hover > .item-preview-hover-zone` 打开。Chromium 要到下一帧
 * 才会拿新的 `pointer-events` 做命中测试：在同一个任务里连发「进卡片中心 → 进热点」
 * 两个 mousemove，热点仍被当成 `pointer-events: none` 跳过，`:hover` 落到卡片内层
 * 元素上（shell 因此被点亮），`.item-preview-hover-zone:hover` 不成立、缩放图
 * opacity 停在 0——实测同一用例 40 次重复 40 次失败。分帧后 `:hover` 才会落到热点
 * 自己身上（逐步探针：不隔帧全红，隔 300ms 全部命中）。
 *
 * 中间先停卡片中心而不是卡片外：离开卡片会让 `shell:hover` 掉线，热点又变回不可命中。
 * 每一步都换坐标也是必须的——应用启动后还会再渲染一次卡片树，重渲染会丢掉 `:hover`，
 * 而把指针移到同一个坐标不会再触发命中测试，那一次悬停就此失效。
 *
 * 用 `mouse.move` 而不是 `locator.hover()`：后者带可操作性检查，缩放图盖住取点时
 * 会先等满 30s 动作超时。
 */
const HOVER_SETTLE_MS = 60;

const hoverCardPoint = async (
  page: Page,
  card: Locator,
  point?: { x: number; y: number },
): Promise<void> => {
  const box = await card.boundingBox();
  if (box === null) {
    return;
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(HOVER_SETTLE_MS);
  await page.mouse.move(box.x + (point?.x ?? box.width / 2), box.y + (point?.y ?? box.height / 2));
  await page.waitForTimeout(HOVER_SETTLE_MS);
};

/**
 * 每一轮都重新落点再读值。
 *
 * 只落一次点是不够的：重渲染丢掉 `:hover` 之后，指针不动就不会再有新的命中测试，
 * 那一次悬停永久失效（实测 40 次重复里 4 次卡在描边断言）。取值和时间窗都没放宽。
 */
const hoverAndRead = async <T>(
  page: Page,
  card: Locator,
  read: () => Promise<T>,
  point?: { x: number; y: number },
): Promise<T> => {
  await hoverCardPoint(page, card, point);
  return read();
};

test("switches real library items between stable grid and list views", async () => {
  // 这条用例把 `electron.launch` 放在用例体内（第 83 行），所以默认 30s 预算是
  // 「启动 Electron + 首帧 + 全部断言」共用的。机器负载高时（例如连续重复跑、
  // 或与其它会话的 e2e 同时启动）启动本身就能吃掉二十多秒，而第 99 行的
  // `boundingBox()` 等渲染时的动作超时默认就等于用例超时——于是失败形态是
  // 一句没有任何断言的 `Test timeout of 30000ms exceeded`，把真实原因藏住。
  // 这里把预算放大，慢的那次会以真实耗时（十几秒）显形，而不是伪装成断言问题。
  test.slow();
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-view-controls-e2e-"));
  const libraryRoot = join(runtimeRoot, "patch-categories");
  const childRoot = join(libraryRoot, "Armor");
  const nestedRoot = join(childRoot, "Cloth");
  const screenshotRoot = join(projectRoot, ".scratch");
  await Promise.all([
    mkdir(libraryRoot, { recursive: true }),
    mkdir(nestedRoot, { recursive: true }),
    mkdir(screenshotRoot, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(libraryRoot, "coat.npk"), "coat-payload"),
    writeFile(
      join(libraryRoot, "coat.png"),
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    ),
    writeFile(join(libraryRoot, "sword.npk"), "sword-payload"),
    writeFile(join(childRoot, "coat.npk"), "child-coat-payload"),
    writeFile(join(nestedRoot, "nested-coat.npk"), "nested-coat-payload"),
  ]);
  // --user-data-dir（等号形式）让单实例锁与用户正在运行的应用隔离，避免 e2e 实例被挤出。
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });

  try {
    const page = await application.firstWindow();
    await page.setViewportSize({ width: 1280, height: 720 });
    const toolbarControls = [
      page.getByRole("button", { name: "设置" }),
      page.getByRole("button", { name: "调整外观" }),
      page.getByRole("button", { name: "新建文件夹" }),
      page.locator(".workspace-search-field"),
      page.locator(".view-mode-control"),
      page.getByRole("checkbox", { name: "包含子分类" }),
    ];
    const toolbarBoxes = await Promise.all(toolbarControls.map((control) => control.boundingBox()));
    expect(toolbarBoxes.every((box) => box !== null)).toBe(true);
    const toolbarCenters = toolbarBoxes.map((box) => {
      if (box === null) {
        throw new Error("Top toolbar control did not expose a visible bounding box");
      }
      return box.y + box.height / 2;
    });
    expect(Math.max(...toolbarCenters) - Math.min(...toolbarCenters)).toBeLessThan(1);
    const items = page.getByRole("region", { name: "补丁项目" });
    await expect(items).toHaveAttribute("data-card-size", "medium");
    await expect(page.locator(".app-toolbar")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "增大卡片" })).toHaveCount(0);
    const gridCard = page
      .locator(".item-grid .item-card")
      .filter({ has: page.locator(".item-preview-image") })
      .first();
    const gridCardBox = await gridCard.boundingBox();
    expect(gridCardBox).not.toBeNull();
    if (gridCardBox === null) {
      throw new Error("Grid card did not expose a visible bounding box");
    }
    expect(Math.abs(gridCardBox.width / gridCardBox.height - 4 / 3)).toBeLessThan(0.03);
    expect(gridCardBox.width).toBeGreaterThan(200);
    // 悬停类断言读的是过渡的终值，而「每轮重新落点」与「过渡还没走完」天生冲突：
    // 轮询约 100ms 一轮，opacity 的过渡是 150ms（--motion-standard），每轮重进热点都会
    // 把它按回起点，于是永远读不到 1（实测稳定停在 0.920279，正是重新落点后约 120ms
    // 时的进度）。这里把项目的减弱动效声明搬到页面上：tokens.css:227 的
    // `@media (prefers-reduced-motion: reduce)` 把 `*` 的 transition-duration 与
    // transition-delay 压到 0.001ms，这条规则对页面等价可用、且不改变任何断言要求。
    //   - Playwright 的 `page.emulateMedia({ reducedMotion: "reduce" })` 对 Electron
    //     页面不生效（实测过渡仍是 150ms、opacity 停在 0.92），所以直接注入声明；
    //   - 必须 `!important`：组件自己的 `.item-preview-hover-image { transition: … }`
    //     是类选择器，特异性高过 `*`，不加 !important 会被压过去；
    //   - 后面 `transitionDuration` 的断言是 `not.toContain("0s")`，读到 `0.001ms`
    //     仍然通过。断言要求一条都没放宽，只是让读数不再依赖过渡进度。
    await page.addStyleTag({
      content:
        "*, *::before, *::after { transition-duration: 0.001ms !important; transition-delay: 0.001ms !important; }",
    });
    const beforeHoverBox = await gridCard.boundingBox();
    await expect
      .poll(() =>
        hoverAndRead(page, gridCard, () =>
          gridCard.evaluate((element) => getComputedStyle(element).borderColor),
        ),
      )
      .toBe("rgb(91, 107, 255)");
    const afterHoverBox = await gridCard.boundingBox();
    expect(beforeHoverBox).not.toBeNull();
    expect(afterHoverBox).not.toBeNull();
    if (beforeHoverBox === null || afterHoverBox === null) {
      throw new Error("Grid card did not expose hover bounding boxes");
    }
    expect(Math.abs(afterHoverBox.y - beforeHoverBox.y)).toBeLessThan(0.5);
    const gridCardShell = gridCard.locator("xpath=..");
    const hoverZone = gridCardShell.locator(".item-preview-hover-zone");
    const zoomImage = hoverZone.locator(".item-preview-hover-image");
    // 沿用原用例的取点（卡片左上角内侧 2px），只把写死的屏幕坐标改成按卡片现算：
    // 上面 gridCardBox 是三十行前量的，卡片位移之后那个坐标就指空了。
    const zoomPointer = { x: 2, y: 2 };
    await expect
      .poll(() => hoverAndRead(page, gridCard, () => hoverZone.isVisible(), zoomPointer))
      .toBe(true);
    await expect
      .poll(() => hoverAndRead(page, gridCard, () => zoomImage.isVisible(), zoomPointer))
      .toBe(true);
    await expect
      .poll(() =>
        hoverAndRead(
          page,
          gridCard,
          () => zoomImage.evaluate((element) => (element as HTMLImageElement).naturalWidth),
          zoomPointer,
        ),
      )
      .toBeGreaterThan(0);
    await expect
      .poll(() =>
        hoverAndRead(
          page,
          gridCard,
          () =>
            zoomImage.evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity)),
          zoomPointer,
        ),
      )
      .toBeGreaterThan(0.99);
    const zoomBox = await zoomImage.boundingBox();
    expect(zoomBox).not.toBeNull();
    if (zoomBox === null) {
      throw new Error("Preview zoom did not expose a visible bounding box");
    }
    const gridZoomStyle = await zoomImage.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).width),
    );
    const zoomStyle = await zoomImage.evaluate((element) => {
      const image = element as HTMLImageElement;
      const computed = getComputedStyle(element);
      return {
        naturalRatio: image.naturalWidth / image.naturalHeight,
        transitionDuration: computed.transitionDuration,
        transitionProperty: computed.transitionProperty,
      };
    });
    expect(Math.abs(zoomBox.width / zoomBox.height - zoomStyle.naturalRatio)).toBeLessThan(0.03);
    expect(zoomStyle.transitionProperty).toContain("transform");
    expect(zoomStyle.transitionDuration).not.toContain("0s");
    expect(zoomBox.width).toBeGreaterThan(gridCardBox.width * 1.9);
    expect(zoomBox.width).toBeLessThan(gridCardBox.width * 2.1);
    const afterZoomCardBox = await gridCard.boundingBox();
    expect(afterZoomCardBox).not.toBeNull();
    if (afterZoomCardBox === null) {
      throw new Error("Grid card disappeared while preview zoom was visible");
    }
    expect(Math.abs(afterZoomCardBox.width - gridCardBox.width)).toBeLessThan(0.5);
    await page.mouse.move(0, 0);
    await expect(zoomImage).toBeHidden();
    await gridCard.click();
    await expect
      .poll(() => gridCard.evaluate((element) => getComputedStyle(element).borderColor))
      .toBe("rgb(245, 213, 71)");
    const previewBox = await gridCard.locator(".item-preview").boundingBox();
    const bodyBox = await gridCard.locator(".item-card-body").boundingBox();
    expect(previewBox).not.toBeNull();
    expect(bodyBox).not.toBeNull();
    if (previewBox === null || bodyBox === null) {
      throw new Error("Grid card preview or body did not expose a visible bounding box");
    }
    expect(previewBox.height).toBeGreaterThan(gridCardBox.height * 0.6);
    expect(previewBox.height).toBeLessThan(gridCardBox.height * 0.8);
    expect(bodyBox.height).toBeGreaterThan(0);
    expect(bodyBox.height).toBeLessThan(60);
    await expect
      .poll(() => gridCard.evaluate((element) => getComputedStyle(element).fontFamily))
      .toContain("Microsoft YaHei");
    await expect(gridCard.locator(".status-badge")).toHaveCount(0);
    const titleBox = await gridCard.locator(".item-title").boundingBox();
    const metaBox = await gridCard.locator(".item-meta").boundingBox();
    const dateBox = await gridCard.locator(".item-date").boundingBox();
    expect(titleBox).not.toBeNull();
    expect(metaBox).not.toBeNull();
    expect(dateBox).not.toBeNull();
    if (titleBox === null || metaBox === null || dateBox === null) {
      throw new Error("Grid card text did not expose visible bounding boxes");
    }
    expect(titleBox.y).toBeLessThan(metaBox.y);
    expect(Math.abs(metaBox.y - dateBox.y)).toBeLessThan(2);
    await expect(page.locator(".selection-indicator")).toHaveCount(0);
    const switchBox = await page
      .locator(".item-grid .item-card-shell .switch")
      .first()
      .boundingBox();
    expect(dateBox).not.toBeNull();
    expect(switchBox).not.toBeNull();
    if (dateBox === null || switchBox === null) {
      throw new Error("Grid card metadata or switch did not expose a visible bounding box");
    }
    expect(switchBox.width).toBeLessThan(40);
    expect(switchBox.height).toBeLessThan(24);
    const overlaps =
      dateBox.x < switchBox.x + switchBox.width &&
      dateBox.x + dateBox.width > switchBox.x &&
      dateBox.y < switchBox.y + switchBox.height &&
      dateBox.y + dateBox.height > switchBox.y;
    expect(
      overlaps,
      `metadata ${JSON.stringify(dateBox)} overlaps switch ${JSON.stringify(switchBox)}`,
    ).toBe(false);
    await page.screenshot({ path: join(screenshotRoot, "task-8-grid-1280.png") });

    await page.getByRole("button", { name: "列表视图" }).click();
    await expect(page.getByRole("columnheader", { name: "名称" })).toHaveCount(0);
    const listCard = page
      .locator(".item-list .item-card")
      .filter({ has: page.locator(".item-preview-image") })
      .first();
    const listShell = listCard.locator("xpath=..");
    await expect(listCard.locator(".status-badge")).toHaveCount(0);
    await listCard.hover();
    await listShell.locator(".item-preview-hover-zone").hover();
    const listZoomImage = listShell.locator(".item-preview-hover-image");
    await expect(listZoomImage).toBeVisible();
    await expect
      .poll(() =>
        listZoomImage.evaluate((element) => Number.parseFloat(getComputedStyle(element).opacity)),
      )
      .toBeGreaterThan(0.99);
    const listZoomBox = await listZoomImage.boundingBox();
    expect(listZoomBox).not.toBeNull();
    if (listZoomBox === null) {
      throw new Error("List preview zoom did not expose a visible bounding box");
    }
    const listZoomStyle = await listZoomImage.evaluate((element) => {
      const image = element as HTMLImageElement;
      const computed = getComputedStyle(element);
      return {
        naturalRatio: image.naturalWidth / image.naturalHeight,
        width: Number.parseFloat(computed.width),
      };
    });
    expect(Math.abs(listZoomStyle.width - gridZoomStyle)).toBeLessThan(1);
    expect(Math.abs(listZoomBox.width - zoomBox.width)).toBeLessThan(1);
    expect(listZoomBox.width).toBeGreaterThan(0);
    expect(
      Math.abs(listZoomBox.width / listZoomBox.height - listZoomStyle.naturalRatio),
    ).toBeLessThan(0.03);
    await page.screenshot({ path: join(screenshotRoot, "task-8-list-1280.png") });

    await page.getByRole("button", { name: "Armor", exact: true }).click();
    await expect(page.getByRole("button", { name: "coat.npk", exact: true })).toBeVisible();
    await page.getByRole("checkbox", { name: "包含子分类" }).check();
    const descendant = page.getByRole("button", {
      name: "nested-coat.npk - Armor\\Cloth\\nested-coat.npk",
    });
    await expect(descendant).toBeVisible();
    await expect(descendant).toContainText("Cloth");
    await page.screenshot({ path: join(screenshotRoot, "task-8-descendants-1280.png") });
    await page.getByRole("checkbox", { name: "包含子分类" }).uncheck();
    await expect(descendant).toHaveCount(0);
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

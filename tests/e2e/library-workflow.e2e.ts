import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron as electron, expect, type Page, test } from "@playwright/test";

async function dropFiles(page: Page, filePaths: readonly string[]): Promise<void> {
  await page.evaluate(() => {
    const input = document.createElement("input");
    input.dataset["e2eDropInput"] = "true";
    input.multiple = true;
    input.type = "file";
    input.hidden = true;
    document.body.append(input);
  });
  await page.locator('input[data-e2e-drop-input="true"]').setInputFiles(filePaths);
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('input[data-e2e-drop-input="true"]');
    const workspace = document.querySelector<HTMLElement>('main[aria-label="补丁工作区"]');
    if (input === null || workspace === null) throw new Error("Drop test setup is incomplete");
    const dataTransfer = new DataTransfer();
    for (const file of Array.from(input.files ?? [])) dataTransfer.items.add(file);
    workspace.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }),
    );
    input.remove();
  });
}

test("stores patch previews beside NPK files and group previews as managed assets", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-library-preview-e2e-"));
  const libraryRoot = join(runtimeRoot, "patch-categories");
  const previewRoot = join(runtimeRoot, "data", "previews");
  const groupPath = join(libraryRoot, "Set");
  const patchSource = join(runtimeRoot, "selected-patch.png");
  const groupSource = join(runtimeRoot, "selected-group.png");
  const previewBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  await mkdir(groupPath, { recursive: true });
  await Promise.all([
    writeFile(join(libraryRoot, "A.npk"), "patch"),
    writeFile(join(libraryRoot, "A-wrong.png"), "mismatch"),
    writeFile(join(groupPath, "inside.npk"), "inside"),
    writeFile(
      join(groupPath, ".dnf-group.json"),
      JSON.stringify({
        formatVersion: 1,
        id: "0552babf-49b5-4390-96a7-1846a0c1e9f8",
        displayName: "Set",
        createdAt: "2026-07-18T00:00:00.000Z",
      }),
    ),
    writeFile(patchSource, previewBytes),
    writeFile(groupSource, previewBytes),
  ]);
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });

  try {
    await application.evaluate(
      ({ dialog }, filePaths) => {
        let selection = 0;
        dialog.showOpenDialog = async () => {
          const filePath = filePaths[selection++] ?? filePaths[filePaths.length - 1];
          if (filePath === undefined) throw new Error("No preview source path configured");
          return { canceled: false, filePaths: [filePath] };
        };
      },
      [patchSource, groupSource],
    );
    const page = await application.firstWindow();
    await page.getByRole("main", { name: "补丁工作区" }).waitFor();
    const patch = page.getByRole("button", { name: "A.npk", exact: true });
    const patchShell = patch.locator("..");
    const group = page.getByRole("button", { name: "Set", exact: true });
    await expect(patch.locator(".item-preview-image")).toHaveCount(0);

    await patch.locator(".item-preview").hover();
    await patchShell.locator(".item-preview-hover-zone").dblclick();
    await expect
      .poll(() => readFile(join(libraryRoot, "A.png")).catch(() => null))
      .toEqual(previewBytes);
    await expect(patch.locator(".item-preview-image")).toHaveAttribute(
      "src",
      /^dnf-library:\/\/library\/A\.png\?v=\d+$/u,
    );
    await expect
      .poll(() =>
        patch
          .locator(".item-preview-image")
          .evaluate(
            (image) =>
              image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
          ),
      )
      .toBe(true);
    await expect(readFile(join(libraryRoot, "A-wrong.png"), "utf8")).resolves.toBe("mismatch");

    await group.locator(".item-preview").dblclick();
    await expect
      .poll(() =>
        readdir(previewRoot).then(
          (entries) => entries.length,
          () => 0,
        ),
      )
      .toBe(1);
    await expect(group.locator(".item-preview-image")).toHaveAttribute(
      "src",
      /^dnf-asset:\/\/preview\/[0-9a-f-]+\.png$/u,
    );
    await expect
      .poll(() =>
        group
          .locator(".item-preview-image")
          .evaluate(
            (image) =>
              image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
          ),
      )
      .toBe(true);
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("imports, groups, recycles and restores real NPK files", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-library-workflow-"));
  const sourceRoot = join(runtimeRoot, "sources");
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(join(sourceRoot, "coat.npk"), "coat-payload");
  await writeFile(join(sourceRoot, "sword.npk"), "sword-payload");
  const sourcePaths = [join(sourceRoot, "coat.npk"), join(sourceRoot, "sword.npk")];
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });

  try {
    await application.evaluate(({ shell }) => {
      shell.showItemInFolder = (filePath) => {
        (globalThis as typeof globalThis & { revealedPatchPath?: string }).revealedPatchPath =
          filePath;
      };
    });
    const page = await application.firstWindow();
    await page.getByRole("main", { name: "补丁工作区" }).waitFor();
    await dropFiles(page, sourcePaths);
    await expect(page.getByRole("button", { name: "coat.npk", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "sword.npk", exact: true })).toBeVisible();
    await expect(page.locator(".toast-viewport")).toHaveCount(0);

    await page.getByRole("button", { name: "coat.npk", exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "源文件", exact: true }).click();
    await expect
      .poll(() =>
        application.evaluate(
          () =>
            (globalThis as typeof globalThis & { revealedPatchPath?: string }).revealedPatchPath,
        ),
      )
      .toBe(join(runtimeRoot, "patch-categories", "coat.npk"));

    await page.getByRole("button", { name: "coat.npk", exact: true }).click();
    await page
      .getByRole("button", { name: "sword.npk", exact: true })
      .click({ modifiers: ["Control"] });
    await page.getByRole("button", { name: "sword.npk", exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "打组", exact: true }).click();
    await expect(page.getByRole("button", { name: "自定义", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "全部", exact: true })).toContainText("1");

    const groupPath = join(runtimeRoot, "patch-categories", "自定义");
    await expect(access(groupPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(runtimeRoot, "patch-categories", "coat.npk"), "utf8")).toBe(
      "coat-payload",
    );
    expect(
      JSON.parse(await readFile(join(runtimeRoot, "data", "groups.json"), "utf8")),
    ).toMatchObject({
      groups: [
        {
          name: "自定义",
          categoryRelativePath: "",
          memberRelativePaths: ["coat.npk", "sword.npk"],
        },
      ],
    });

    await page.getByRole("button", { name: "自定义", exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "删除", exact: true }).click();
    await expect(page.getByRole("button", { name: "自定义", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "回收站", exact: true }).click();
    // 回收站视图没有可见标题，用工作区自身的 aria-label 断言已切换到该视图
    await expect(page.getByRole("main", { name: "回收站" })).toBeVisible();
    const restoreButtons = page.getByRole("button", { name: "恢复", exact: true });
    await expect(restoreButtons).toHaveCount(2);
    await restoreButtons.first().click();
    await expect(restoreButtons).toHaveCount(1);
    await restoreButtons.click();
    await expect(restoreButtons).toHaveCount(0);
    await expect(page.getByRole("button", { name: "自定义", exact: true })).toHaveCount(0);
    await expect(access(groupPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(runtimeRoot, "patch-categories", "coat.npk"), "utf8")).resolves.toBe(
      "coat-payload",
    );
    await expect(
      readFile(join(runtimeRoot, "patch-categories", "sword.npk"), "utf8"),
    ).resolves.toBe("sword-payload");
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("changes a patch preview from inside a virtual group", async () => {
  test.setTimeout(60_000);
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-group-preview-e2e-"));
  const libraryRoot = join(runtimeRoot, "patch-categories");
  const oldPreviewPath = join(projectRoot, "前端", "screenshots", "preview-desktop.png");
  const replacementPath = join(projectRoot, "前端", "screenshots", "cover.png");
  const [oldBytes, replacementBytes] = await Promise.all([
    readFile(oldPreviewPath),
    readFile(replacementPath),
  ]);
  await mkdir(libraryRoot, { recursive: true });
  await Promise.all([
    writeFile(join(libraryRoot, "a.npk"), "a-payload"),
    writeFile(join(libraryRoot, "b.npk"), "b-payload"),
    writeFile(join(libraryRoot, "a.png"), oldBytes),
  ]);
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });

  try {
    await application.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
    }, replacementPath);
    const page = await application.firstWindow();
    await page.getByRole("main", { name: "补丁工作区" }).waitFor();
    const patch = page.getByRole("button", { name: "a.npk", exact: true });
    await expect(patch.locator(".item-preview-image")).toHaveCount(1);

    await patch.click();
    await page
      .getByRole("button", { name: "b.npk", exact: true })
      .click({ modifiers: ["Control"] });
    await page.getByRole("button", { name: "b.npk", exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "打组", exact: true }).click();
    await expect(page.getByRole("button", { name: "自定义", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "自定义", exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "进入组", exact: true }).click();
    await expect(patch.locator(".item-preview-image")).toHaveCount(1);
    await expect
      .poll(() =>
        patch
          .locator(".item-preview-image")
          .evaluate((image) => (image instanceof HTMLImageElement ? image.naturalWidth : 0)),
      )
      .toBe(1440);
    const patchShell = patch.locator("..");
    await patch.locator(".item-preview").hover();
    await patchShell.locator(".item-preview-hover-zone").dblclick();

    await expect(readFile(join(libraryRoot, "a.png"))).resolves.toEqual(replacementBytes);
    await expect
      .poll(() =>
        patch
          .locator(".item-preview-image")
          .evaluate((image) => (image instanceof HTMLImageElement ? image.naturalWidth : 0)),
      )
      .toBe(1200);
    await expect(patch.locator(".item-preview-image")).toHaveAttribute(
      "src",
      /^dnf-library:\/\/library\/a\.png\?v=\d+$/u,
    );
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("renames a patch inline with F2 and Enter", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-inline-rename-e2e-"));
  const libraryRoot = join(runtimeRoot, "patch-categories");
  const oldPath = join(libraryRoot, "coat.npk");
  const newPath = join(libraryRoot, "coat-renamed.npk");
  await mkdir(libraryRoot, { recursive: true });
  await writeFile(oldPath, "coat-payload");
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });

  try {
    const page = await application.firstWindow();
    await page.getByRole("button", { name: "coat.npk", exact: true }).focus();
    await page.getByRole("button", { name: "coat.npk", exact: true }).press("F2");
    const editor = page.getByRole("textbox", { name: "重命名 coat.npk" });
    await expect(editor).toHaveValue("coat");
    await editor.fill("coat-renamed");
    await editor.press("Enter");

    await expect(page.getByRole("button", { name: "coat-renamed.npk", exact: true })).toBeVisible();
    await expect(access(oldPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(newPath, "utf8")).resolves.toBe("coat-payload");
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("dissolves a patch group directly from its context menu", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-dissolve-group-e2e-"));
  const libraryRoot = join(runtimeRoot, "patch-categories");
  const groupPath = join(libraryRoot, "自定义");
  await mkdir(libraryRoot, { recursive: true });
  await Promise.all([
    writeFile(join(libraryRoot, "coat.npk"), "coat-payload"),
    writeFile(join(libraryRoot, "sword.npk"), "sword-payload"),
  ]);
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });

  try {
    const page = await application.firstWindow();
    await page.getByRole("button", { name: "coat.npk", exact: true }).click();
    await page
      .getByRole("button", { name: "sword.npk", exact: true })
      .click({ modifiers: ["Control"] });
    await page.getByRole("button", { name: "sword.npk", exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "打组", exact: true }).click();
    await expect(page.getByRole("button", { name: "自定义", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "自定义", exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "解散组", exact: true }).click();

    await expect(page.getByRole("button", { name: "自定义", exact: true })).toHaveCount(0);
    await expect(access(groupPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(libraryRoot, "coat.npk"), "utf8")).resolves.toBe("coat-payload");
    await expect(readFile(join(libraryRoot, "sword.npk"), "utf8")).resolves.toBe("sword-payload");
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("adds a patch card to a logical group", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-drop-into-group-e2e-"));
  const libraryRoot = join(runtimeRoot, "patch-categories");
  const groupPath = join(libraryRoot, "自定义");
  await mkdir(libraryRoot, { recursive: true });
  await Promise.all([
    writeFile(join(libraryRoot, "coat.npk"), "coat-payload"),
    writeFile(join(libraryRoot, "sword.npk"), "sword-payload"),
    writeFile(join(libraryRoot, "hat.npk"), "hat-payload"),
  ]);
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });

  try {
    const page = await application.firstWindow();
    await page.getByRole("button", { name: "coat.npk", exact: true }).click();
    await page
      .getByRole("button", { name: "sword.npk", exact: true })
      .click({ modifiers: ["Control"] });
    await page.getByRole("button", { name: "sword.npk", exact: true }).click({ button: "right" });
    await page.getByRole("menuitem", { name: "打组", exact: true }).click();
    const group = page.getByRole("button", { name: "自定义", exact: true });
    await expect(group).toBeVisible();

    await page.getByRole("button", { name: "hat.npk", exact: true }).dragTo(group);

    await expect(page.getByRole("button", { name: "hat.npk", exact: true })).toHaveCount(0);
    await expect(access(groupPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(join(libraryRoot, "hat.npk"), "utf8")).resolves.toBe("hat-payload");
    expect(
      JSON.parse(await readFile(join(runtimeRoot, "data", "groups.json"), "utf8")),
    ).toMatchObject({
      groups: [
        {
          name: "自定义",
          memberRelativePaths: ["coat.npk", "sword.npk", "hat.npk"],
        },
      ],
    });
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("keeps an inline rename editor inside the card name area", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-inline-rename-layout-e2e-"));
  const libraryRoot = join(runtimeRoot, "patch-categories");
  await mkdir(libraryRoot, { recursive: true });
  await writeFile(join(libraryRoot, "coat.npk"), "coat-payload");
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });

  try {
    const page = await application.firstWindow();
    const card = page.locator(".item-card-shell", {
      has: page.getByRole("button", { name: "coat.npk", exact: true }),
    });
    await page.getByRole("button", { name: "coat.npk", exact: true }).press("F2");

    const [editorBox, nameBox, metadataBox] = await Promise.all([
      page.getByRole("textbox", { name: "重命名 coat.npk" }).boundingBox(),
      card.locator(".item-name-cell").boundingBox(),
      card.locator(".item-meta").boundingBox(),
    ]);
    expect(editorBox).not.toBeNull();
    expect(nameBox).not.toBeNull();
    expect(metadataBox).not.toBeNull();
    if (editorBox === null || nameBox === null || metadataBox === null) {
      throw new Error("Inline rename layout did not expose card dimensions");
    }
    expect(editorBox.x).toBeGreaterThanOrEqual(nameBox.x);
    expect(editorBox.x + editorBox.width).toBeLessThanOrEqual(nameBox.x + nameBox.width);
    expect(editorBox.y).toBeGreaterThanOrEqual(nameBox.y);
    expect(editorBox.y + editorBox.height).toBeLessThanOrEqual(metadataBox.y);
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("opens move destinations from the context-menu hover submenu", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-move-submenu-e2e-"));
  const libraryRoot = join(runtimeRoot, "patch-categories");
  const gameRoot = join(runtimeRoot, "game");
  const nestedCategory = join(libraryRoot, "Armor", "Nested");
  const oldPath = join(libraryRoot, "coat.npk");
  const newPath = join(libraryRoot, "分类A", "coat.npk");
  await mkdir(join(libraryRoot, "分类A"), { recursive: true });
  await mkdir(nestedCategory, { recursive: true });
  // 游戏根目录校验要求 ImagePacks2 / SoundPacks / video 三个子目录全部存在
  await Promise.all([
    mkdir(join(gameRoot, "ImagePacks2"), { recursive: true }),
    mkdir(join(gameRoot, "SoundPacks"), { recursive: true }),
    mkdir(join(gameRoot, "video"), { recursive: true }),
  ]);
  await writeFile(oldPath, "coat-payload");
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });

  try {
    const page = await application.firstWindow();
    await application.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
    }, gameRoot);
    await expect
      .poll(() => page.evaluate(() => window.dnf.selectGameDirectory()))
      .toMatchObject({ ok: true, value: { gameDirectory: gameRoot } });
    const card = page.getByRole("button", { name: "coat.npk", exact: true });
    await card.click({ button: "right" });
    const menu = page.getByRole("menu");
    await expect
      .poll(() => menu.evaluate((element) => element.getBoundingClientRect().width))
      .toBeGreaterThanOrEqual(172);
    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    if (menuBox === null) throw new Error("Context menu did not expose a bounding box");
    expect(menuBox.width).toBeLessThanOrEqual(240);
    const menuStyles = await menu.evaluate((element) => {
      const styles = getComputedStyle(element);
      return {
        backdropFilter: styles.backdropFilter,
        backgroundColor: styles.backgroundColor,
        borderRadius: styles.borderRadius,
        padding: styles.padding,
      };
    });
    expect(menuStyles).toEqual({
      backdropFilter: expect.stringContaining("blur(28px)"),
      backgroundColor: "rgba(20, 24, 35, 0.9)",
      borderRadius: "5px",
      padding: "4px",
    });
    await expect(page.locator(".item-context-menu-shortcut")).toHaveText(["Ctrl+G", "F2", "Del"]);
    await expect(page.locator(".item-context-menu-separator")).toHaveCount(1);
    const move = page.getByRole("menuitem", { name: "移动", exact: true });
    const moveBox = await move.boundingBox();
    expect(moveBox).not.toBeNull();
    if (moveBox === null) throw new Error("Move menu item did not expose a bounding box");
    expect(moveBox.width).toBeGreaterThan(0);
    await move.hover();
    const pill = page.locator(".item-context-menu-pill").first();
    await expect(pill).toHaveAttribute("data-danger", "false");
    const movePillTop = await pill.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).top),
    );
    await expect
      .poll(() => move.evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe("rgba(0, 0, 0, 0)");
    const remove = page.getByRole("menuitem", { name: "删除", exact: true });
    await remove.hover();
    await expect(pill).toHaveAttribute("data-danger", "true");
    await expect
      .poll(() => pill.evaluate((element) => Number.parseFloat(getComputedStyle(element).top)))
      .toBeGreaterThan(movePillTop);
    await expect
      .poll(() => pill.evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe("rgba(244, 63, 94, 0.2)");
    await expect
      .poll(() => remove.evaluate((element) => getComputedStyle(element).backgroundColor))
      .toBe("rgba(0, 0, 0, 0)");
    await move.hover();
    const nestedTarget = page.getByRole("menuitem", { name: "Nested", exact: true });
    const categoryTarget = page.getByRole("menuitem", { name: "分类A", exact: true });
    await expect(categoryTarget).toBeVisible();
    await expect(nestedTarget).not.toBeVisible();
    await page.getByRole("menuitem", { name: "Armor", exact: true }).hover();
    await expect(nestedTarget).toBeVisible();
    await categoryTarget.hover();
    const targetBox = await categoryTarget.boundingBox();
    expect(targetBox).not.toBeNull();
    if (targetBox === null) throw new Error("Move target did not expose a bounding box");
    expect(targetBox.width).toBeGreaterThan(0);
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
      steps: 8,
    });
    await expect(categoryTarget).toBeVisible();
    await categoryTarget.click();

    await expect
      .poll(() =>
        access(newPath).then(
          () => true,
          () => false,
        ),
      )
      .toBe(true);
    await expect(access(oldPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(newPath, "utf8")).resolves.toBe("coat-payload");
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("moves a patch into a nested category without a game directory", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-nested-move-e2e-"));
  const libraryRoot = join(runtimeRoot, "patch-categories");
  const sourceCategory = join(libraryRoot, "Female");
  const targetCategory = join(sourceCategory, "Male");
  const oldPath = join(sourceCategory, "coat.npk");
  const newPath = join(targetCategory, "coat.npk");
  await mkdir(targetCategory, { recursive: true });
  await writeFile(oldPath, "coat-payload");
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });

  try {
    const page = await application.firstWindow();
    await page.getByRole("button", { name: "Female", exact: true }).click();
    await page.getByRole("button", { name: "展开 Female", exact: true }).click();
    const card = page.getByRole("button", { name: "coat.npk", exact: true });
    await card.click({ button: "right" });
    const move = page.getByRole("menuitem", { name: "移动", exact: true });
    await move.hover();
    const femaleTarget = page.getByRole("menuitem", { name: "Female", exact: true });
    await expect(femaleTarget).toBeEnabled();
    await femaleTarget.locator("xpath=..").hover();
    const target = page.getByRole("menuitem", { name: "Male", exact: true });
    await expect(target).toBeVisible();
    await expect
      .poll(() => move.evaluate((element) => getComputedStyle(element).paddingTop))
      .toBe("6px");
    await target.click();

    await expect
      .poll(() =>
        access(newPath).then(
          () => true,
          () => false,
        ),
      )
      .toBe(true);
    await expect(access(oldPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(newPath, "utf8")).resolves.toBe("coat-payload");
    await expect(page.getByRole("button", { name: "Male", exact: true })).toContainText("1");
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("keeps every folder move target selectable for a descendant patch", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-parent-move-target-e2e-"));
  const parentName = "技能";
  const childName = "11111111111111111111111111";
  const parentRoot = join(runtimeRoot, "patch-categories", parentName);
  const childRoot = join(parentRoot, childName);
  await mkdir(childRoot, { recursive: true });
  await writeFile(join(childRoot, "coat.npk"), "coat-payload");
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });

  try {
    const page = await application.firstWindow();
    await page.getByRole("main", { name: "补丁工作区" }).waitFor();
    await page.getByRole("button", { name: parentName, exact: true }).click();
    await page.getByRole("checkbox", { name: "包含子分类" }).check();
    const card = page.getByRole("button", { name: /coat\.npk.*技能\\111/u });
    await card.waitFor();
    await card.click({ button: "right" });

    const move = page.getByRole("menuitem", { name: "移动", exact: true });
    await move.hover();
    const parentTarget = page.getByRole("menuitem", { name: parentName, exact: true });
    await expect(parentTarget).toBeEnabled();
    await expect(parentTarget).toHaveClass(/has-children/u);
    await expect
      .poll(() => parentTarget.evaluate((element) => getComputedStyle(element).opacity))
      .toBe("1");
    await parentTarget.hover();
    const parentPill = parentTarget.locator(
      "xpath=ancestor::div[contains(@class, 'item-context-menu-list')][1]/div[contains(@class, 'item-context-menu-pill')]",
    );
    await expect(parentPill).toHaveAttribute("data-danger", "false");
    await expect
      .poll(() => parentPill.evaluate((element) => getComputedStyle(element).opacity))
      .toBe("1");

    const childTarget = page.getByRole("menuitem", { name: childName, exact: true });
    await expect(childTarget).toBeEnabled();
    await expect
      .poll(() => childTarget.evaluate((element) => getComputedStyle(element).opacity))
      .toBe("1");
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("moves from a nested category to another root category", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-cross-root-move-e2e-"));
  const libraryRoot = join(runtimeRoot, "patch-categories");
  const sourceCategory = join(libraryRoot, "Female", "Male");
  const targetCategory = join(libraryRoot, "Other");
  const oldPath = join(sourceCategory, "coat.npk");
  const newPath = join(targetCategory, "coat.npk");
  await mkdir(sourceCategory, { recursive: true });
  await mkdir(targetCategory, { recursive: true });
  await writeFile(oldPath, "coat-payload");
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });

  try {
    const page = await application.firstWindow();
    await page.getByRole("button", { name: "Female", exact: true }).click();
    await page.getByRole("button", { name: "展开 Female", exact: true }).click();
    await page.getByRole("button", { name: "Male", exact: true }).click();
    const card = page.getByRole("button", { name: "coat.npk", exact: true });
    await card.click({ button: "right" });

    const move = page.locator(".item-context-submenu > .item-context-menu-item");
    await move.hover();
    const otherTarget = page.getByRole("menuitem", { name: "Other", exact: true });
    await expect(otherTarget).toBeVisible();

    const femaleTarget = page.getByRole("menuitem", { name: "Female", exact: true });
    await femaleTarget.locator("xpath=..").hover();
    await expect(page.getByRole("menuitem", { name: "Male", exact: true })).toBeEnabled();
    await expect(otherTarget).toBeVisible();
    await otherTarget.click();

    await expect
      .poll(() =>
        access(newPath).then(
          () => true,
          () => false,
        ),
      )
      .toBe(true);
    await expect(access(oldPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(newPath, "utf8")).resolves.toBe("coat-payload");
    // 空分类不渲染计数徽标（25186d4 起），只有非空分类能读到数字
    await expect(
      page.getByRole("button", { name: "Other", exact: true }).locator(".category-count"),
    ).toHaveText("1");
    await expect(
      page.getByRole("button", { name: "Male", exact: true }).locator(".category-count"),
    ).toHaveCount(0);
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("reorders real categories and persists their parent-scoped order", async () => {
  // Given: two real root categories in their default alphabetical order.
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-category-order-e2e-"));
  await Promise.all([
    mkdir(join(runtimeRoot, "patch-categories", "Category A"), { recursive: true }),
    mkdir(join(runtimeRoot, "patch-categories", "Category B"), { recursive: true }),
  ]);
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });

  try {
    const page = await application.firstWindow();
    const source = page.getByRole("button", { name: "Category A", exact: true });
    const target = page.getByRole("button", { name: "Category B", exact: true });
    await expect(source).toBeVisible();
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    if (sourceBox === null || targetBox === null) {
      throw new Error("Visible category rows did not expose pointer coordinates");
    }

    // When: pointer ordering starts on the unselected first row and crosses the second's lower edge.
    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height * 0.9);
    await page.mouse.up();

    // Then: the visible order changes and the same parent-scoped order exists on disk.
    await expect
      .poll(async () =>
        page
          .locator(".category-node-line > .category-row")
          .evaluateAll((rows) => rows.slice(0, 2).map((row) => row.getAttribute("aria-label"))),
      )
      .toEqual(["Category B", "Category A"]);
    await expect
      .poll(async () =>
        JSON.parse(await readFile(join(runtimeRoot, "data", "category-order.json"), "utf8")),
      )
      .toMatchObject({ orders: { "": ["Category B", "Category A"] } });
    await expect(source).not.toHaveClass(/selected/u);
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("moves a nested category into another category from the tree", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-category-tree-move-e2e-"));
  const sourceCategory = join(runtimeRoot, "patch-categories", "Female", "Male");
  const nestedCategory = join(sourceCategory, "Nested");
  const targetCategory = join(runtimeRoot, "patch-categories", "Interface");
  await mkdir(nestedCategory, { recursive: true });
  await mkdir(targetCategory, { recursive: true });
  await Promise.all([
    writeFile(join(sourceCategory, "male.npk"), "male-payload"),
    writeFile(join(nestedCategory, "nested.npk"), "nested-payload"),
  ]);
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });

  try {
    const page = await application.firstWindow();
    await page.getByRole("button", { name: "展开 Female", exact: true }).click();
    const source = page.getByRole("button", { name: "Male", exact: true });
    const target = page.getByRole("button", { name: "Interface", exact: true });
    await expect(source).toBeVisible();
    await expect(target).toBeVisible();
    const sourceBox = await source.boundingBox();
    const targetBox = await target.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    if (sourceBox === null || targetBox === null) {
      throw new Error("Category rows did not expose pointer coordinates");
    }

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, {
      steps: 8,
    });
    await page.mouse.up();

    const movedCategory = join(targetCategory, "Male");
    await expect
      .poll(() =>
        access(join(movedCategory, "male.npk")).then(
          () => true,
          () => false,
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        access(join(movedCategory, "Nested", "nested.npk")).then(
          () => true,
          () => false,
        ),
      )
      .toBe(true);
    await expect(access(sourceCategory)).rejects.toMatchObject({ code: "ENOENT" });
    await expect
      .poll(() =>
        access(join(runtimeRoot, "data", "category-order.json")).then(
          () => true,
          () => false,
        ),
      )
      .toBe(true);
    await expect
      .poll(async () =>
        JSON.parse(await readFile(join(runtimeRoot, "data", "category-order.json"), "utf8")),
      )
      .toMatchObject({ orders: { Female: [], Interface: ["Interface\\Male"] } });
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("moves a nested category out to the root with the blank drop zone", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-category-root-move-e2e-"));
  const nestedCategory = join(runtimeRoot, "patch-categories", "Parent", "Child");
  await mkdir(nestedCategory, { recursive: true });
  await mkdir(join(runtimeRoot, "patch-categories", "Sibling"), { recursive: true });
  await writeFile(join(nestedCategory, "child.npk"), "child-payload");
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });

  try {
    const page = await application.firstWindow();
    await page.getByRole("main", { name: "补丁工作区" }).waitFor();
    await page.getByRole("button", { name: "展开 Parent", exact: true }).click();
    const source = page.getByRole("button", { name: "Child", exact: true });
    await expect(source).toBeVisible();
    const sourceBox = await source.boundingBox();
    expect(sourceBox).not.toBeNull();
    if (sourceBox === null) throw new Error("Nested category row did not expose coordinates");

    await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    const dropZone = page.locator("[data-category-root-drop]");
    await expect(dropZone).toBeVisible();
    const dropBox = await dropZone.boundingBox();
    expect(dropBox).not.toBeNull();
    if (dropBox === null) throw new Error("Root drop zone did not expose coordinates");
    await page.mouse.move(dropBox.x + dropBox.width / 2, dropBox.y + dropBox.height / 2, {
      steps: 8,
    });
    await page.mouse.up();

    const movedCategory = join(runtimeRoot, "patch-categories", "Child");
    await expect
      .poll(() =>
        access(join(movedCategory, "child.npk")).then(
          () => true,
          () => false,
        ),
      )
      .toBe(true);
    await expect(access(nestedCategory)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("creates categories and deletes empty categories with Delete", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-category-commands-e2e-"));
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });

  try {
    const page = await application.firstWindow();
    await page.getByRole("main", { name: "补丁工作区" }).waitFor();
    await page.getByRole("button", { name: "新建子分类" }).click();
    await page.getByRole("textbox", { name: "分类名称" }).fill("测试分类");
    await page.getByRole("button", { name: "确认", exact: true }).click();
    const createdPath = join(runtimeRoot, "patch-categories", "测试分类");
    await expect
      .poll(() =>
        access(createdPath).then(
          () => true,
          () => false,
        ),
      )
      .toBe(true);

    await page.getByRole("button", { name: "测试分类", exact: true }).click();
    await expect(page.getByRole("button", { name: "重命名分类" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "删除分类" })).toHaveCount(0);
    await page.keyboard.press("Delete");
    await expect(page.getByRole("dialog", { name: "删除分类" })).toHaveCount(0);
    await expect
      .poll(() =>
        access(createdPath).then(
          () => true,
          () => false,
        ),
      )
      .toBe(false);
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("shows all descendant patches and direct category counts", async () => {
  const projectRoot = resolve(import.meta.dirname, "../..");
  const runtimeRoot = await mkdtemp(join(tmpdir(), "dnf-category-tree-e2e-"));
  const armor = join(runtimeRoot, "patch-categories", "Armor");
  const cloth = join(armor, "Cloth");
  await mkdir(cloth, { recursive: true });
  await Promise.all([
    writeFile(join(armor, "armor.npk"), "armor"),
    writeFile(join(cloth, "top.npk"), "top"),
    writeFile(join(cloth, "bottom.npk"), "bottom"),
  ]);
  const application = await electron.launch({
    args: [`--user-data-dir=${join(runtimeRoot, "electron-data")}`, projectRoot],
    cwd: runtimeRoot,
  });

  try {
    const page = await application.firstWindow();
    await expect(page.getByRole("button", { name: /^top\.npk - /u })).toBeVisible();
    await expect(page.getByRole("button", { name: /^bottom\.npk - /u })).toBeVisible();
    const armorButton = page.getByRole("button", { name: "Armor", exact: true });
    await expect(armorButton).toContainText("1");
    await armorButton.click();
    await expect(page.getByRole("checkbox", { name: "包含子分类" })).not.toBeChecked();
    await expect(page.getByRole("button", { name: /^armor\.npk(?: - )?/u })).toBeVisible();
    await expect(page.getByRole("button", { name: /^top\.npk - /u })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^bottom\.npk - /u })).toHaveCount(0);
    const descendantToggle = page.getByRole("checkbox", { name: "包含子分类" });
    await descendantToggle.check();
    await expect(page.locator(".patch-workspace .status-chip")).toHaveCount(0);
    await expect(armorButton).toContainText("1");
    await descendantToggle.uncheck();
    await expect(page.locator(".patch-workspace .status-chip")).toHaveCount(0);
    await expect(armorButton).toContainText("1");
    await page.getByRole("button", { name: "全部", exact: true }).click();
    await page.getByRole("button", { name: "展开 Armor" }).click();
    const clothButton = page.getByRole("button", { name: "Cloth", exact: true });
    await expect(clothButton).toContainText("2");
    await clothButton.click();
    await expect(page.getByRole("button", { name: "top.npk", exact: true })).toBeVisible();
  } finally {
    await application.close();
    await rm(runtimeRoot, { force: true, recursive: true, maxRetries: 5, retryDelay: 100 });
  }
});

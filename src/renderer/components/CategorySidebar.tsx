import {
  Archive,
  FolderOpen,
  FolderPlus,
  Globe2,
  Layers,
  PackageOpen,
  Pencil,
  Settings,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CategoryFolderStyle } from "../../shared/category-styles";
import type {
  CategoryStyleStateDto,
  DnfApi,
  MoveCategoryRequest,
} from "../../shared/ipc-contracts";
import type { CategorySnapshot, ChildCategory } from "../../shared/library-dto";
import { pathKey } from "../../shared/path-key";
import {
  isRootPatch,
  type NavigationSelection,
  type WorkspaceItemReference,
} from "../workspace/model";
import {
  type CategoryDragState,
  type CategoryDropTarget,
  CategoryTree,
  folderStyleIcons,
  reorderedCategories,
} from "./CategoryTree";

type CategorySidebarProps = {
  readonly categoryPath: string;
  readonly client: DnfApi | undefined;
  readonly navigation: NavigationSelection;
  readonly onSelect: (relativePath: string) => void;
  readonly onSelectNavigation: (selection: NavigationSelection) => void;
  readonly onRecycleBin: () => void;
  readonly recycleCount: number;
  readonly onAppearance: () => void;
  readonly onSettings: () => void;
  readonly onMoveCategory: (request: MoveCategoryRequest) => void;
  readonly onMoveItems: (
    targetRelativePath: string,
    items: readonly WorkspaceItemReference[],
  ) => void;
  readonly onCreateCategory: () => void;
  readonly onCreateCategoryAt: (parentRelativePath: string, name: string) => Promise<string | null>;
  readonly onDeleteCategory: (relativePath: string, hasContents: boolean) => void;
  readonly onReorder: (
    parentRelativePath: string,
    orderedChildRelativePaths: readonly string[],
  ) => void;
  readonly onRenameCategoryAt: (relativePath: string, name: string) => Promise<string | null>;
  readonly presetCount?: number;
  readonly snapshot: CategorySnapshot | null;
  readonly readOnly: boolean;
};

type CategoryContextMenuState = {
  readonly relativePath: string;
  readonly x: number;
  readonly y: number;
};

const folderStyleOptions = [
  { label: "蓝色描边", style: "blue-outline" },
  { label: "收藏文件夹", style: "star" },
  { label: "线框文件夹", style: "outline" },
  { label: "新增文件夹", style: "add" },
  { label: "音乐文件夹", style: "music" },
] as const satisfies readonly { readonly label: string; readonly style: CategoryFolderStyle }[];

function SystemRow({
  count,
  icon,
  label,
  onClick,
  selected,
}: {
  readonly count?: number;
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly onClick: () => void;
  readonly selected: boolean;
}): React.JSX.Element {
  return (
    <button
      aria-current={selected ? "page" : undefined}
      aria-pressed={selected}
      className={`category-row system-nav-row ${selected ? "selected" : ""}`}
      onClick={onClick}
      type="button"
    >
      {icon}
      <span>{label}</span>
      {count === undefined ? null : (
        <span aria-hidden="true" className="category-count">
          {count}
        </span>
      )}
    </button>
  );
}

function countCategoryPatches(categories: readonly ChildCategory[]): number {
  return categories.reduce(
    (count, category) =>
      count + category.patchCount + countCategoryPatches(category.childCategories),
    0,
  );
}

function findCategory(
  categories: readonly ChildCategory[],
  relativePath: string,
): ChildCategory | null {
  const target = pathKey(relativePath);
  for (const category of categories) {
    if (pathKey(category.relativePath) === target) return category;
    const nested = findCategory(category.childCategories, relativePath);
    if (nested !== null) return nested;
  }
  return null;
}

function categoryHasPatches(categories: readonly ChildCategory[], relativePath: string): boolean {
  const category = findCategory(categories, relativePath);
  if (category === null) return false;
  return category.patchCount + countCategoryPatches(category.childCategories) > 0;
}

function childNames(
  categories: readonly ChildCategory[],
  relativePath: string,
): ReadonlySet<string> {
  const category = findCategory(categories, relativePath);
  return new Set((category?.childCategories ?? []).map((child) => child.name.toLocaleLowerCase()));
}

function hueToHex(hue: number): string {
  const c = 1;
  const x = 1 - Math.abs(((hue / 60) % 2) - 1);
  const [red, green, blue] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];
  return `#${[red, green, blue]
    .map((channel) =>
      Math.round(channel * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function hexToHue(color: string | undefined): number {
  if (color === undefined) return 220;
  const red = Number.parseInt(color.slice(1, 3), 16) / 255;
  const green = Number.parseInt(color.slice(3, 5), 16) / 255;
  const blue = Number.parseInt(color.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  if (delta === 0) return 0;
  const hue =
    max === red
      ? 60 * (((green - blue) / delta) % 6)
      : max === green
        ? 60 * ((blue - red) / delta + 2)
        : 60 * ((red - green) / delta + 4);
  return Math.round((hue + 360) % 360);
}

export function CategorySidebar({
  categoryPath,
  client,
  navigation,
  onSelect,
  onSelectNavigation,
  onRecycleBin,
  recycleCount,
  onAppearance,
  onSettings,
  onMoveCategory,
  onMoveItems,
  onCreateCategory,
  onCreateCategoryAt,
  onDeleteCategory,
  onReorder,
  onRenameCategoryAt,
  presetCount = 0,
  snapshot,
  readOnly,
}: CategorySidebarProps): React.JSX.Element {
  const [dragState, setDragState] = useState<CategoryDragState | null>(null);
  const [scrollbarActive, setScrollbarActive] = useState(false);
  const scrollbarTimer = useRef<number | null>(null);
  const [dropTarget, setDropTarget] = useState<CategoryDropTarget | null>(null);
  const [rootDropActive, setRootDropActive] = useState(false);
  const [itemDropTargetRelativePath, setItemDropTargetRelativePath] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<ReadonlySet<string>>(new Set());
  const [styleState, setStyleState] = useState<CategoryStyleStateDto>({
    styles: {},
    colors: {},
    styleColors: {},
  });
  const { colors: folderColors, styles: folderStyles, styleColors } = styleState;
  const [contextMenu, setContextMenu] = useState<CategoryContextMenuState | null>(null);
  const [draftStyle, setDraftStyle] = useState<CategoryFolderStyle | null>(null);
  const [draftColor, setDraftColor] = useState<string | undefined>(undefined);
  const [draftHue, setDraftHue] = useState(220);
  const [editingRelativePath, setEditingRelativePath] = useState<string | null>(null);
  const [contextMenuSize, setContextMenuSize] = useState({ width: 210, height: 170 });
  const contextMenuPillRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const suppressNextCategoryClickRef = useRef(false);

  useEffect(() => {
    const segments = categoryPath.split(/[\\/]/u).filter((segment) => segment.length > 0);
    const ancestors = segments
      .slice(0, -1)
      .map((_, index) => segments.slice(0, index + 1).join("\\"));
    if (ancestors.length > 0) {
      setExpandedPaths((current) => new Set([...current, ...ancestors]));
    }
  }, [categoryPath]);

  useEffect(() => {
    if (client === undefined) return;
    void client.getCategoryStyles().then((result) => {
      if (result.ok) setStyleState(result.value);
    });
  }, [client]);

  useEffect(
    () => () => {
      if (scrollbarTimer.current !== null) window.clearTimeout(scrollbarTimer.current);
    },
    [],
  );

  // 指针在侧栏外松开时不会触发 nav 的 onPointerUp，拖拽状态与落点会残留下来，
  // 之后一次普通点击就会被当成“完成移动”。用 window 兜底取消。
  useEffect(() => {
    if (dragState === null) return;
    const cancelDrag = (): void => {
      draggingRef.current = false;
      setDragState(null);
      setRootDropActive(false);
      setDropTarget(null);
    };
    window.addEventListener("pointerup", cancelDrag);
    window.addEventListener("pointercancel", cancelDrag);
    return () => {
      window.removeEventListener("pointerup", cancelDrag);
      window.removeEventListener("pointercancel", cancelDrag);
    };
  }, [dragState]);
  useEffect(() => {
    if (contextMenu === null) return;
    const closeOnPointerDown = (event: PointerEvent): void => {
      if (
        event.target instanceof Element &&
        event.target.closest(".category-context-menu") !== null
      ) {
        return;
      }
      setContextMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setContextMenu(null);
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  const selectCategory = (relativePath: string): void => {
    if (suppressNextCategoryClickRef.current) {
      suppressNextCategoryClickRef.current = false;
      return;
    }
    onSelect(relativePath);
  };

  const moveContextMenuPill = (target: HTMLButtonElement, danger: boolean): void => {
    const pill = contextMenuPillRef.current;
    const menu = pill?.parentElement;
    if (pill === null || menu === null || menu === undefined) return;
    const menuRect = menu.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    pill.style.top = `${targetRect.top - menuRect.top}px`;
    pill.style.left = `${targetRect.left - menuRect.left}px`;
    pill.style.width = `${targetRect.width}px`;
    pill.style.height = `${targetRect.height}px`;
    pill.style.opacity = "1";
    pill.dataset["danger"] = danger ? "true" : "false";
  };

  const hideContextMenuPill = (): void => {
    const pill = contextMenuPillRef.current;
    if (pill !== null) pill.style.opacity = "0";
  };

  const hideContextMenuPillIfLeavingActions = (
    event: React.FocusEvent<HTMLButtonElement> | React.MouseEvent<HTMLButtonElement>,
  ): void => {
    const actions = event.currentTarget.closest(".category-context-actions");
    if (event.relatedTarget instanceof Node && actions?.contains(event.relatedTarget)) return;
    hideContextMenuPill();
  };

  const startCategoryDrag = (nextDrag: CategoryDragState): void => {
    draggingRef.current = false;
    suppressNextCategoryClickRef.current = false;
    setDragState(nextDrag);
    setDropTarget(null);
    setItemDropTargetRelativePath(null);
  };

  const updateCategoryDropTarget = (nextTarget: CategoryDropTarget): void => {
    if (dragState === null) return;
    draggingRef.current = true;
    setRootDropActive(false);
    setDropTarget(nextTarget);
  };

  // 拖拽嵌套文件夹时，树下方留白作为“移出到根目录”的落点：根级行只有上下
  // 25% 的边缘带算同级，落进行中部会被判为“放进该文件夹”，往外拖几乎必然落空。
  const updateRootDropTarget = (): void => {
    if (dragState === null || dragState.sourceParentRelativePath === "") return;
    const rootCategories = snapshot?.childCategories ?? [];
    const remaining = rootCategories.filter(
      (category) => category.relativePath !== dragState.sourceRelativePath,
    );
    const sourceCategory = dragState.sourceCategories.find(
      (category) => category.relativePath === dragState.sourceRelativePath,
    );
    if (sourceCategory === undefined) return;
    setRootDropActive(true);
    draggingRef.current = true;
    setDropTarget({
      position: "after",
      targetCategories: rootCategories,
      // finishOrdering 先滤掉来源再 splice，因此“追加到末尾”等于过滤后的长度。
      targetIndex: remaining.length,
      targetParentRelativePath: "",
      // 与 finishOrdering 的 movedRelativePath 一致：根级路径就是分类名。
      targetRelativePath: sourceCategory.name,
    });
  };

  const finishOrdering = (): void => {
    const currentDrag = dragState;
    const currentTarget = dropTarget;
    const wasDragging = draggingRef.current;
    draggingRef.current = false;
    setDragState(null);
    setDropTarget(null);
    setItemDropTargetRelativePath(null);
    if (!wasDragging || currentDrag === null || currentTarget === null) return;
    suppressNextCategoryClickRef.current = true;
    if (
      currentTarget.position !== "inside" &&
      currentTarget.targetParentRelativePath === currentDrag.sourceParentRelativePath
    ) {
      onReorder(
        currentDrag.sourceParentRelativePath,
        reorderedCategories(
          currentDrag.sourceCategories,
          currentDrag.sourceRelativePath,
          currentTarget.targetRelativePath,
          currentTarget.position,
        ).map((category) => category.relativePath),
      );
      return;
    }
    const sourceCategory = currentDrag.sourceCategories.find(
      (category) => category.relativePath === currentDrag.sourceRelativePath,
    );
    if (sourceCategory === undefined) return;
    const movedRelativePath =
      currentTarget.targetParentRelativePath === ""
        ? sourceCategory.name
        : `${currentTarget.targetParentRelativePath}\\${sourceCategory.name}`;
    if (pathKey(movedRelativePath) === pathKey(currentDrag.sourceRelativePath)) {
      return;
    }
    const targetParentChildRelativePaths = currentTarget.targetCategories
      .filter((category) => category.relativePath !== currentDrag.sourceRelativePath)
      .map((category) => category.relativePath);
    targetParentChildRelativePaths.splice(currentTarget.targetIndex, 0, movedRelativePath);
    const request: MoveCategoryRequest = {
      sourceParentRelativePath: currentDrag.sourceParentRelativePath,
      sourceRelativePath: currentDrag.sourceRelativePath,
      targetParentRelativePath: currentTarget.targetParentRelativePath,
      targetIndex: currentTarget.targetIndex,
      sourceParentChildRelativePaths: currentDrag.sourceCategories
        .filter((category) => category.relativePath !== currentDrag.sourceRelativePath)
        .map((category) => category.relativePath),
      targetParentChildRelativePaths,
    };
    onMoveCategory(request);
  };

  const createChildCategory = async (): Promise<void> => {
    const target = contextMenu;
    setContextMenu(null);
    if (target === null) return;
    const names = childNames(snapshot?.childCategories ?? [], target.relativePath);
    let name = "新建文件夹";
    let suffix = 2;
    while (names.has(name.toLocaleLowerCase())) {
      name = `新建文件夹 ${suffix}`;
      suffix += 1;
    }
    const relativePath = await onCreateCategoryAt(target.relativePath, name);
    if (relativePath === null) return;
    setExpandedPaths((current) => new Set([...current, target.relativePath]));
    onSelect(relativePath);
    setEditingRelativePath(relativePath);
  };

  const setFolderStyle = async (style: CategoryFolderStyle): Promise<void> => {
    const target = contextMenu;
    if (target === null || client === undefined) return;
    const color = draftStyle === style ? (draftColor ?? styleColors[style]) : styleColors[style];
    setDraftStyle(style);
    setDraftColor(color);
    setDraftHue(hexToHue(color));
    const result = await client.setCategoryStyle({
      relativePath: target.relativePath,
      style,
      color,
    });
    if (result.ok) {
      setStyleState(result.value);
      setDraftColor(result.value.styleColors[style]);
    }
  };

  const setFolderColor = (hue: number): void => {
    if (contextMenu === null || draftStyle === null) return;
    setDraftHue(hue);
    setDraftColor(hueToHex(hue));
  };

  const saveFolderColor = async (): Promise<void> => {
    if (
      contextMenu === null ||
      draftStyle === null ||
      draftColor === undefined ||
      client === undefined
    ) {
      return;
    }
    const result = await client.setCategoryStyle({
      relativePath: contextMenu.relativePath,
      color: draftColor,
      colorStyle: draftStyle,
    });
    if (result.ok) {
      setStyleState((current) => ({ ...current, styleColors: result.value.styleColors }));
    }
  };

  const renameCategory = async (relativePath: string, name: string): Promise<void> => {
    const renamed = await onRenameCategoryAt(relativePath, name);
    if (renamed === null) return;
    setEditingRelativePath(null);
    if (categoryPath === relativePath) onSelect(renamed);
  };

  const rootPatches = snapshot?.patches.filter(isRootPatch) ?? [];
  const hasRecursiveItems =
    snapshot?.patches.some((patch) => !isRootPatch(patch)) === true ||
    snapshot?.groups.some(
      (group) => (group.categoryRelativePath ?? group.relativePath).split(/[\\/]/u).length > 1,
    ) === true;
  const allCount =
    snapshot === null
      ? 0
      : snapshot.patches.length +
        snapshot.groups.length +
        (hasRecursiveItems ? 0 : countCategoryPatches(snapshot.childCategories));
  const categorySelection = navigation.kind === "category" ? navigation.relativePath : "";

  return (
    <nav
      className="category-sidebar"
      aria-label="补丁分类"
      data-scrollbar-active={scrollbarActive}
      onScroll={() => {
        setScrollbarActive(true);
        if (scrollbarTimer.current !== null) window.clearTimeout(scrollbarTimer.current);
        scrollbarTimer.current = window.setTimeout(() => setScrollbarActive(false), 900);
      }}
      onWheel={() => {
        setScrollbarActive(true);
        if (scrollbarTimer.current !== null) window.clearTimeout(scrollbarTimer.current);
        scrollbarTimer.current = window.setTimeout(() => setScrollbarActive(false), 900);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Delete" || readOnly || categoryPath === "") return;
        if (
          !(event.target instanceof HTMLElement) ||
          event.target.closest(".category-row") === null
        ) {
          return;
        }
        event.preventDefault();
        onDeleteCategory(
          categoryPath,
          categoryHasPatches(snapshot?.childCategories ?? [], categoryPath),
        );
      }}
      onPointerCancel={finishOrdering}
      onPointerUp={finishOrdering}
    >
      <div className="sidebar-heading">
        <span className="sidebar-commands">
          <button
            aria-label="新建子分类"
            className="icon-button compact"
            disabled={readOnly}
            onClick={onCreateCategory}
            title="新建子分类"
            type="button"
          >
            <FolderPlus size={15} />
          </button>
        </span>
        <div className="sidebar-settings-actions">
          <button
            aria-label="调整外观"
            className="sidebar-appearance-button"
            onClick={onAppearance}
            title="调整外观"
            type="button"
          >
            <SlidersHorizontal size={14} />
            <span>调整外观</span>
          </button>
          <button
            aria-label="设置"
            className="icon-button compact sidebar-settings-button"
            onClick={onSettings}
            title="设置"
            type="button"
          >
            <Settings size={15} />
          </button>
        </div>
      </div>

      <div className="sidebar-system-nav">
        <SystemRow
          count={recycleCount}
          icon={<Archive size={16} />}
          label="回收站"
          onClick={onRecycleBin}
          selected={navigation.kind === "recycle"}
        />
        <SystemRow
          count={allCount}
          icon={<FolderOpen size={16} />}
          label="全部"
          onClick={() => onSelectNavigation({ kind: "all" })}
          selected={navigation.kind === "all"}
        />
        <SystemRow
          count={rootPatches.length}
          icon={<PackageOpen size={16} />}
          label="未分类"
          onClick={() => onSelectNavigation({ kind: "uncategorized" })}
          selected={navigation.kind === "uncategorized"}
        />
        <SystemRow
          count={presetCount}
          icon={<Layers size={16} />}
          label="预设"
          onClick={() => onSelectNavigation({ kind: "presets" })}
          selected={navigation.kind === "presets"}
        />
        <SystemRow
          icon={<Globe2 size={16} />}
          label="资源社区"
          onClick={() => onSelectNavigation({ kind: "community" })}
          selected={navigation.kind === "community"}
        />
      </div>

      <hr className="sidebar-separator" />

      <CategoryTree
        categories={snapshot?.childCategories ?? []}
        categoryPath={categorySelection}
        dragSourceRelativePath={dragState?.sourceRelativePath ?? null}
        dropTarget={dropTarget}
        expandedPaths={expandedPaths}
        editingRelativePath={editingRelativePath}
        folderColors={folderColors}
        folderStyles={folderStyles}
        itemDropTargetRelativePath={itemDropTargetRelativePath}
        onMoveItems={onMoveItems}
        onItemDragLeave={() => setItemDropTargetRelativePath(null)}
        onItemDragOver={setItemDropTargetRelativePath}
        onCategoryDragOver={updateCategoryDropTarget}
        onCategoryDragStart={startCategoryDrag}
        onCancelRename={() => setEditingRelativePath(null)}
        onContextMenu={(relativePath, x, y) => {
          onSelect(relativePath);
          const style = folderStyles[relativePath];
          setDraftStyle(style ?? null);
          setDraftColor(undefined);
          setDraftHue(hexToHue(style === undefined ? undefined : styleColors[style]));
          setContextMenu({
            relativePath,
            x: Math.min(x, window.innerWidth - 230),
            y: Math.min(y, window.innerHeight - 170),
          });
        }}
        onRename={(relativePath, name) => void renameCategory(relativePath, name)}
        onSelect={selectCategory}
        onStartRename={(relativePath) => {
          onSelect(relativePath);
          setEditingRelativePath(relativePath);
        }}
        onToggle={(path) =>
          setExpandedPaths((current) => {
            const next = new Set(current);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
          })
        }
        readOnly={readOnly}
      />
      {dragState === null || dragState.sourceParentRelativePath === "" ? null : (
        <div
          aria-hidden="true"
          className={`category-root-drop ${rootDropActive ? "active" : ""}`}
          data-category-root-drop="true"
          onPointerEnter={updateRootDropTarget}
          onPointerLeave={() => {
            setRootDropActive(false);
            setDropTarget(null);
          }}
          onPointerMove={updateRootDropTarget}
        />
      )}
      {snapshot !== null && snapshot.childCategories.length === 0 ? (
        <div className="sidebar-empty">当前目录没有子分类。</div>
      ) : null}
      {contextMenu === null ? null : (
        <div
          className="category-context-menu"
          onContextMenu={(event) => event.preventDefault()}
          role="menu"
          ref={(node) => {
            if (node === null) return;
            const rect = node.getBoundingClientRect();
            if (rect.width !== contextMenuSize.width || rect.height !== contextMenuSize.height) {
              setContextMenuSize({ width: rect.width, height: rect.height });
            }
          }}
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - contextMenuSize.width - 8),
            top: Math.min(contextMenu.y, window.innerHeight - contextMenuSize.height - 8),
          }}
        >
          <div aria-hidden="true" className="category-context-pill" ref={contextMenuPillRef} />
          <div className="category-context-actions">
            <button
              className="category-context-action"
              disabled={readOnly}
              onBlur={hideContextMenuPillIfLeavingActions}
              onClick={() => void createChildCategory()}
              onFocus={(event) => moveContextMenuPill(event.currentTarget, false)}
              onMouseEnter={(event) => moveContextMenuPill(event.currentTarget, false)}
              onMouseLeave={hideContextMenuPillIfLeavingActions}
              role="menuitem"
              type="button"
            >
              <FolderPlus size={15} />
              <span>新增子文件夹</span>
            </button>
          </div>
          <div className="category-context-divider" />
          <fieldset aria-label="文件夹外观" className="category-style-options">
            {folderStyleOptions.map((option) => (
              <button
                aria-label={`设置文件夹外观：${option.label}`}
                aria-pressed={draftStyle === option.style}
                className={`category-style-option ${draftStyle === option.style ? "selected" : ""}`}
                disabled={readOnly}
                key={option.style}
                onClick={() => void setFolderStyle(option.style)}
                title={option.label}
                type="button"
              >
                <span
                  aria-hidden="true"
                  className="category-style-preview"
                  style={{
                    backgroundColor:
                      draftStyle === option.style
                        ? (draftColor ?? styleColors[option.style] ?? "var(--color-primary)")
                        : (styleColors[option.style] ?? "var(--color-primary)"),
                    maskImage: `url("${folderStyleIcons[option.style]}")`,
                    WebkitMaskImage: `url("${folderStyleIcons[option.style]}")`,
                  }}
                />
              </button>
            ))}
          </fieldset>
          <label className="category-color-picker">
            <span className="sr-only">图标颜色</span>
            <input
              aria-label="图标颜色"
              disabled={readOnly || draftStyle === null}
              max="359"
              min="0"
              onChange={(event) => setFolderColor(Number(event.currentTarget.value))}
              onPointerUp={() => void saveFolderColor()}
              step="1"
              type="range"
              value={draftHue}
            />
          </label>
          <div className="category-context-divider" />
          <div className="category-context-actions">
            <button
              className="category-context-action"
              disabled={readOnly}
              onBlur={hideContextMenuPillIfLeavingActions}
              onClick={() => {
                const relativePath = contextMenu.relativePath;
                setContextMenu(null);
                onSelect(relativePath);
                setEditingRelativePath(relativePath);
              }}
              onFocus={(event) => moveContextMenuPill(event.currentTarget, false)}
              onMouseEnter={(event) => moveContextMenuPill(event.currentTarget, false)}
              onMouseLeave={hideContextMenuPillIfLeavingActions}
              role="menuitem"
              type="button"
            >
              <Pencil size={15} />
              <span>重命名</span>
            </button>
            <button
              className="category-context-action category-context-delete"
              disabled={readOnly}
              onBlur={hideContextMenuPillIfLeavingActions}
              onClick={() => {
                const relativePath = contextMenu.relativePath;
                const hasPatches = categoryHasPatches(
                  snapshot?.childCategories ?? [],
                  relativePath,
                );
                setContextMenu(null);
                onDeleteCategory(relativePath, hasPatches);
              }}
              onFocus={(event) => moveContextMenuPill(event.currentTarget, true)}
              onMouseEnter={(event) => moveContextMenuPill(event.currentTarget, true)}
              onMouseLeave={hideContextMenuPillIfLeavingActions}
              role="menuitem"
              type="button"
            >
              <Trash2 size={15} />
              <span>删除文件夹</span>
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}

import { ChevronDown, ChevronRight, Folder } from "lucide-react";
import type { CategoryFolderStyle } from "../../shared/category-styles";
import type { ChildCategory } from "../../shared/library-dto";
import { isPathWithin } from "../../shared/path-key";
import {
  decodeWorkspaceItemDrag,
  isWorkspaceItemsDrag,
  LIBRARY_ITEMS_DRAG_TYPE,
} from "../workspace/item-drag";
import type { WorkspaceItemReference } from "../workspace/model";

export type CategoryDropPosition = "before" | "inside" | "after";

export type CategoryDragState = {
  readonly sourceCategories: readonly ChildCategory[];
  readonly sourceParentRelativePath: string;
  readonly sourceRelativePath: string;
};

export type CategoryDropTarget = {
  readonly position: CategoryDropPosition;
  readonly targetCategories: readonly ChildCategory[];
  readonly targetIndex: number;
  readonly targetParentRelativePath: string;
  readonly targetRelativePath: string;
};

type CategoryTreeProps = {
  readonly categories: readonly ChildCategory[];
  readonly categoryPath: string;
  readonly editingRelativePath: string | null;
  readonly folderStyles: Readonly<Record<string, CategoryFolderStyle>>;
  readonly folderColors: Readonly<Record<string, string>>;
  readonly depth?: number;
  readonly expandedPaths: ReadonlySet<string>;
  readonly dragSourceRelativePath: string | null;
  readonly dropTarget: CategoryDropTarget | null;
  readonly itemDropTargetRelativePath: string | null;
  readonly onMoveItems: (
    targetRelativePath: string,
    items: readonly WorkspaceItemReference[],
  ) => void;
  readonly onItemDragLeave: () => void;
  readonly onItemDragOver: (relativePath: string) => void;
  readonly onCategoryDragOver: (target: CategoryDropTarget) => void;
  readonly onCategoryDragStart: (drag: CategoryDragState) => void;
  readonly onCancelRename: () => void;
  readonly onContextMenu: (relativePath: string, x: number, y: number) => void;
  readonly onRename: (relativePath: string, name: string) => void;
  readonly onSelect: (relativePath: string) => void;
  readonly onStartRename: (relativePath: string) => void;
  readonly onToggle: (relativePath: string) => void;
  readonly parentRelativePath?: string;
  readonly readOnly: boolean;
};

export const folderStyleIcons: Record<CategoryFolderStyle, string> = {
  "blue-outline": new URL("../assets/category-folder-icons/folder-blue.svg", import.meta.url).href,
  star: new URL("../assets/category-folder-icons/folder-star.svg", import.meta.url).href,
  outline: new URL("../assets/category-folder-icons/folder-outline.svg", import.meta.url).href,
  add: new URL("../assets/category-folder-icons/folder-add.svg", import.meta.url).href,
  music: new URL("../assets/category-folder-icons/folder-music.svg", import.meta.url).href,
};

function CategoryFolderIcon({
  color,
  style,
}: {
  readonly color: string | undefined;
  readonly style: CategoryFolderStyle | undefined;
}): React.JSX.Element {
  return style === undefined ? (
    <Folder className="category-folder-icon" size={16} />
  ) : (
    <span
      aria-hidden="true"
      className="category-folder-icon category-folder-image"
      style={{
        backgroundColor: color ?? "var(--color-primary)",
        maskImage: `url("${folderStyleIcons[style]}")`,
        WebkitMaskImage: `url("${folderStyleIcons[style]}")`,
      }}
    />
  );
}

export function reorderedCategories(
  categories: readonly ChildCategory[],
  sourceRelativePath: string,
  targetRelativePath: string,
  position: CategoryDropPosition,
): readonly ChildCategory[] {
  if (position === "inside") return categories;
  const source = categories.find((category) => category.relativePath === sourceRelativePath);
  if (source === undefined) return categories;
  const next = categories.filter((category) => category.relativePath !== sourceRelativePath);
  const targetIndex = next.findIndex((category) => category.relativePath === targetRelativePath);
  if (targetIndex < 0) return categories;
  next.splice(targetIndex + (position === "after" ? 1 : 0), 0, source);
  return next;
}

function dropPosition(event: React.PointerEvent<HTMLButtonElement>): CategoryDropPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.height <= 0 || !Number.isFinite(event.clientY)) return "after";
  const offset = event.clientY - rect.top;
  const edge = rect.height * 0.25;
  if (offset < edge) return "before";
  if (offset > rect.height - edge) return "after";
  return "inside";
}

function resolveDropTarget(
  event: React.PointerEvent<HTMLButtonElement>,
  category: ChildCategory,
  context: {
    readonly dragSourceRelativePath: string;
    readonly parentRelativePath: string;
    readonly visibleCategories: readonly ChildCategory[];
  },
): CategoryDropTarget | null {
  const { dragSourceRelativePath, parentRelativePath, visibleCategories } = context;
  if (isPathWithin(category.relativePath, dragSourceRelativePath)) return null;
  const position = dropPosition(event);
  const targetCategories = position === "inside" ? category.childCategories : visibleCategories;
  const withoutSource = targetCategories.filter(
    (candidate) => candidate.relativePath !== dragSourceRelativePath,
  );
  const targetIndex =
    position === "inside"
      ? withoutSource.length
      : withoutSource.findIndex((candidate) => candidate.relativePath === category.relativePath) +
        (position === "after" ? 1 : 0);
  if (targetIndex < 0) return null;
  return {
    position,
    targetCategories,
    targetIndex,
    targetParentRelativePath: position === "inside" ? category.relativePath : parentRelativePath,
    targetRelativePath: category.relativePath,
  };
}

export function CategoryTree({
  categories,
  categoryPath,
  editingRelativePath,
  folderColors,
  folderStyles,
  depth = 0,
  dragSourceRelativePath,
  dropTarget,
  itemDropTargetRelativePath,
  expandedPaths,
  onMoveItems,
  onItemDragLeave,
  onItemDragOver,
  onCategoryDragOver,
  onCategoryDragStart,
  onCancelRename,
  onContextMenu,
  onRename,
  onSelect,
  onStartRename,
  onToggle,
  parentRelativePath = "",
  readOnly,
}: CategoryTreeProps): React.JSX.Element {
  const visibleCategories = categories;
  return (
    <div className="category-tree" data-depth={depth}>
      {visibleCategories.map((category) => {
        const hasChildren = category.childCategories.length > 0;
        const expanded = expandedPaths.has(category.relativePath);
        const itemDropTarget = itemDropTargetRelativePath === category.relativePath;
        const editing = editingRelativePath === category.relativePath;
        const updateCategoryDragOver = (event: React.PointerEvent<HTMLButtonElement>): void => {
          if (event.buttons !== 1 || dragSourceRelativePath === null) return;
          const target = resolveDropTarget(event, category, {
            dragSourceRelativePath,
            parentRelativePath,
            visibleCategories,
          });
          if (target !== null) onCategoryDragOver(target);
        };
        return (
          <div className="category-node" key={category.relativePath}>
            <div className={`category-node-line ${hasChildren ? "has-toggle" : "leaf"}`}>
              {hasChildren ? (
                <button
                  aria-label={`${expanded ? "折叠" : "展开"} ${category.name}`}
                  className="category-expand"
                  onClick={() => onToggle(category.relativePath)}
                  type="button"
                >
                  {expanded ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
                </button>
              ) : (
                <span className="category-expand-spacer" />
              )}
              {editing ? (
                <div className="category-row category-row-editing">
                  <CategoryFolderIcon
                    color={folderColors[category.relativePath]}
                    style={folderStyles[category.relativePath]}
                  />
                  <input
                    aria-label={`重命名 ${category.name}`}
                    defaultValue={category.name}
                    onBlur={(event) => {
                      // 失焦提交而非取消：改完名字去点别处是最自然的收尾动作，
                      // 按取消处理会静默丢弃输入（与 ItemWorkspace 的重命名一致）。
                      const name = event.currentTarget.value.trim();
                      if (name === "" || name === category.name) onCancelRename();
                      else onRename(category.relativePath, name);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        onCancelRename();
                      }
                      if (event.key === "Enter") {
                        event.preventDefault();
                        const name = event.currentTarget.value.trim();
                        if (name === "" || name === category.name) onCancelRename();
                        else onRename(category.relativePath, name);
                      }
                    }}
                    ref={(node) => {
                      // 进入重命名即全选整个名字（与 Windows 一致），直接输入就能覆盖。
                      // 内联 ref 每次渲染都会重跑，因此判断是否已聚焦，
                      // 避免重渲染把用户已经改了一半的选区重置回全选。
                      if (node === null || document.activeElement === node) return;
                      node.focus();
                      node.select();
                    }}
                  />
                </div>
              ) : (
                <button
                  aria-label={category.name}
                  className={`category-row ${categoryPath === category.relativePath ? "selected" : ""} ${dropTarget?.targetRelativePath === category.relativePath ? `drop-${dropTarget.position}` : ""} ${itemDropTarget ? "item-drop-target" : ""}`}
                  data-item-drop-target={itemDropTarget ? "true" : undefined}
                  data-drop-position={
                    dropTarget?.targetRelativePath === category.relativePath
                      ? dropTarget.position
                      : undefined
                  }
                  title={category.name}
                  onClick={() => onSelect(category.relativePath)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onContextMenu(category.relativePath, event.clientX, event.clientY);
                  }}
                  onDragEnter={(event) => {
                    if (readOnly || !isWorkspaceItemsDrag(event.dataTransfer)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    onItemDragOver(category.relativePath);
                  }}
                  onDragLeave={(event) => {
                    if (
                      event.relatedTarget instanceof Node &&
                      event.currentTarget.contains(event.relatedTarget)
                    ) {
                      return;
                    }
                    onItemDragLeave();
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (readOnly || !isWorkspaceItemsDrag(event.dataTransfer)) return;
                    event.dataTransfer.dropEffect = "move";
                    onItemDragOver(category.relativePath);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    onItemDragLeave();
                    if (readOnly) return;
                    const items = decodeWorkspaceItemDrag(
                      event.dataTransfer.getData(LIBRARY_ITEMS_DRAG_TYPE),
                    );
                    if (items.length > 0) onMoveItems(category.relativePath, items);
                  }}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) {
                      return;
                    }
                    if (event.key === "F2" && !readOnly) {
                      event.preventDefault();
                      event.stopPropagation();
                      onStartRename(category.relativePath);
                    }
                  }}
                  onPointerDown={(event) => {
                    if (readOnly || event.buttons !== 1) return;
                    onCategoryDragStart({
                      sourceCategories: visibleCategories,
                      sourceParentRelativePath: parentRelativePath,
                      sourceRelativePath: category.relativePath,
                    });
                  }}
                  onPointerEnter={updateCategoryDragOver}
                  onPointerMove={updateCategoryDragOver}
                  type="button"
                >
                  <CategoryFolderIcon
                    color={folderColors[category.relativePath]}
                    style={folderStyles[category.relativePath]}
                  />
                  <span>{category.name}</span>
                  {category.patchCount === 0 ? null : (
                    <span aria-hidden="true" className="category-count">
                      {category.patchCount}
                    </span>
                  )}
                </button>
              )}
            </div>
            {hasChildren && expanded ? (
              <CategoryTree
                categories={category.childCategories}
                categoryPath={categoryPath}
                editingRelativePath={editingRelativePath}
                folderStyles={folderStyles}
                folderColors={folderColors}
                depth={depth + 1}
                dragSourceRelativePath={dragSourceRelativePath}
                dropTarget={dropTarget}
                expandedPaths={expandedPaths}
                itemDropTargetRelativePath={itemDropTargetRelativePath}
                onMoveItems={onMoveItems}
                onItemDragLeave={onItemDragLeave}
                onItemDragOver={onItemDragOver}
                onCategoryDragOver={onCategoryDragOver}
                onCategoryDragStart={onCategoryDragStart}
                onCancelRename={onCancelRename}
                onContextMenu={onContextMenu}
                onRename={onRename}
                onSelect={onSelect}
                onStartRename={onStartRename}
                onToggle={onToggle}
                parentRelativePath={category.relativePath}
                readOnly={readOnly}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

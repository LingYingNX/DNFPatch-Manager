import {
  Box,
  Boxes,
  FolderInput,
  FolderOpen,
  Grid2X2,
  Layers,
  List,
  LogIn,
  Minus,
  PackageOpen,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Search,
  Trash2,
  Ungroup,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { libraryPatchBaseName, libraryPatchExtension } from "../../shared/library-patch-extensions";
import {
  decodeWorkspaceItemDrag,
  encodeWorkspaceItemDrag,
  isWorkspaceItemsDrag,
  LIBRARY_ITEMS_DRAG_TYPE,
} from "../workspace/item-drag";
import {
  type CardSize,
  type EnabledCounts,
  type EnabledFilter,
  itemCategoryPath,
  itemDate,
  itemDescription,
  itemLocation,
  itemType,
  type ViewMode,
  type WorkspaceItem,
  type WorkspaceItemReference,
  workspaceItemKey,
  workspaceItemReference,
} from "../workspace/model";
import type { SelectionModifiers } from "../workspace/useItemSelection";
import { ContextMenu, type ContextMenuAction } from "./ContextMenu";

/** 星云搜索框的 6 颗粒子落点（--x / --y 乘数，见 toolbar.css 的 nebula-float）。
    纯装饰：聚焦时从框内左侧飞散一次。坐标照搬源设计，不要在这里调参。 */
const SEARCH_NEBULA_PARTICLES: readonly (readonly [string, string])[] = [
  [".2", "-.25"],
  [".45", ".15"],
  [".7", "-.4"],
  [".9", ".3"],
  ["1", "-.1"],
  [".35", ".4"],
];

type SelectionBox = {
  readonly currentX: number;
  readonly currentY: number;
  readonly startX: number;
  readonly startY: number;
};

type ItemWorkspaceProps = {
  readonly categoryPath: string;
  readonly enabledCounts: EnabledCounts;
  readonly enabledFilter: EnabledFilter;
  readonly items: readonly WorkspaceItem[];
  readonly includeDescendants: boolean;
  readonly loading: boolean;
  readonly onQueryChange: (query: string) => void;
  readonly onBoxSelect: (relativePaths: readonly string[]) => void;
  readonly onClearCategoryHighlight: () => void;
  readonly onImportDropped: (files: readonly File[]) => void;
  readonly onRevealSource: (relativePath: string) => void;
  readonly onIncludeDescendantsChange: (include: boolean) => void;
  readonly onEnabledFilterChange: (filter: EnabledFilter) => void;
  readonly onViewModeChange: (mode: ViewMode) => void;
  readonly showDescendantToggle: boolean;
  readonly onCreateGroup: () => void;
  readonly onAddGroupMembers: (groupId: string, patches: readonly WorkspaceItemReference[]) => void;
  readonly onDissolveGroup: () => void;
  readonly onEnterGroup: (item: WorkspaceItem) => void;
  readonly onReturnFromGroup: (() => void) | undefined;
  readonly onAddToPreset: () => void;
  readonly onMove: () => void;
  readonly onMoveTo: (
    targetDirectoryRelativePath: string,
    items: readonly WorkspaceItemReference[],
  ) => void;
  readonly onRecycle: () => void;
  readonly onRenameItem: (item: WorkspaceItem, newName: string) => Promise<boolean>;
  readonly onSetItemEnabled: (item: WorkspaceItem, enabled: boolean) => void;
  readonly onSetItemsEnabled: (items: readonly WorkspaceItem[], enabled: boolean) => void;
  readonly onSelectPreview: (item: WorkspaceItem) => void;
  readonly onSelect: (relativePath: string, modifiers: SelectionModifiers) => void;
  readonly selectedPaths: readonly string[];
  readonly selectedItems: readonly WorkspaceItem[];
  readonly operationBusy: boolean;
  readonly busyItemKeys: ReadonlySet<string>;
  readonly query: string;
  readonly visibleItems: readonly WorkspaceItem[];
  readonly viewMode: ViewMode;
  readonly readOnly: boolean;
  readonly moveTargets: readonly MoveTarget[];
};

export type MoveTarget = {
  readonly children: readonly MoveTarget[];
  readonly label: string;
  readonly relativePath: string;
};

function moveTargetActions(
  targets: readonly MoveTarget[],
  selectedItems: readonly WorkspaceItem[],
  onMoveTo: (targetDirectoryRelativePath: string, items: readonly WorkspaceItemReference[]) => void,
): readonly ContextMenuAction[] {
  return targets.map((target) => ({
    ...(target.children.length === 0
      ? {}
      : { children: moveTargetActions(target.children, selectedItems, onMoveTo) }),
    icon: <FolderInput size={15} />,
    // 分类目录名在同一父级下唯一，但显式 id 让菜单 key 不依赖这条约束。
    id: target.relativePath,
    label: target.label,
    onClick: () => onMoveTo(target.relativePath, selectedItems.map(workspaceItemReference)),
  }));
}

function renameInputValue(item: WorkspaceItem): string {
  return item.kind === "patch" ? libraryPatchBaseName(item.name) : item.name;
}

function renameFileName(item: WorkspaceItem, value: string): string {
  if (item.kind !== "patch") return value;
  // 保留补丁原有扩展名（.npk / .bk2），不要把 BK2 改成 NPK。
  const extension = libraryPatchExtension(item.name);
  return value.toLocaleLowerCase().endsWith(extension) ? value : `${value}${extension}`;
}

/** 悬停播放用的视频地址；没有生成播放素材（或缺转换器）时返回 null，回落到图片放大。 */
function hoverVideoUrl(item: WorkspaceItem): string | null {
  if (item.kind !== "patch") return null;
  return item.videoPreviewUrl ?? null;
}

function intersects(box: SelectionBox, element: DOMRect): boolean {
  const left = Math.min(box.startX, box.currentX);
  const right = Math.max(box.startX, box.currentX);
  const top = Math.min(box.startY, box.currentY);
  const bottom = Math.max(box.startY, box.currentY);
  return (
    element.right >= left && element.left <= right && element.bottom >= top && element.top <= bottom
  );
}

function isSelectionExcludedTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      ".workspace-heading, .empty-state, .item-context-menu, button, input, textarea, select, label",
    ) !== null
  );
}

type ContextMenuState = {
  readonly item: WorkspaceItem;
  readonly selectedItems: readonly WorkspaceItem[];
  readonly x: number;
  readonly y: number;
};

const CARD_SCALE_MIN = 80;
const CARD_SCALE_MAX = 140;
const CARD_SCALE_STEP = 5;
// 框选起步的死区：指针抖几像素不该算拖拽。越不过死区就不捕获指针，卡片左上角预览
// 按钮的双击才有机会落地——一旦捕获，pointerup/click/dblclick 全被改派到工作区根节点。
const SELECTION_DRAG_SLOP = 3;

export function ItemWorkspace(props: ItemWorkspaceProps): React.JSX.Element {
  const [cardScale, setCardScale] = useState(100);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [groupDropTargetPath, setGroupDropTargetPath] = useState<string | null>(null);
  const [renameState, setRenameState] = useState<{
    readonly item: WorkspaceItem;
    readonly value: string;
    readonly submitting: boolean;
  } | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const selectionDragArmedRef = useRef(false);
  const renamePath = renameState === null ? undefined : workspaceItemKey(renameState.item);
  const cardScaleEnabled = props.viewMode === "grid";
  const effectiveCardScale = cardScaleEnabled ? cardScale : CARD_SCALE_MAX;
  const cardSize: CardSize = cardScaleEnabled
    ? cardScale < 94
      ? "small"
      : cardScale > 112
        ? "large"
        : "medium"
    : "large";

  const updateCardScale = (value: number): void => {
    if (!cardScaleEnabled) return;
    setCardScale(Math.min(CARD_SCALE_MAX, Math.max(CARD_SCALE_MIN, value)));
  };

  useEffect(() => {
    if (renamePath === undefined) {
      return;
    }
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamePath]);

  const beginRename = (item: WorkspaceItem): void => {
    if (props.readOnly || props.operationBusy) {
      return;
    }
    const itemKey = workspaceItemKey(item);
    if (!props.selectedPaths.includes(itemKey)) {
      props.onSelect(itemKey, { range: false, toggle: false });
    }
    setContextMenu(null);
    setRenameState({ item, value: renameInputValue(item), submitting: false });
  };

  const cancelRename = (): void => setRenameState(null);

  const commitRename = async (): Promise<void> => {
    const current = renameState;
    if (current === null || current.submitting) {
      return;
    }
    const nextValue = current.value.trim();
    if (nextValue.length === 0 || nextValue === renameInputValue(current.item)) {
      cancelRename();
      return;
    }
    const nextName = renameFileName(current.item, nextValue);
    setRenameState({ ...current, submitting: true });
    const succeeded = await props.onRenameItem(current.item, nextName);
    if (succeeded) {
      setRenameState(null);
    } else {
      setRenameState((latest) => (latest === null ? null : { ...latest, submitting: false }));
    }
  };

  const endSelection = (): void => {
    selectionDragArmedRef.current = false;
    setSelectionBox(null);
  };

  const updateBox = (event: React.PointerEvent<HTMLElement>): void => {
    if (selectionBox === null) {
      return;
    }
    const next = { ...selectionBox, currentX: event.clientX, currentY: event.clientY };
    if (!selectionDragArmedRef.current) {
      const movedX = Math.abs(next.currentX - next.startX);
      const movedY = Math.abs(next.currentY - next.startY);
      if (movedX <= SELECTION_DRAG_SLOP && movedY <= SELECTION_DRAG_SLOP) {
        return;
      }
      selectionDragArmedRef.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    setSelectionBox(next);
    const paths = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(".item-card"))
      .filter((element) => intersects(next, element.getBoundingClientRect()))
      .flatMap((element) =>
        element.dataset["itemPath"] === undefined ? [] : [element.dataset["itemPath"]],
      );
    props.onBoxSelect(paths);
  };

  /** 右键菜单的启用/停用项：与卡片右下角开关同一行为——按右键那张卡片的当前状态取反，
      多选时作用于整个选区；菜单宽度装不下 aria-label 里的条目名，所以标签只写动词。 */
  const enableToggleAction = (menu: ContextMenuState): ContextMenuAction => {
    const enabled = !menu.item.enabled;
    // 与卡片开关同一套忙碌判据：本条目在途或整个工作区正忙时都不可点。
    const busy =
      props.operationBusy ||
      menu.selectedItems.some((item) => props.busyItemKeys.has(workspaceItemKey(item)));
    return {
      disabled: busy,
      icon: enabled ? <Power size={16} /> : <PowerOff size={16} />,
      label: enabled ? "启用" : "停用",
      onClick: () => {
        if (menu.selectedItems.length > 1) {
          props.onSetItemsEnabled(menu.selectedItems, enabled);
          return;
        }
        props.onSetItemEnabled(menu.item, enabled);
      },
    };
  };

  const contextActions: readonly ContextMenuAction[] =
    contextMenu === null
      ? []
      : contextMenu.item.kind === "group"
        ? [
            enableToggleAction(contextMenu),
            {
              icon: <FolderInput size={16} />,
              label: "\u79fb\u52a8",
              onClick: props.onMove,
              ...(props.moveTargets.length === 0
                ? {}
                : {
                    children: moveTargetActions(
                      props.moveTargets,
                      contextMenu.selectedItems,
                      props.onMoveTo,
                    ),
                  }),
            },
            {
              icon: <LogIn size={16} />,
              label: "\u8fdb\u5165\u7ec4",
              onClick: () => props.onEnterGroup(contextMenu.item),
            },
            {
              icon: <Ungroup size={16} />,
              label: "\u89e3\u6563\u7ec4",
              onClick: props.onDissolveGroup,
            },
            {
              disabled: true,
              icon: <Layers size={16} />,
              label: "\u52a0\u5165\u9884\u8bbe",
              onClick: props.onAddToPreset,
            },
            {
              icon: <Pencil size={16} />,
              label: "\u91cd\u547d\u540d",
              onClick: () => beginRename(contextMenu.item),
            },
            {
              icon: <Trash2 size={16} />,
              label: "\u5220\u9664",
              onClick: props.onRecycle,
              kind: "delete",
            },
          ]
        : [
            enableToggleAction(contextMenu),
            {
              icon: <FolderInput size={16} />,
              label: "\u79fb\u52a8",
              onClick: props.onMove,
              ...(props.moveTargets.length === 0
                ? {}
                : {
                    children: moveTargetActions(
                      props.moveTargets,
                      contextMenu.selectedItems,
                      props.onMoveTo,
                    ),
                  }),
            },
            {
              disabled:
                contextMenu.selectedItems.length < 2 ||
                !contextMenu.selectedItems.every((item) => item.kind === "patch"),
              icon: <Boxes size={16} />,
              label: "\u6253\u7ec4",
              onClick: props.onCreateGroup,
              shortcut: "Ctrl+G",
            },
            {
              disabled: !contextMenu.selectedItems.every((item) => item.kind === "patch"),
              icon: <Layers size={16} />,
              label: "\u52a0\u5165\u9884\u8bbe",
              onClick: props.onAddToPreset,
            },
            {
              icon: <Pencil size={16} />,
              label: "\u91cd\u547d\u540d",
              onClick: () => beginRename(contextMenu.item),
              shortcut: "F2",
            },
            {
              icon: <FolderOpen size={16} />,
              label: "\u6e90\u6587\u4ef6",
              onClick: () => props.onRevealSource(contextMenu.item.relativePath),
            },
            {
              icon: <Trash2 size={16} />,
              label: "\u5220\u9664",
              onClick: props.onRecycle,
              kind: "delete",
              separatorBefore: true,
              shortcut: "Del",
            },
          ];

  return (
    <main
      className="patch-workspace"
      aria-label="补丁工作区"
      onPointerDown={(event) => {
        if (
          event.button === 0 &&
          renameState !== null &&
          !(event.target instanceof Element && event.target.closest(".item-title-edit") !== null)
        ) {
          void commitRename();
        }
        if (event.button !== 0) {
          return;
        }
        // 清分类选中高亮：凡不是落在卡片或控件上的左键点击都算点主区空白。
        // 与下面的框选判断分开——框选还要排除 .empty-state，而空状态占满主区，
        // 点它在用户看来就是点空白。
        if (
          !(event.target instanceof Element) ||
          event.target.closest(
            ".item-card, .workspace-heading, .item-context-menu, button, input, textarea, select, label",
          ) === null
        ) {
          props.onClearCategoryHighlight();
        }
        if (isSelectionExcludedTarget(event.target)) {
          return;
        }
        event.preventDefault();
        selectionDragArmedRef.current = false;
        setSelectionBox({
          currentX: event.clientX,
          currentY: event.clientY,
          startX: event.clientX,
          startY: event.clientY,
        });
        props.onBoxSelect([]);
      }}
      onPointerMove={updateBox}
      onPointerUp={endSelection}
      onPointerCancel={endSelection}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (!props.readOnly && event.dataTransfer.files.length > 0) {
          props.onImportDropped(Array.from(event.dataTransfer.files));
        }
      }}
      onKeyDown={(event) => {
        if (props.readOnly || props.operationBusy) {
          return;
        }
        if (
          event.target instanceof HTMLElement &&
          (event.target.closest("input, textarea, select") !== null ||
            event.target.closest(".item-context-menu") !== null)
        ) {
          return;
        }
        const selected = props.selectedItems;
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLocaleLowerCase() === "g" &&
          selected.length >= 2 &&
          selected.every((item) => item.kind === "patch")
        ) {
          event.preventDefault();
          props.onCreateGroup();
          return;
        }
        if (event.key === "F2" && selected.length === 1) {
          event.preventDefault();
          const [item] = selected;
          if (item !== undefined) {
            beginRename(item);
          }
          return;
        }
        if (event.key === "Delete" && selected.length > 0) {
          event.preventDefault();
          props.onRecycle();
        }
      }}
      onContextMenu={(event) => {
        if (event.target === event.currentTarget) {
          event.preventDefault();
          setContextMenu(null);
        }
      }}
      tabIndex={-1}
    >
      <div className="workspace-heading">
        <div className="workspace-heading-actions">
          <label className="search-field workspace-search-field">
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="搜索补丁"
              className="workspace-search-input"
              onChange={(event) => props.onQueryChange(event.currentTarget.value)}
              placeholder="搜索补丁或组"
              type="search"
              value={props.query}
            />
            {/* 必须排在 input 之后：toolbar.css 用 `input:focus ~ .nebula-particle` 触发。 */}
            {SEARCH_NEBULA_PARTICLES.map(([x, y]) => (
              <span
                aria-hidden="true"
                className="nebula-particle"
                key={`${x}:${y}`}
                style={{ "--x": x, "--y": y } as React.CSSProperties}
              />
            ))}
          </label>
          <fieldset className="view-mode-control" aria-label="项目视图">
            <button
              aria-label="网格视图"
              aria-pressed={props.viewMode === "grid"}
              onClick={() => props.onViewModeChange("grid")}
              title="网格视图"
              type="button"
            >
              <Grid2X2 aria-hidden="true" size={15} />
            </button>
            <button
              aria-label="列表视图"
              aria-pressed={props.viewMode === "list"}
              onClick={() => props.onViewModeChange("list")}
              title="列表视图"
              type="button"
            >
              <List aria-hidden="true" size={16} />
            </button>
          </fieldset>
          {props.showDescendantToggle ? (
            <label className="descendant-toggle" title="同时显示当前分类下所有子分类中的补丁">
              <input
                aria-label="包含子分类"
                checked={props.includeDescendants}
                onChange={(event) => props.onIncludeDescendantsChange(event.currentTarget.checked)}
                type="checkbox"
              />
              <span>包含子分类</span>
            </label>
          ) : null}
        </div>
      </div>
      <fieldset className="enabled-filter-control" aria-label="启用状态">
        <button
          aria-pressed={props.enabledFilter === "all"}
          onClick={() => props.onEnabledFilterChange("all")}
          type="button"
        >
          全部 {props.enabledCounts.all}
        </button>
        <button
          aria-pressed={props.enabledFilter === "enabled"}
          onClick={() => props.onEnabledFilterChange("enabled")}
          type="button"
        >
          已启用 {props.enabledCounts.enabled}
        </button>
        <button
          aria-pressed={props.enabledFilter === "disabled"}
          onClick={() => props.onEnabledFilterChange("disabled")}
          type="button"
        >
          未启用 {props.enabledCounts.disabled}
        </button>
        <div
          className="card-scale-control"
          onWheel={(event) => {
            if (!cardScaleEnabled) return;
            event.preventDefault();
            updateCardScale(cardScale + (event.deltaY < 0 ? CARD_SCALE_STEP : -CARD_SCALE_STEP));
          }}
          title={cardScaleEnabled ? "拖动或使用滚轮调整补丁卡片大小" : "列表模式固定使用最大尺寸"}
        >
          <button
            aria-label="减小补丁卡片"
            className="card-scale-step"
            disabled={!cardScaleEnabled || cardScale <= CARD_SCALE_MIN}
            onClick={() => updateCardScale(cardScale - CARD_SCALE_STEP)}
            title="减小卡片"
            type="button"
          >
            <Minus aria-hidden="true" size={14} />
          </button>
          <input
            aria-label="补丁卡片缩放"
            disabled={!cardScaleEnabled}
            max={CARD_SCALE_MAX}
            min={CARD_SCALE_MIN}
            onChange={(event) => updateCardScale(Number(event.currentTarget.value))}
            step={CARD_SCALE_STEP}
            type="range"
            value={cardScale}
          />
          <button
            aria-label="增大补丁卡片"
            className="card-scale-step"
            disabled={!cardScaleEnabled || cardScale >= CARD_SCALE_MAX}
            onClick={() => updateCardScale(cardScale + CARD_SCALE_STEP)}
            title="增大卡片"
            type="button"
          >
            <Plus aria-hidden="true" size={14} />
          </button>
        </div>
        {props.onReturnFromGroup === undefined ? null : (
          <button onClick={props.onReturnFromGroup} type="button">
            返回组
          </button>
        )}
      </fieldset>
      {props.loading ? (
        <section className="empty-state" aria-label="正在扫描补丁库">
          <div className="empty-state-content">
            <PackageOpen className="spin" size={28} />
            <h3>正在读取补丁库</h3>
          </div>
        </section>
      ) : props.visibleItems.length === 0 ? (
        <section className="empty-state" aria-label="无匹配项目">
          <div className="empty-state-content">
            <div className="empty-icon">
              <Search size={26} />
            </div>
            <h3>{props.items.length === 0 ? "补丁库还是空的" : "没有符合条件的项目"}</h3>
            <p>
              {props.items.length === 0
                ? "将 NPK 或 BK2 文件拖入此处开始整理。"
                : "调整搜索词或状态筛选。"}
            </p>
          </div>
        </section>
      ) : (
        <section
          className={props.viewMode === "grid" ? "item-grid" : "item-list"}
          aria-label="补丁项目"
          data-card-size={cardSize}
          style={
            {
              "--item-card-min-width": `${Math.round(212 * (effectiveCardScale / 100))}px`,
              "--item-list-card-height": `${Math.round(54 * (effectiveCardScale / 100))}px`,
              "--item-list-thumb-size": `${Math.round(54 * (effectiveCardScale / 100) - 8)}px`,
              "--item-list-thumb-icon-size": `${Math.round(28 * (effectiveCardScale / 100))}px`,
              "--item-list-name-padding": `${Math.round(54 * (effectiveCardScale / 100) + 4)}px`,
            } as React.CSSProperties
          }
        >
          {props.visibleItems.map((item) => {
            const itemKey = workspaceItemKey(item);
            const selected = props.selectedPaths.includes(itemKey);
            const location = itemLocation(item, props.categoryPath);
            const groupDropTarget = groupDropTargetPath === itemKey;
            return (
              <div
                className="item-card-shell"
                data-renaming={
                  renameState !== null && workspaceItemKey(renameState.item) === itemKey
                }
                key={itemKey}
              >
                <button
                  aria-label={
                    location === null ? item.name : `${item.name} - ${itemCategoryPath(item)}`
                  }
                  aria-pressed={selected}
                  className="item-card"
                  data-enabled={item.enabled}
                  data-item-drop-target={groupDropTarget ? "true" : undefined}
                  data-item-path={itemKey}
                  data-kind={item.kind}
                  draggable
                  onDragStart={(event) => {
                    const draggedItems = selected ? props.selectedItems : [item];
                    if (!selected) {
                      props.onSelect(itemKey, { range: false, toggle: false });
                    }
                    const dragPreview =
                      event.currentTarget.parentElement?.querySelector<HTMLElement>(
                        ".item-drag-preview",
                      );
                    if (
                      dragPreview !== null &&
                      dragPreview !== undefined &&
                      typeof event.dataTransfer.setDragImage === "function"
                    ) {
                      event.dataTransfer.setDragImage(dragPreview, 22, 22);
                    }
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData(
                      LIBRARY_ITEMS_DRAG_TYPE,
                      encodeWorkspaceItemDrag(draggedItems.map(workspaceItemReference)),
                    );
                  }}
                  onDragEnter={(event) => {
                    if (
                      item.kind !== "group" ||
                      props.readOnly ||
                      props.operationBusy ||
                      !isWorkspaceItemsDrag(event.dataTransfer)
                    ) {
                      return;
                    }
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setGroupDropTargetPath(itemKey);
                  }}
                  onDragLeave={(event) => {
                    if (
                      event.relatedTarget instanceof Node &&
                      event.currentTarget.contains(event.relatedTarget)
                    ) {
                      return;
                    }
                    setGroupDropTargetPath((current) => (current === itemKey ? null : current));
                  }}
                  onDragOver={(event) => {
                    if (
                      item.kind !== "group" ||
                      props.readOnly ||
                      props.operationBusy ||
                      !isWorkspaceItemsDrag(event.dataTransfer)
                    ) {
                      return;
                    }
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setGroupDropTargetPath(itemKey);
                  }}
                  onDrop={(event) => {
                    if (item.kind !== "group") return;
                    event.preventDefault();
                    event.stopPropagation();
                    setGroupDropTargetPath(null);
                    if (props.readOnly || props.operationBusy) return;
                    const patches = decodeWorkspaceItemDrag(
                      event.dataTransfer.getData(LIBRARY_ITEMS_DRAG_TYPE),
                    ).filter((draggedItem) => draggedItem.kind === "patch");
                    if (patches.length > 0) props.onAddGroupMembers(item.id, patches);
                  }}
                  onClick={(event) =>
                    props.onSelect(itemKey, {
                      range: event.shiftKey,
                      toggle: event.ctrlKey || event.metaKey,
                    })
                  }
                  onDoubleClick={(event) => {
                    if (event.target instanceof Element && event.target.closest(".item-preview")) {
                      props.onSelectPreview(item);
                    } else if (item.kind === "group") {
                      beginRename(item);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) {
                      return;
                    }
                    if (event.key === "F2" && !props.readOnly && !props.operationBusy) {
                      event.preventDefault();
                      event.stopPropagation();
                      beginRename(item);
                      return;
                    }
                    if (event.key === "Delete" && !props.readOnly && !props.operationBusy) {
                      event.preventDefault();
                      event.stopPropagation();
                      if (!selected) {
                        props.onSelect(itemKey, { range: false, toggle: false });
                      }
                      props.onRecycle();
                      return;
                    }
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      props.onSelect(itemKey, { range: false, toggle: false });
                    }
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    if (props.readOnly) return;
                    if (!selected) {
                      props.onSelect(itemKey, { range: false, toggle: false });
                    }
                    setContextMenu({
                      item,
                      selectedItems: selected ? props.selectedItems : [item],
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                  title={itemCategoryPath(item)}
                  type="button"
                >
                  <span
                    className={`item-preview ${item.previewUrl === null ? "item-preview-empty" : ""}`}
                  >
                    {item.previewUrl === null ? (
                      item.kind === "group" ? (
                        <Box size={30} />
                      ) : (
                        <PackageOpen size={30} />
                      )
                    ) : (
                      <img
                        alt={`${item.name} 预览`}
                        className="item-preview-image"
                        src={item.previewUrl}
                      />
                    )}
                  </span>
                  <span className="item-card-body">
                    <span className="item-name-cell">
                      {/* track 是标题滚动层：卡片里名字装不下时由它在悬停时
                          向左平移，列表视图用 display: contents 让它不产生盒子。 */}
                      <span className="item-title">
                        <span className="item-title-track">{item.name}</span>
                      </span>
                      {location === null ? null : <span className="item-location">{location}</span>}
                    </span>
                    {item.kind === "patch" ? null : (
                      <span className="item-type">{itemType(item)}</span>
                    )}
                    <span className="item-meta">{itemDescription(item)}</span>
                    <span className="item-date">{itemDate(item)}</span>
                  </span>
                </button>
                <span aria-hidden="true" className="item-drag-preview">
                  {item.kind === "group" ? <Box size={22} /> : <PackageOpen size={22} />}
                  {selected && props.selectedItems.length > 1 ? (
                    <span className="item-drag-preview-count">{props.selectedItems.length}</span>
                  ) : null}
                </span>
                <span
                  aria-hidden="true"
                  className="item-preview-hover-zone"
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    props.onSelectPreview(item);
                  }}
                  onMouseEnter={(event) => {
                    const video = event.currentTarget.querySelector("video");
                    if (video !== null) void video.play().catch(() => {});
                  }}
                  onMouseLeave={(event) => {
                    const video = event.currentTarget.querySelector("video");
                    if (video !== null) {
                      video.pause();
                      video.currentTime = 0;
                    }
                  }}
                >
                  <span className="item-preview-hover-dot" />
                  {hoverVideoUrl(item) !== null ? (
                    // 视频预览优先于静态图片：卡片左上角悬停时直接播放。
                    <video
                      className="item-preview-hover-video"
                      loop
                      muted
                      playsInline
                      preload="metadata"
                      src={hoverVideoUrl(item) ?? undefined}
                    />
                  ) : item.previewUrl === null ? null : (
                    <img alt="" className="item-preview-hover-image" src={item.previewUrl} />
                  )}
                </span>
                {renameState !== null && workspaceItemKey(renameState.item) === itemKey ? (
                  <input
                    ref={renameInputRef}
                    aria-label={`重命名 ${item.name}`}
                    className="item-title-edit"
                    disabled={renameState.submitting}
                    onBlur={() => void commitRename()}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setRenameState((current) =>
                        current === null ? null : { ...current, value },
                      );
                    }}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.stopPropagation();
                        void commitRename();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        cancelRename();
                      }
                    }}
                    value={renameState.value}
                  />
                ) : null}
                <label
                  className="switch"
                  title={item.enabled ? "\u505c\u7528\u8865\u4e01" : "\u542f\u7528\u8865\u4e01"}
                >
                  <input
                    aria-label={`${item.enabled ? "\u505c\u7528" : "\u542f\u7528"} ${item.name}`}
                    checked={item.enabled}
                    disabled={
                      props.readOnly || props.busyItemKeys.has(itemKey) || props.operationBusy
                    }
                    onChange={(event) => {
                      const enabled = event.currentTarget.checked;
                      // 多选时开关作用于整个选区，与 Windows 里批量勾选一致；
                      // 未选中或只选一张时仍是单卡片行为。
                      if (selected && props.selectedItems.length > 1) {
                        props.onSetItemsEnabled(props.selectedItems, enabled);
                        return;
                      }
                      props.onSetItemEnabled(item, enabled);
                    }}
                    onClick={(event) => {
                      // 阻止冒泡，否则点击开关会先把选区收窄成这一张卡片。
                      event.stopPropagation();
                    }}
                    onDoubleClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    type="checkbox"
                  />
                  <span className="slider" />
                </label>
              </div>
            );
          })}
          {selectionBox === null ? null : (
            <span
              className="selection-box"
              style={{
                height: Math.abs(selectionBox.currentY - selectionBox.startY),
                left: Math.min(selectionBox.startX, selectionBox.currentX),
                top: Math.min(selectionBox.startY, selectionBox.currentY),
                width: Math.abs(selectionBox.currentX - selectionBox.startX),
              }}
            />
          )}
        </section>
      )}
      {contextMenu === null ? null : (
        <ContextMenu
          actions={contextActions}
          disabled={props.operationBusy || props.readOnly}
          onClose={() => setContextMenu(null)}
          x={contextMenu.x}
          y={contextMenu.y}
        />
      )}
    </main>
  );
}

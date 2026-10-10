import { ChevronRight } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";

// 菜单与窗口边缘的最小间距，与侧边栏分类菜单的收边留白一致。
const VIEWPORT_MARGIN = 8;

export type ContextMenuAction = {
  readonly children?: readonly ContextMenuAction[];
  readonly disabled?: boolean;
  readonly icon: React.ReactNode;
  readonly kind?: "delete";
  readonly label: string;
  readonly onClick: () => void;
  readonly separatorBefore?: boolean;
  readonly shortcut?: string;
};

type ContextMenuProps = {
  readonly actions: readonly ContextMenuAction[];
  readonly className?: string;
  readonly disabled?: boolean;
  readonly onClose: () => void;
  readonly x: number;
  readonly y: number;
};

type MenuListProps = {
  readonly actions: readonly ContextMenuAction[];
  readonly disabled: boolean;
  readonly onClose: () => void;
  readonly openPath: readonly number[];
  readonly path: readonly number[];
  readonly setOpenPath: (path: readonly number[]) => void;
};

function pathIsOpen(openPath: readonly number[], path: readonly number[]): boolean {
  return path.every((segment, index) => openPath[index] === segment);
}

function pathsEqual(first: readonly number[], second: readonly number[]): boolean {
  return (
    first.length === second.length && first.every((segment, index) => second[index] === segment)
  );
}

function ariaShortcut(shortcut: string | undefined): string | undefined {
  if (shortcut === undefined) return undefined;
  if (shortcut === "Ctrl+") return "Control+";
  if (shortcut.startsWith("Ctrl+")) return `Control+${shortcut.slice("Ctrl+".length)}`;
  return shortcut === "Del" ? "Delete" : shortcut;
}

function MenuList({
  actions,
  disabled,
  onClose,
  openPath,
  path,
  setOpenPath,
}: MenuListProps): React.JSX.Element {
  const listRef = useRef<HTMLDivElement | null>(null);
  const pillRef = useRef<HTMLDivElement | null>(null);

  const movePill = (target: HTMLElement, danger: boolean): void => {
    const list = listRef.current;
    const pill = pillRef.current;
    if (list === null || pill === null) return;
    const listRect = list.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    pill.style.top = `${targetRect.top - listRect.top}px`;
    pill.style.left = `${targetRect.left - listRect.left}px`;
    pill.style.width = `${targetRect.width}px`;
    pill.style.height = `${targetRect.height}px`;
    pill.style.opacity = "1";
    pill.dataset["danger"] = danger ? "true" : "false";
  };

  const hidePill = (): void => {
    const pill = pillRef.current;
    if (pill !== null) pill.style.opacity = "0";
  };

  const hidePillIfLeavingList = (
    event: React.FocusEvent<HTMLButtonElement> | React.MouseEvent<HTMLButtonElement>,
  ): void => {
    if (event.relatedTarget instanceof Node && listRef.current?.contains(event.relatedTarget)) {
      return;
    }
    hidePill();
  };

  // 叶子项没有自己的子面板，进入它就表示这一层是终点：
  // 必须把比当前层更深的子面板收起，否则旧的三级子面板会一直残留。
  const enterLeafItem = (target: HTMLElement, danger: boolean): void => {
    setOpenPath(path);
    movePill(target, danger);
  };

  return (
    <div className="item-context-menu-list list" ref={listRef}>
      <div aria-hidden="true" className="item-context-menu-pill" ref={pillRef} />
      {actions.map((action, index) => {
        const actionPath = [...path, index];
        const children = action.children ?? [];
        const hasChildren = children.length > 0;
        const expanded = hasChildren && pathIsOpen(openPath, actionPath);
        const runAction = (): void => {
          onClose();
          action.onClick();
        };
        const runPointerAction = (event: React.PointerEvent<HTMLButtonElement>): void => {
          if (event.button !== 0) return;
          event.preventDefault();
          runAction();
        };

        return (
          <Fragment key={action.label}>
            {action.separatorBefore ? (
              <div aria-hidden="true" className="item-context-menu-separator" />
            ) : null}
            {hasChildren ? (
              <fieldset
                className="item-context-submenu"
                onFocus={() => setOpenPath(actionPath)}
                onMouseEnter={() => setOpenPath(actionPath)}
              >
                <button
                  aria-expanded={expanded}
                  aria-haspopup="menu"
                  aria-keyshortcuts={ariaShortcut(action.shortcut)}
                  className={`item-context-menu-item element has-children${action.kind === "delete" ? " delete" : ""}`}
                  data-danger={action.kind === "delete" ? "true" : undefined}
                  disabled={disabled || action.disabled}
                  onClick={runAction}
                  onFocus={(event) => movePill(event.currentTarget, action.kind === "delete")}
                  onBlur={hidePillIfLeavingList}
                  onMouseEnter={(event) => movePill(event.currentTarget, action.kind === "delete")}
                  onMouseLeave={hidePillIfLeavingList}
                  onPointerDown={runPointerAction}
                  role="menuitem"
                  type="button"
                >
                  <span className="item-context-menu-icon">{action.icon}</span>
                  <span className="item-context-menu-label">{action.label}</span>
                  <ChevronRight className="item-context-menu-chevron" size={14} />
                </button>
                {expanded ? (
                  <div className="item-context-submenu-panel card" role="menu">
                    <MenuList
                      actions={children}
                      disabled={disabled}
                      onClose={onClose}
                      openPath={openPath}
                      path={actionPath}
                      setOpenPath={setOpenPath}
                    />
                  </div>
                ) : null}
              </fieldset>
            ) : (
              <button
                aria-keyshortcuts={ariaShortcut(action.shortcut)}
                className={`item-context-menu-item element${action.kind === "delete" ? " delete" : ""}`}
                data-danger={action.kind === "delete" ? "true" : undefined}
                disabled={disabled || action.disabled}
                onClick={runAction}
                onFocus={(event) => enterLeafItem(event.currentTarget, action.kind === "delete")}
                onBlur={hidePillIfLeavingList}
                onMouseEnter={(event) =>
                  enterLeafItem(event.currentTarget, action.kind === "delete")
                }
                onMouseLeave={hidePillIfLeavingList}
                onPointerDown={runPointerAction}
                role="menuitem"
                type="button"
              >
                <span className="item-context-menu-icon">{action.icon}</span>
                <span className="item-context-menu-label">{action.label}</span>
                {action.shortcut === undefined ? null : (
                  <span aria-hidden="true" className="item-context-menu-shortcut">
                    {action.shortcut}
                  </span>
                )}
              </button>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

export function ContextMenu({
  actions,
  className,
  disabled = false,
  onClose,
  x,
  y,
}: ContextMenuProps): React.JSX.Element {
  const [openPath, setOpenPath] = useState<readonly number[]>([]);
  const [placement, setPlacement] = useState<{
    left: number;
    originX: string;
    originY: string;
    top: number;
  }>({ left: x, originX: "left", originY: "top", top: y });
  const menuRef = useRef<HTMLDivElement | null>(null);
  const openMenuPath = (path: readonly number[]): void => {
    setOpenPath((current) => (pathsEqual(current, path) ? current : path));
  };

  // 菜单固定定位在光标处，滚动无法把它带回视口；向下放不下时改为向上展开，
  // 向右放不下时向左收边，避免贴着窗口下缘/右缘右键时菜单被裁掉。
  // transform-origin 同步指向光标所在角，入场缩放才会"从点击处生长"。
  useLayoutEffect(() => {
    const node = menuRef.current;
    if (node === null) return;
    const { width, height } = node.getBoundingClientRect();
    if (width === 0 || height === 0) return;
    const flipsLeft = x + width + VIEWPORT_MARGIN > window.innerWidth;
    const flipsUp = y + height + VIEWPORT_MARGIN > window.innerHeight;
    const left = flipsLeft
      ? Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN)
      : x;
    const top = flipsUp ? Math.max(VIEWPORT_MARGIN, y - height) : y;
    const next = {
      left,
      originX: flipsLeft ? "right" : "left",
      originY: flipsUp ? "bottom" : "top",
      top,
    };
    setPlacement((current) =>
      current.left === next.left && current.top === next.top ? current : next,
    );
  }, [x, y]);

  useEffect(() => {
    const closeOnPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) {
        return;
      }
      onClose();
    };
    // 菜单不随内容滚动（fixed 定位），滚动后继续悬浮只会与卡片错位，直接关闭。
    const closeOnScroll = (): void => {
      onClose();
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("scroll", closeOnScroll, { capture: true, passive: true });
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("scroll", closeOnScroll, { capture: true });
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className={`item-context-menu card${className === undefined ? "" : ` ${className}`}`}
      onContextMenu={(event) => event.preventDefault()}
      role="menu"
      style={{
        left: placement.left,
        top: placement.top,
        transformOrigin: `${placement.originY} ${placement.originX}`,
      }}
    >
      <MenuList
        actions={actions}
        disabled={disabled}
        onClose={onClose}
        openPath={openPath}
        path={[]}
        setOpenPath={openMenuPath}
      />
    </div>
  );
}

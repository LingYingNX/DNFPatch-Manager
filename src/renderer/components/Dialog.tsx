import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";

type DialogProps = {
  readonly backdropClassName?: string;
  readonly className?: string;
  readonly children: ReactNode;
  readonly closeOnBackdrop?: boolean;
  readonly hideHeader?: boolean;
  readonly onClose: () => void;
  readonly title: string;
};

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const INITIAL_FOCUS = "[data-dialog-initial-focus]";

export function Dialog({
  backdropClassName = "",
  children,
  className = "",
  closeOnBackdrop = false,
  hideHeader = false,
  onClose,
  title,
}: DialogProps): React.JSX.Element {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // 调用方普遍传内联箭头函数，若把它写进依赖数组会导致每次父渲染都重装
  // 监听并重跑初始聚焦，把用户正在输入的焦点打回首个可聚焦元素。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    panelRef.current?.querySelector<HTMLElement>(INITIAL_FOCUS)?.focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (first === undefined || last === undefined) {
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
      queueMicrotask(() => {
        if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
          return;
        }
        document.querySelector<HTMLElement>(".patch-workspace")?.focus();
      });
    };
  }, []);

  return (
    <div className={`dialog-backdrop ${backdropClassName}`.trim()}>
      {closeOnBackdrop ? (
        <button
          aria-label="关闭对话框"
          className="dialog-backdrop-dismiss"
          onClick={onClose}
          tabIndex={-1}
          type="button"
        />
      ) : null}
      <div
        aria-label={hideHeader ? title : undefined}
        aria-labelledby={hideHeader ? undefined : titleId}
        aria-modal="true"
        className={`dialog-panel ${className}`.trim()}
        ref={panelRef}
        role="dialog"
      >
        {hideHeader ? null : (
          <header className="dialog-heading">
            <h2 id={titleId}>{title}</h2>
            <button
              className="dialog-close"
              type="button"
              aria-label="关闭对话框"
              onClick={onClose}
            >
              <X size={18} />
            </button>
          </header>
        )}
        {children}
      </div>
    </div>
  );
}

import { Check, Copy, Minus, Sparkles, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { DnfApi } from "../../shared/ipc-contracts";
import type { AppUpdate } from "../workspace/useAppUpdate";

type Props = {
  readonly client: DnfApi | undefined;
  readonly update: AppUpdate;
};

const UPDATE_NOTICE_KINDS = {
  available: { icon: Sparkles, title: "发现新版本" },
  current: { icon: Check, title: "当前已是最新版" },
} as const;

function resolveUpdateNotice(
  update: AppUpdate,
  currentVersion: string,
): { readonly detail: string; readonly icon: typeof Sparkles; readonly title: string } | null {
  const { noticeKind, phase } = update;
  if (noticeKind === null || noticeKind !== phase) return null;
  const { icon, title } = UPDATE_NOTICE_KINDS[noticeKind];
  return { detail: `v${update.latestVersion ?? currentVersion}`, icon, title };
}

export function WindowTitleBar({ client, update }: Props): React.JSX.Element {
  const [isMaximized, setIsMaximized] = useState(false);
  const [updateNoticeVisible, setUpdateNoticeVisible] = useState(false);
  const [dismissedSequence, setDismissedSequence] = useState<number | null>(null);
  const updateNotice = resolveUpdateNotice(update, client?.appInfo.version ?? "");

  useEffect(() => {
    if (client === undefined) return;
    const unsubscribe = client.windowControls.subscribeState((state) => {
      setIsMaximized(state.isMaximized);
    });
    void client.windowControls.getState().then((result) => {
      if (result.ok) setIsMaximized(result.value.isMaximized);
    });
    return unsubscribe;
  }, [client]);

  const noticeTitle = updateNotice?.title ?? null;
  useEffect(() => {
    const shouldShow =
      update.noticeSequence > 0 &&
      noticeTitle !== null &&
      dismissedSequence !== update.noticeSequence;
    setUpdateNoticeVisible(shouldShow);
    // “发现新版本”常驻直到手动关闭——启动时的自动检查可能比窗口晚几秒才完成，
    // 5 秒自动消失会让用户错过提示；“已是最新版”仅作确认，5 秒后自动淡出。
    if (!shouldShow || update.noticeKind !== "current") return;

    const timeoutId = window.setTimeout(() => setUpdateNoticeVisible(false), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [dismissedSequence, noticeTitle, update.noticeKind, update.noticeSequence]);

  const minimize = (): void => {
    if (client !== undefined) void client.windowControls.minimize();
  };

  const toggleMaximize = (): void => {
    if (client === undefined) return;
    void client.windowControls.toggleMaximize().then((result) => {
      if (result.ok) setIsMaximized(result.value.isMaximized);
    });
  };

  const close = (): void => {
    if (client !== undefined) void client.windowControls.close();
  };

  const handleDragRegionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleMaximize();
  };

  return (
    <header className="window-titlebar">
      {updateNoticeVisible && updateNotice !== null ? (
        <div
          aria-label={`${updateNotice.title} ${updateNotice.detail}`}
          aria-live="polite"
          className="window-titlebar-update-notice"
          data-kind={update.noticeKind}
          role="status"
        >
          <span className="window-titlebar-update-notice-icon">
            <updateNotice.icon aria-hidden="true" size={19} />
          </span>
          <span className="window-titlebar-update-notice-copy">
            <strong>{updateNotice.title}</strong>
            <span>{updateNotice.detail}</span>
          </span>
          <button
            aria-label="关闭更新提示"
            className="window-titlebar-update-notice-close"
            title="关闭提示"
            type="button"
            onClick={() => setDismissedSequence(update.noticeSequence)}
          >
            <X aria-hidden="true" size={13} />
          </button>
        </div>
      ) : null}
      <button
        aria-label="双击切换最大化"
        className="window-titlebar-drag-region"
        data-testid="window-titlebar-drag-region"
        tabIndex={0}
        type="button"
        onDoubleClick={toggleMaximize}
        onKeyDown={handleDragRegionKeyDown}
      >
        <span className="window-titlebar-title">
          <span>{`${client?.appInfo.name ?? "DNF 补丁管理器"} ${client?.appInfo.version ?? "1.3.0"}`}</span>
          <span className="window-titlebar-author">作者：铃音奈绪</span>
        </span>
      </button>
      <div className="window-controls">
        <button
          aria-label="最小化"
          className="window-control-button"
          disabled={client === undefined}
          title="最小化"
          type="button"
          onClick={minimize}
        >
          <Minus aria-hidden="true" size={14} strokeWidth={1.8} />
        </button>
        <button
          aria-label={isMaximized ? "还原" : "最大化"}
          className="window-control-button"
          disabled={client === undefined}
          title={isMaximized ? "还原" : "最大化"}
          type="button"
          onClick={toggleMaximize}
        >
          {isMaximized ? (
            <Copy aria-hidden="true" size={13} strokeWidth={1.8} />
          ) : (
            <Square aria-hidden="true" size={13} strokeWidth={1.8} />
          )}
        </button>
        <button
          aria-label="关闭"
          className="window-control-button window-control-close"
          disabled={client === undefined}
          title="关闭"
          type="button"
          onClick={close}
        >
          <X aria-hidden="true" size={15} strokeWidth={1.8} />
        </button>
      </div>
    </header>
  );
}

import {
  Bookmark,
  CheckCircle2,
  Download,
  ExternalLink,
  Folder,
  Github,
  Heart,
  Info,
  MessageSquareWarning,
  RefreshCw,
  Settings as SettingsIcon,
  Sparkles,
  Users,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import type { AppUpdate } from "../workspace/useAppUpdate";
import { Dialog } from "./Dialog";
import { CommandButton } from "./primitives";

type SupportUrl =
  | "https://afdian.com/a/naixu"
  | "https://docs.qq.com/smartsheet/DRXZyb2N2eUFmWHVC"
  | "https://github.com/LingYingNX/DNFguanliqi"
  | "https://qm.qq.com/q/ZxPw28W7eg"
  | "https://space.bilibili.com/41344302";
type SettingsSection = "general" | "recommended" | "about";

type Props = {
  readonly currentVersion: string;
  readonly gameDirectory: string | null;
  readonly gameDirectoryBusy: boolean;
  readonly onClose: () => void;
  readonly onOpenExternalUrl: (url: SupportUrl) => void;
  readonly onSelectGameDirectory: () => Promise<string | null>;
  readonly onSetGameDirectory: (value: string) => Promise<boolean>;
  readonly update: AppUpdate;
};

const NAV_ITEMS = [
  { icon: SettingsIcon, key: "general", label: "常规设置" },
  { icon: Sparkles, key: "recommended", label: "推荐内容" },
  { icon: Info, key: "about", label: "关于软件" },
] as const satisfies readonly {
  readonly icon: typeof SettingsIcon;
  readonly key: SettingsSection;
  readonly label: string;
}[];

const SUPPORT_LINKS = [
  {
    actionLabel: "去赞助",
    description: "本软件完全免费且开源。如果您觉得它有帮助，欢迎前往爱发电给予我持续维护的动力！",
    icon: Heart,
    key: "afdian",
    name: "请作者喝杯咖啡 ☕",
    url: "https://afdian.com/a/naixu",
  },
  {
    actionLabel: "去关注",
    description: "关注最新动态、视频教程与更新发布",
    icon: Bookmark,
    key: "bilibili",
    name: "哔哩哔哩主页",
    url: "https://space.bilibili.com/41344302",
  },
] as const;

const PROJECT_LINKS = [
  {
    icon: MessageSquareWarning,
    label: "软件反馈",
    url: "https://docs.qq.com/smartsheet/DRXZyb2N2eUFmWHVC",
  },
  {
    icon: Github,
    label: "项目地址",
    url: "https://github.com/LingYingNX/DNFguanliqi",
  },
  {
    icon: Users,
    label: "QQ群交流",
    url: "https://qm.qq.com/q/ZxPw28W7eg",
  },
] as const;

function ReleaseNoteHeading({
  level,
  text,
}: {
  readonly level: number;
  readonly text: string;
}): React.JSX.Element {
  if (level <= 2) return <h4>{text}</h4>;
  if (level === 3) return <h5>{text}</h5>;
  return <h6>{text}</h6>;
}

function ReleaseNotes({ lines }: { readonly lines: readonly string[] }): React.JSX.Element {
  if (lines.every((line) => line.trim() === "")) return <p>暂无发行说明</p>;

  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flushBullets = (): void => {
    if (bullets.length === 0) return;
    const items = bullets;
    bullets = [];
    blocks.push(
      <ul key={`list-${blocks.length}`}>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>,
    );
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") {
      flushBullets();
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/u.exec(trimmed);
    if (heading !== null) {
      flushBullets();
      blocks.push(
        <ReleaseNoteHeading
          key={`heading-${blocks.length}`}
          level={heading[1]?.length ?? 1}
          text={heading[2] ?? ""}
        />,
      );
      continue;
    }
    const bullet = /^[-*+]\s+(.+)$/u.exec(trimmed);
    if (bullet !== null) {
      bullets.push(bullet[1] ?? "");
      continue;
    }
    flushBullets();
    blocks.push(<p key={`paragraph-${blocks.length}`}>{trimmed}</p>);
  }
  flushBullets();

  return <>{blocks}</>;
}

function updateStatusText(update: AppUpdate): string | null {
  const latestVersion = update.latestVersion === null ? "" : ` v${update.latestVersion}`;
  switch (update.phase) {
    case "available":
      return `已检测到新版本${latestVersion}`;
    case "checking":
      return "正在检查更新";
    case "current":
      // 右上角版本徽章已显示当前版本，再提示"已是最新版"是重复信息。
      return null;
    case "downloading":
      return `正在下载更新 (${update.progress}%)`;
    case "downloaded":
      return "下载完成，点击重启安装";
    case "failed":
      return update.message ?? "更新失败";
    default:
      return "点击检查更新获取最新版本";
  }
}

export function SettingsDialog(props: Props): React.JSX.Element {
  const [section, setSection] = useState<SettingsSection>("general");
  const [draft, setDraft] = useState(props.gameDirectory ?? "");
  // 记录已提交过但被拒绝的值：同一无效值反复失焦时不重复发起保存，
  // 否则用户刚关掉的错误提示会被 onBlur 立刻写回，表现为"叉关不掉提示"。
  const [rejectedCommit, setRejectedCommit] = useState<string | null>(null);
  const update = props.update;
  const showProgressBar = update.phase === "downloading" || update.phase === "downloaded";
  const progressValue =
    update.phase === "downloaded" ? 100 : update.phase === "downloading" ? update.progress : 0;
  const statusText = updateStatusText(update);
  // 状态行与进度条都无内容时整块收起，让下方按钮紧贴说明框。
  const showStatusArea = statusText !== null || showProgressBar;

  useEffect(() => {
    setDraft(props.gameDirectory ?? "");
    setRejectedCommit(null);
  }, [props.gameDirectory]);

  const commit = (): void => {
    const nextDirectory = draft.trim();
    if (nextDirectory.length === 0 || nextDirectory === (props.gameDirectory ?? "")) return;
    if (nextDirectory === rejectedCommit) return;
    void props.onSetGameDirectory(nextDirectory).then((accepted) => {
      setRejectedCommit(accepted ? null : nextDirectory);
    });
  };

  return (
    <Dialog
      backdropClassName="settings-dialog-backdrop"
      className="settings-dialog-panel"
      closeOnBackdrop
      hideHeader
      onClose={props.onClose}
      title="设置"
    >
      <div className="settings-dialog-layout">
        <aside className="settings-sidebar">
          <nav aria-label="设置导航" className="settings-nav">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const selected = section === item.key;
              return (
                <button
                  aria-selected={selected}
                  className="settings-nav-item"
                  key={item.key}
                  onClick={() => setSection(item.key)}
                  role="tab"
                  type="button"
                >
                  <Icon aria-hidden="true" size={16} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="settings-content" role="tabpanel">
          <div className="settings-content-body">
            {section === "general" ? (
              <section className="settings-detail-section">
                <div className="settings-detail-heading">
                  <h3>游戏目录</h3>
                </div>
                <div className="settings-path-row">
                  <input
                    aria-label="游戏目录"
                    className="settings-path-input"
                    data-dialog-initial-focus="true"
                    disabled={props.gameDirectoryBusy}
                    id="game-directory"
                    onBlur={commit}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        commit();
                      }
                    }}
                    placeholder="请输入或粘贴游戏目录"
                    spellCheck={false}
                    type="text"
                    value={draft}
                  />
                  <CommandButton
                    aria-label="浏览"
                    className="settings-browse-button"
                    disabled={props.gameDirectoryBusy}
                    icon={<Folder size={16} />}
                    loading={props.gameDirectoryBusy}
                    onClick={async () => {
                      const selectedDirectory = await props.onSelectGameDirectory();
                      if (selectedDirectory !== null) setDraft(selectedDirectory);
                    }}
                    title="浏览游戏目录"
                  >
                    浏览
                  </CommandButton>
                </div>
              </section>
            ) : section === "recommended" ? (
              <section className="settings-empty-state">
                <Sparkles aria-hidden="true" size={28} />
                <h3>推荐内容</h3>
                <p>推荐内容功能正在准备中，后续会在这里展示精选资源和实用功能。</p>
              </section>
            ) : (
              <section className="settings-detail-section">
                <div className="settings-project-links">
                  {PROJECT_LINKS.map((link) => {
                    const LinkIcon = link.icon;
                    return (
                      <button
                        className="settings-update-secondary settings-project-link"
                        key={link.label}
                        onClick={() => props.onOpenExternalUrl(link.url)}
                        type="button"
                      >
                        <LinkIcon aria-hidden="true" size={14} />
                        {link.label}
                      </button>
                    );
                  })}
                </div>
                <div className="settings-support-list">
                  {SUPPORT_LINKS.map((link) => {
                    const PlatformIcon = link.icon;
                    return (
                      <article
                        className="settings-support-card"
                        data-support={link.key}
                        key={link.key}
                      >
                        <div className="settings-support-copy">
                          <span aria-hidden="true" className="settings-support-icon">
                            <PlatformIcon size={17} strokeWidth={1.9} />
                          </span>
                          <div>
                            <strong>{link.name}</strong>
                            <span>{link.description}</span>
                          </div>
                        </div>
                        <div className="settings-support-actions">
                          <button
                            aria-label={link.actionLabel}
                            className="settings-support-button"
                            onClick={() => props.onOpenExternalUrl(link.url)}
                            type="button"
                          >
                            <span>{link.actionLabel}</span>
                            <ExternalLink aria-hidden="true" size={13} strokeWidth={2} />
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
                <article className="settings-update-card">
                  <div className="settings-update-header">
                    <h3>软件更新</h3>
                    <span className="settings-version-badge">当前版本 v{props.currentVersion}</span>
                  </div>
                  <div className="settings-changelog-heading">更新说明</div>
                  <div className="settings-changelog-box">
                    <div className="settings-changelog-markdown">
                      <ReleaseNotes lines={update.releaseNotes} />
                    </div>
                  </div>
                  <div className="settings-update-footer">
                    {showStatusArea ? (
                      <div className="settings-update-progress-stack">
                        <div className="settings-progress-info">
                          {statusText === null ? null : <span>{statusText}</span>}
                          {showProgressBar ? <span>{progressValue}%</span> : null}
                        </div>
                        {showProgressBar ? (
                          <progress
                            aria-label="更新进度"
                            className="settings-update-progress"
                            max={100}
                            value={progressValue}
                          />
                        ) : null}
                      </div>
                    ) : null}
                    <div className="settings-update-actions">
                      <button
                        className="settings-update-secondary"
                        disabled={update.phase === "checking" || update.phase === "downloading"}
                        onClick={() => void update.check(true)}
                        type="button"
                      >
                        <RefreshCw aria-hidden="true" size={14} />
                        检查更新
                      </button>
                      <button
                        className="settings-update-primary"
                        disabled={update.phase !== "available" && update.phase !== "downloaded"}
                        onClick={() =>
                          void (update.phase === "downloaded"
                            ? update.install()
                            : update.download())
                        }
                        type="button"
                      >
                        {update.phase === "downloaded" ? (
                          <CheckCircle2 aria-hidden="true" size={14} />
                        ) : (
                          <Download aria-hidden="true" size={14} />
                        )}
                        {update.phase === "downloaded" ? "重启安装" : "立即更新"}
                      </button>
                    </div>
                  </div>
                </article>
              </section>
            )}
          </div>
        </main>
      </div>
    </Dialog>
  );
}

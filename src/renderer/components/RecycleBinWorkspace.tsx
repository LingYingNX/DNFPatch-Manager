import { Archive } from "lucide-react";
import { useState } from "react";
import type { RecycleEntryDto } from "../../shared/ipc-contracts";
import { CommandButton } from "./primitives";

type RecycleBinOperations = {
  readonly emptyRecycle: () => Promise<boolean>;
  readonly restore: (id: string) => Promise<boolean>;
};

type RecycleBinWorkspaceProps = {
  readonly operations: RecycleBinOperations;
  readonly recycleEntries: readonly RecycleEntryDto[];
};

export function RecycleBinWorkspace({
  operations,
  recycleEntries,
}: RecycleBinWorkspaceProps): React.JSX.Element {
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const restore = async (id: string): Promise<void> => {
    setSubmitting(true);
    await operations.restore(id);
    setSubmitting(false);
  };
  const empty = async (): Promise<void> => {
    setSubmitting(true);
    if (await operations.emptyRecycle()) {
      setConfirmEmpty(false);
    }
    setSubmitting(false);
  };

  return (
    <main className="recycle-bin-workspace" aria-label="回收站">
      <header className="recycle-bin-heading">
        <div>
          <h2>回收站</h2>
          <span className="status-chip">{recycleEntries.length} 个项目</span>
        </div>
      </header>
      {recycleEntries.length === 0 ? (
        <section className="empty-state" aria-label="回收站为空">
          <div className="empty-icon">
            <Archive size={26} />
          </div>
          <h3>回收站为空</h3>
          <p>删除的补丁和组会先移入这里。</p>
        </section>
      ) : (
        <ul className="recycle-list">
          {recycleEntries.map((entry) => (
            <li key={entry.id}>
              <span>
                <strong>{entry.originalRelativePath}</strong>
                <small>{entry.kind === "group" ? "补丁组" : "NPK 补丁"}</small>
              </span>
              <CommandButton disabled={submitting} onClick={() => void restore(entry.id)}>
                恢复
              </CommandButton>
            </li>
          ))}
        </ul>
      )}
      <footer className="recycle-bin-actions">
        {confirmEmpty ? (
          <>
            <span className="dialog-confirm-label">确定清空全部回收项目？</span>
            <CommandButton disabled={submitting} onClick={() => setConfirmEmpty(false)}>
              取消
            </CommandButton>
            <CommandButton
              disabled={submitting}
              loading={submitting}
              onClick={() => void empty()}
              variant="danger"
            >
              确认清空
            </CommandButton>
          </>
        ) : (
          <CommandButton
            disabled={recycleEntries.length === 0}
            onClick={() => setConfirmEmpty(true)}
            variant="danger"
          >
            清空回收站
          </CommandButton>
        )}
      </footer>
    </main>
  );
}

import { Archive, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { RecycleEntryDto } from "../../shared/ipc-contracts";
import type { SelectionModifiers } from "../workspace/useItemSelection";
import { ContextMenu } from "./ContextMenu";
import { CommandButton } from "./primitives";

type RecycleBinOperations = {
  readonly deleteRecycleItems: (entries: readonly RecycleEntryDto[]) => Promise<boolean>;
};

type RecycleBinWorkspaceProps = {
  readonly operations: RecycleBinOperations;
  readonly recycleEntries: readonly RecycleEntryDto[];
};

export function RecycleBinWorkspace({
  operations,
  recycleEntries,
}: RecycleBinWorkspaceProps): React.JSX.Element {
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectionBox, setSelectionBox] = useState<{
    readonly currentX: number;
    readonly currentY: number;
    readonly startX: number;
    readonly startY: number;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    readonly entries: readonly RecycleEntryDto[];
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const entryIds = useMemo(() => recycleEntries.map((entry) => entry.id), [recycleEntries]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => entryIds.includes(id)));
    setAnchorId((current) => (current !== null && entryIds.includes(current) ? current : null));
  }, [entryIds]);

  const selectEntry = (id: string, modifiers: SelectionModifiers): void => {
    if (modifiers.range && anchorId !== null) {
      const anchorIndex = entryIds.indexOf(anchorId);
      const targetIndex = entryIds.indexOf(id);
      if (anchorIndex >= 0 && targetIndex >= 0) {
        const start = Math.min(anchorIndex, targetIndex);
        const end = Math.max(anchorIndex, targetIndex);
        setSelectedIds(entryIds.slice(start, end + 1));
        return;
      }
    }
    if (modifiers.toggle) {
      setSelectedIds((current) =>
        current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id],
      );
      setAnchorId(id);
      return;
    }
    setSelectedIds([id]);
    setAnchorId(id);
  };

  const updateBox = (event: React.PointerEvent<HTMLElement>): void => {
    if (selectionBox === null) return;
    const next = { ...selectionBox, currentX: event.clientX, currentY: event.clientY };
    setSelectionBox(next);
    const paths = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-recycle-id]"))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const left = Math.min(next.startX, next.currentX);
        const right = Math.max(next.startX, next.currentX);
        const top = Math.min(next.startY, next.currentY);
        const bottom = Math.max(next.startY, next.currentY);
        return rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom;
      })
      .flatMap((element) =>
        element.dataset["recycleId"] === undefined ? [] : [element.dataset["recycleId"]],
      );
    const nextIds = entryIds.filter((id) => paths.includes(id));
    setSelectedIds(nextIds);
    // 与 useItemSelection.selectBox 对齐：锚点落在选中范围的最后一项，
    // 否则框选后再 Shift+点击会因 anchorId 为空退化成单选。
    setAnchorId(nextIds.at(-1) ?? null);
  };

  const deleteEntries = async (entries: readonly RecycleEntryDto[]): Promise<void> => {
    setSubmitting(true);
    try {
      await operations.deleteRecycleItems(entries);
    } finally {
      setSubmitting(false);
    }
  };

  const deleteSelected = async (): Promise<void> => {
    await deleteEntries(recycleEntries.filter((entry) => selectedIds.includes(entry.id)));
  };

  const clearAll = async (): Promise<void> => {
    setSelectedIds(recycleEntries.map((entry) => entry.id));
    await deleteEntries(recycleEntries);
  };

  return (
    <main className="recycle-bin-workspace" aria-label="回收站">
      <header className="workspace-heading">
        <div className="workspace-heading-actions">
          <CommandButton
            disabled={submitting || recycleEntries.length === 0}
            icon={<Trash2 size={15} />}
            onClick={() => void clearAll()}
            variant="danger"
          >
            清空回收站
          </CommandButton>
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
        <section
          aria-label="回收站内容"
          className="recycle-bin-list"
          tabIndex={-1}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            if (event.target instanceof Element && event.target.closest("button")) return;
            event.currentTarget.setPointerCapture?.(event.pointerId);
            setSelectionBox({
              currentX: event.clientX,
              currentY: event.clientY,
              startX: event.clientX,
              startY: event.clientY,
            });
            setSelectedIds([]);
            setAnchorId(null);
          }}
          onPointerMove={updateBox}
          onPointerUp={() => setSelectionBox(null)}
          onPointerCancel={() => setSelectionBox(null)}
          onKeyDown={(event) => {
            if (event.key !== "Delete" || submitting || selectedIds.length === 0) return;
            event.preventDefault();
            void deleteSelected();
          }}
        >
          <ul className="recycle-list">
            {recycleEntries.map((entry) => {
              const selected = selectedIds.includes(entry.id);
              return (
                <li
                  className="recycle-row"
                  data-recycle-id={entry.id}
                  data-selected={selected}
                  key={entry.id}
                  onClick={(event) =>
                    selectEntry(entry.id, {
                      range: event.shiftKey,
                      toggle: event.ctrlKey || event.metaKey,
                    })
                  }
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    selectEntry(entry.id, { range: false, toggle: false });
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    if (!selected) selectEntry(entry.id, { range: false, toggle: false });
                    setContextMenu({
                      entries: selected
                        ? recycleEntries.filter((item) => selectedIds.includes(item.id))
                        : [entry],
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                >
                  <span>
                    <strong>{entry.originalRelativePath}</strong>
                    <small>
                      {entry.kind === "group" ? "补丁组" : "补丁"}
                      {entry.size === null ? "" : ` · ${formatRecycleSize(entry.size)}`}
                    </small>
                  </span>
                  <CommandButton
                    disabled={submitting}
                    className="recycle-row-delete"
                    onClick={(event) => {
                      event.stopPropagation();
                      void deleteEntries([entry]);
                    }}
                    variant="ghost"
                  >
                    删除
                  </CommandButton>
                </li>
              );
            })}
          </ul>
          {selectionBox === null ? null : (
            <span
              aria-hidden="true"
              className="recycle-selection-box"
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
          actions={[
            {
              icon: <Trash2 size={16} />,
              kind: "delete" as const,
              label: "删除",
              onClick: () => void deleteEntries(contextMenu.entries),
            },
          ]}
          disabled={submitting}
          onClose={() => setContextMenu(null)}
          x={contextMenu.x}
          y={contextMenu.y}
        />
      )}
    </main>
  );
}

function formatRecycleSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

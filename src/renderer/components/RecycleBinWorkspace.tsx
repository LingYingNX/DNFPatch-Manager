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
    setSelectedIds(entryIds.filter((id) => paths.includes(id)));
    setAnchorId(null);
  };

  const deleteSelected = async (): Promise<void> => {
    setSubmitting(true);
    await operations.deleteRecycleItems(
      recycleEntries.filter((entry) => selectedIds.includes(entry.id)),
    );
    setSubmitting(false);
  };

  return (
    <main className="recycle-bin-workspace" aria-label="回收站">
      <header className="workspace-heading">
        <div className="workspace-heading-actions">
          <CommandButton
            disabled={submitting || recycleEntries.length === 0}
            icon={<Trash2 size={15} />}
            onClick={() => {
              setSelectedIds(recycleEntries.map((entry) => entry.id));
              void operations.deleteRecycleItems(recycleEntries);
            }}
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
        <div
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
          role="application"
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
                    <small>{entry.kind === "group" ? "补丁组" : "NPK 补丁"}</small>
                  </span>
                  <CommandButton
                    disabled={submitting}
                    onClick={(event) => {
                      event.stopPropagation();
                      void operations.deleteRecycleItems([entry]);
                    }}
                    variant="danger"
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
        </div>
      )}
      <ContextMenu
        actions={
          contextMenu === null
            ? []
            : [
                {
                  icon: <Trash2 size={16} />,
                  kind: "delete" as const,
                  label: "删除",
                  onClick: () => void operations.deleteRecycleItems(contextMenu.entries),
                },
              ]
        }
        disabled={submitting}
        onClose={() => setContextMenu(null)}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
      />
    </main>
  );
}

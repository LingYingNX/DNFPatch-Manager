import { type FormEvent, useState } from "react";
import type { RecycleEntryDto } from "../../shared/ipc-contracts";
import type { CategorySnapshot, ChildCategory } from "../../shared/library-dto";
import type { WorkspaceItem } from "../workspace/model";
import { Dialog } from "./Dialog";
import { CommandButton } from "./primitives";
import { RecycleBinDialog } from "./RecycleBinDialog";

export type OperationDialog = "rename" | "move" | "recycle" | "recycle-bin" | null;

type Operations = {
  readonly move: (targetDirectoryRelativePath: string) => Promise<boolean>;
  readonly recycle: () => Promise<boolean>;
  readonly emptyRecycle: () => Promise<boolean>;
  readonly rename: (newName: string) => Promise<boolean>;
  readonly restore: (id: string) => Promise<boolean>;
};

type OperationDialogsProps = {
  readonly active: OperationDialog;
  readonly navigationSnapshot: CategorySnapshot | null;
  readonly onClose: () => void;
  readonly operations: Operations;
  readonly recycleEntries: readonly RecycleEntryDto[];
  readonly selectedItems: readonly WorkspaceItem[];
};

type FormProps = Pick<OperationDialogsProps, "onClose" | "operations" | "selectedItems">;

function categoryOptions(
  categories: readonly ChildCategory[],
  depth = 0,
): readonly { readonly label: string; readonly relativePath: string }[] {
  return categories.flatMap((category) => [
    { label: `${"  ".repeat(depth)}${category.name}`, relativePath: category.relativePath },
    ...categoryOptions(category.childCategories, depth + 1),
  ]);
}

function RenameForm({ onClose, operations, selectedItems }: FormProps): React.JSX.Element {
  const [name, setName] = useState(selectedItems[0]?.name ?? "");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    if (await operations.rename(name.trim())) {
      onClose();
    } else {
      setSubmitting(false);
    }
  };
  return (
    <Dialog onClose={onClose} title="重命名项目">
      <form onSubmit={(event) => void submit(event)}>
        <div className="dialog-body">
          <label className="form-field">
            <span>新名称</span>
            <input
              data-dialog-initial-focus
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
        </div>
        <div className="dialog-actions">
          <CommandButton onClick={onClose}>取消</CommandButton>
          <CommandButton
            disabled={name.trim().length === 0}
            loading={submitting}
            type="submit"
            variant="primary"
          >
            确认重命名
          </CommandButton>
        </div>
      </form>
    </Dialog>
  );
}

function MoveForm({
  navigationSnapshot,
  onClose,
  operations,
}: FormProps & Pick<OperationDialogsProps, "navigationSnapshot">): React.JSX.Element {
  const [target, setTarget] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    if (await operations.move(target)) {
      onClose();
    } else {
      setSubmitting(false);
    }
  };
  return (
    <Dialog onClose={onClose} title="移动项目">
      <form onSubmit={(event) => void submit(event)}>
        <div className="dialog-body">
          <label className="form-field">
            <span>目标位置</span>
            <select
              data-dialog-initial-focus
              value={target}
              onChange={(event) => setTarget(event.currentTarget.value)}
            >
              <option value="">全部补丁</option>
              {categoryOptions(navigationSnapshot?.childCategories ?? []).map((category) => (
                <option key={category.relativePath} value={category.relativePath}>
                  {category.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="dialog-actions">
          <CommandButton onClick={onClose}>取消</CommandButton>
          <CommandButton loading={submitting} type="submit" variant="primary">
            确认移动
          </CommandButton>
        </div>
      </form>
    </Dialog>
  );
}

function RecycleForm({
  onClose,
  selectedItems,
}: Pick<OperationDialogsProps, "onClose" | "selectedItems">): React.JSX.Element | null {
  if (selectedItems.some((item) => item.enabled)) {
    return (
      <Dialog onClose={onClose} title="无法移入回收站">
        <div className="dialog-body">
          <p>补丁已安装，请先关闭再删除。</p>
        </div>
        <div className="dialog-actions">
          <CommandButton data-dialog-initial-focus onClick={onClose}>
            知道了
          </CommandButton>
        </div>
      </Dialog>
    );
  }
  return null;
}

export function OperationDialogs(props: OperationDialogsProps): React.JSX.Element | null {
  switch (props.active) {
    case "rename":
      return <RenameForm {...props} />;
    case "move":
      return <MoveForm {...props} />;
    case "recycle":
      return <RecycleForm onClose={props.onClose} selectedItems={props.selectedItems} />;
    case "recycle-bin":
      return <RecycleBinDialog {...props} />;
    default:
      return null;
  }
}

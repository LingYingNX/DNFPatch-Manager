import { type FormEvent, useState } from "react";
import { Dialog } from "./Dialog";
import { CommandButton } from "./primitives";

export type CategoryDialog = "rename" | "delete" | null;

type CategoryDialogsProps = {
  readonly active: CategoryDialog;
  readonly categoryPath: string;
  readonly deleteCategory: () => Promise<boolean>;
  readonly hasContents: boolean;
  readonly onClose: () => void;
  readonly renameCategory: (name: string) => Promise<boolean>;
};

function categoryName(path: string): string {
  return path.split(/[\\/]/u).at(-1) ?? "";
}

function NameDialog({
  action,
  initialName,
  onClose,
  title,
}: {
  readonly action: (name: string) => Promise<boolean>;
  readonly initialName: string;
  readonly onClose: () => void;
  readonly title: string;
}): React.JSX.Element {
  const [name, setName] = useState(initialName);
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSubmitting(true);
    if (await action(name.trim())) onClose();
    else setSubmitting(false);
  };

  return (
    <Dialog onClose={onClose} title={title}>
      <form onSubmit={(event) => void submit(event)}>
        <div className="dialog-body">
          <label className="form-field">
            <span>分类名称</span>
            <input
              aria-label="分类名称"
              data-dialog-initial-focus
              onChange={(event) => setName(event.currentTarget.value)}
              value={name}
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
            确认
          </CommandButton>
        </div>
      </form>
    </Dialog>
  );
}

function DeleteDialog({
  categoryPath,
  deleteCategory,
  hasContents,
  onClose,
}: Pick<
  CategoryDialogsProps,
  "categoryPath" | "deleteCategory" | "hasContents" | "onClose"
>): React.JSX.Element {
  const [deleting, setDeleting] = useState(false);
  return (
    <Dialog onClose={onClose} title="警告">
      <div className="dialog-body">
        <p>
          {hasContents
            ? "当前目录下还有补丁文件，是否确认删除"
            : `确定删除空分类“${categoryName(categoryPath)}”？`}
        </p>
      </div>
      <div className="dialog-actions">
        <CommandButton onClick={onClose}>取消</CommandButton>
        <CommandButton
          data-dialog-initial-focus
          loading={deleting}
          onClick={() => {
            setDeleting(true);
            void deleteCategory().then((success) => {
              if (success) onClose();
              else setDeleting(false);
            });
          }}
          variant="danger"
        >
          确认删除
        </CommandButton>
      </div>
    </Dialog>
  );
}

export function CategoryDialogs({
  active,
  categoryPath,
  deleteCategory,
  hasContents,
  onClose,
  renameCategory,
}: CategoryDialogsProps): React.JSX.Element | null {
  if (active === "rename") {
    return (
      <NameDialog
        action={renameCategory}
        initialName={categoryName(categoryPath)}
        onClose={onClose}
        title="重命名分类"
      />
    );
  }
  if (active === "delete") {
    return (
      <DeleteDialog
        categoryPath={categoryPath}
        deleteCategory={deleteCategory}
        hasContents={hasContents}
        onClose={onClose}
      />
    );
  }
  return null;
}

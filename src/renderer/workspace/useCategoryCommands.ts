import type { Dispatch, SetStateAction } from "react";
import type { DnfApi, MoveCategoryRequest } from "../../shared/ipc-contracts";
import { isPathWithin } from "../../shared/path-key";
import type { Notice } from "./model";

type CategoryCommandsContext = {
  readonly categoryPath: string;
  readonly client: DnfApi | undefined;
  readonly scan: (relativePath: string) => Promise<boolean>;
  readonly scanNavigation: (relativePath: string) => Promise<boolean>;
  readonly setCategoryPath: Dispatch<SetStateAction<string>>;
  readonly setNotice: Dispatch<SetStateAction<Notice | null>>;
};

function relocatePath(
  relativePath: string,
  sourceRelativePath: string,
  targetRelativePath: string,
): string {
  const source = sourceRelativePath.replaceAll("/", "\\");
  const path = relativePath.replaceAll("/", "\\");
  return path.toLocaleLowerCase() === source.toLocaleLowerCase()
    ? targetRelativePath
    : `${targetRelativePath}${path.slice(source.length)}`;
}

export function useCategoryCommands({
  categoryPath,
  client,
  scan,
  scanNavigation,
  setCategoryPath,
  setNotice,
}: CategoryCommandsContext) {
  const createCategoryAt = async (
    parentRelativePath: string,
    name: string,
  ): Promise<string | null> => {
    if (client === undefined) return null;
    try {
      const result = await client.createCategory({ parentRelativePath, name });
      if (!result.ok) {
        setNotice({ tone: "error", message: result.error.message });
        return null;
      }
      if (!(await scanNavigation(""))) return null;
      return result.value.relativePath;
    } catch {
      setNotice({ tone: "error", message: "创建分类失败，补丁库未被修改。" });
      return null;
    }
  };

  const renameCategoryAt = async (relativePath: string, name: string): Promise<string | null> => {
    if (client === undefined || relativePath === "") return null;
    try {
      const result = await client.renameCategory({ relativePath, name });
      if (!result.ok) {
        setNotice({ tone: "error", message: result.error.message });
        return null;
      }
      if (!(await scanNavigation(""))) return null;
      return result.value.relativePath;
    } catch {
      setNotice({ tone: "error", message: "重命名分类失败，补丁库未被修改。" });
      return null;
    }
  };

  const renameCategory = async (name: string): Promise<boolean> => {
    const renamed = await renameCategoryAt(categoryPath, name);
    if (renamed === null) return false;
    setCategoryPath(renamed);
    return true;
  };

  const deleteCategoryAt = async (relativePath: string): Promise<boolean> => {
    if (client === undefined || relativePath === "") return false;
    try {
      const result = await client.deleteCategory({ relativePath, confirmed: true });
      if (!result.ok) {
        setNotice({ tone: "error", message: result.error.message });
        return false;
      }
      if (isPathWithin(categoryPath, relativePath)) {
        const separatorIndex = Math.max(
          relativePath.lastIndexOf("\\"),
          relativePath.lastIndexOf("/"),
        );
        setCategoryPath(separatorIndex < 0 ? "" : relativePath.slice(0, separatorIndex));
      }
      await scanNavigation("");
      return true;
    } catch {
      setNotice({ tone: "error", message: "删除分类失败，补丁库未被修改。" });
      return false;
    }
  };

  const moveCategory = async (request: MoveCategoryRequest): Promise<boolean> => {
    if (client === undefined || client.moveCategory === undefined) return false;
    try {
      const result = await client.moveCategory(request);
      if (!result.ok) {
        setNotice({ tone: "error", message: result.error.message });
        return false;
      }
      if (categoryPath !== "" && isPathWithin(categoryPath, request.sourceRelativePath)) {
        setCategoryPath(
          relocatePath(categoryPath, request.sourceRelativePath, result.value.relativePath),
        );
      } else if (categoryPath !== "" && !(await scan(categoryPath))) {
        return false;
      }
      if (!(await scanNavigation(""))) return false;
      return true;
    } catch {
      setNotice({ tone: "error", message: "移动分类失败，补丁库未被修改。" });
      return false;
    }
  };

  return {
    createCategoryAt,
    deleteCategoryAt,
    moveCategory,
    renameCategory,
    renameCategoryAt,
  };
}

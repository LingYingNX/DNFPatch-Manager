function extensionOf(path: string): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dot = path.lastIndexOf(".");
  return dot > separator ? path.slice(dot).toLocaleLowerCase() : "";
}

export const LIBRARY_PATCH_EXTENSIONS = new Set([".npk", ".bk2"]);

export function isLibraryPatchPath(path: string): boolean {
  return LIBRARY_PATCH_EXTENSIONS.has(extensionOf(path));
}

export function isVideoPatchPath(path: string): boolean {
  return extensionOf(path) === ".bk2";
}

/** 补丁自身的扩展名（含点，小写）；无法判定时回落 `.npk`。 */
export function libraryPatchExtension(path: string): string {
  const extension = extensionOf(path);
  return LIBRARY_PATCH_EXTENSIONS.has(extension) ? extension : ".npk";
}

export function libraryPatchBaseName(path: string): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dot = path.lastIndexOf(".");
  return dot > separator ? path.slice(separator + 1, dot) : path.slice(separator + 1);
}

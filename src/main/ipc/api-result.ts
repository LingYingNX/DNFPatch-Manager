import type { ApiError, ApiResult } from "../../shared/ipc-contracts";
import type { Result } from "../../shared/result";

const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  INVALID_INPUT: "请求参数无效",
  TARGET_CONFLICT: "目标文件已存在且内容不同",
  TARGET_MODIFIED: "目标文件已被外部修改，操作已停止",
  TARGET_MISSING: "目标文件不存在",
  STATE_CORRUPTED: "应用状态损坏，已停止修改",
  GAME_DIRECTORY_REQUIRED: "请先选择 DNF 游戏目录",
  GAME_DIRECTORY_IN_USE: "请先停用所有补丁，再更换游戏目录",
  GAME_ROOT_MISSING: "请设置到游戏根目录",
  CONFIRMATION_REQUIRED: "此操作需要明确确认",
  RECYCLE_ITEM_NOT_FOUND: "回收项目不存在",
  SOURCE_TYPE_MISMATCH: "源项目类型不符合请求",
  INVALID_GROUP_NAME: "组名无效",
  GROUP_NOT_FOUND: "补丁组不存在或标记无效",
  GROUP_CONTENT_NOT_PATCHES: "补丁组包含无效内容，只允许 NPK、BK2 和支持格式的预览图",
  INVALID_ITEM_NAME: "文件名无效",
  INVALID_TARGET_DIRECTORY: "目标目录无效",
  INVALID_CATEGORY_PATH: "不能修改补丁库根目录",
  CATEGORY_TYPE_MISMATCH: "目标不是有效分类目录",
  CATEGORY_NOT_EMPTY: "分类不为空，无法删除",
  LIBRARY_IO: "补丁库文件操作失败",
  RECYCLE_IO: "回收站文件操作失败",
  INSTALL_IO: "补丁启停操作失败",
  UNSUPPORTED_IMAGE: "不支持此图片格式",
  ASSET_NAME_INVALID: "受管图片名称无效",
  ASSET_URL_INVALID: "受管图片地址无效",
  ASSET_IO: "图片文件操作失败",
  READ_ONLY_RECOVERY: "状态文件损坏，应用已进入只读恢复模式",
  ROLLBACK_FAILED: "文件回滚失败，请按恢复日志手工检查",
  PRESET_NOT_FOUND: "预设不存在",
  PRESET_NAME_CONFLICT: "预设名称已存在",
  PRESET_ITEM_MISSING: "预设引用的补丁不存在",
  PRESET_ITEM_INVALID: "预设引用的文件不是有效 NPK 或 BK2 补丁",
  PRESET_IO: "预设文件操作失败",
  OPEN_EXTERNAL_FAILED: "无法在浏览器中打开链接",
  UPDATE_CHECK_FAILED: "检查更新失败，请检查网络后重试",
  UPDATE_DOWNLOAD_FAILED: "下载更新失败，请稍后重试",
  UPDATE_UNAVAILABLE: "当前运行方式不支持自动更新，请使用安装包运行",
};

export function apiError(code: string, files: readonly string[] = []): ApiError {
  const baseMessage = ERROR_MESSAGES[code] ?? "操作失败";
  return {
    code,
    message: files.length === 0 ? baseMessage : `${baseMessage}：${files.join("；")}`,
    ...(files.length === 0 ? {} : { files: [...files] }),
  };
}

function errorFiles(error: { readonly code: string }): readonly string[] {
  return ["file", "targetPath", "relativePath", "journalPath"].flatMap((key) => {
    const value: unknown = Reflect.get(error, key);
    return typeof value === "string" ? [value] : [];
  });
}

export function toApiResult<T, E extends { readonly code: string }>(
  result: Result<T, E>,
): ApiResult<T> {
  return result.ok
    ? result
    : { ok: false, error: apiError(result.error.code, errorFiles(result.error)) };
}

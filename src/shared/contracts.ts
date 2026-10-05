export const APP_NAME = "DNF 补丁管理器";
export const APP_VERSION = "1.2.9";
export const APP_RELEASE_NOTES = [
  "重构右键菜单样式",
  "修复子文件夹无法单独拖出来，变成新的独立文件夹",
  "优化视觉观感",
] as const;

export type AppInfo = {
  readonly name: typeof APP_NAME;
  readonly version: typeof APP_VERSION;
};

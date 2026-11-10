export const APP_NAME = "DNF 补丁管理器";
export const APP_VERSION = "1.3.1";
export const APP_RELEASE_NOTES = [
  "## 更新日志",
  "",
  "【新增】",
  "- 右键菜单支持设置预览图",
  "- 补丁组双击直接进入组",
  "- Ctrl+A 可全选当前页补丁/组",
  "",
  "【修复】",
  "- 补丁重命名后会从补丁组中被移除",
  "",
  "【优化】",
  "- 卡片信息可透出背景预览图",
  "- 卡片字体统一为思源黑体",
] as const;

export type AppInfo = {
  readonly name: typeof APP_NAME;
  readonly version: typeof APP_VERSION;
};

export const APP_NAME = "DNF 补丁管理器";
export const APP_VERSION = "1.3.0";
export const APP_RELEASE_NOTES = [
  "修复音频补丁安装路径错误",
  "新增 BK2 文件格式，导入即可自动生成静态缩略图和动态演示",
  "各类小元素优化：统一搜索框与控件选中态，收敛圆角、字号、控件尺寸规范，修复 13 处交互缺陷",
] as const;

export type AppInfo = {
  readonly name: typeof APP_NAME;
  readonly version: typeof APP_VERSION;
};

export const APP_NAME = "DNF 补丁管理器";
export const APP_VERSION = "1.3.0";
export const APP_RELEASE_NOTES = [
  "【新增】支持 BK2 视频补丁；安装包自带 BK2 转换器，开箱即用",
  "【新增】回收站补回「恢复」入口（行内按钮 + 右键菜单）",
  "【修复】大索引音效包被误判成贴图、装进 ImagePacks2",
  "【修复】右键菜单叶子项悬停子菜单残留、卡片双击被框选抢走、列表视图 BK2 悬停视频异常放大",
  "【修复】另有 13 处交互缺陷：弹窗重渲染抢焦点、回收站空菜单常驻、清空按钮可重复点击、Shift 范围选择退化、CSP 缺项等",
  "【优化】选中态统一为线框语言；控件尺寸、圆角、字号、字重收敛到设计变量",
  "【优化】卡片标题单行 + 省略号，悬停向左滚动；空分类不再显示计数徽标",
] as const;

export type AppInfo = {
  readonly name: typeof APP_NAME;
  readonly version: typeof APP_VERSION;
};

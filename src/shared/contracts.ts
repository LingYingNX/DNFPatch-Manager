export const APP_NAME = "DNF 补丁管理器";
export const APP_VERSION = "1.3.0";
export const APP_RELEASE_NOTES = [
  "## 更新日志",
  "",
  "【新增】",
  "- 支持 BK2 视频补丁，放入补丁即可自动生成预览图以及视频",
  "- 安装包自带 BK2 转换器，开箱即用",
  "- 回收站补回「恢复」入口（行内按钮 + 右键菜单）",
  "",
  "【修复】",
  "- 大索引音效包被误判成贴图、装进 ImagePacks2",
  "- 右键菜单悬停到叶子项时，已展开的子菜单不收起的残留",
  "- 卡片预览区双击被工作区框选抢走（框选加 3px 死区）",
  "- 列表视图下 BK2 悬停视频被异常放大",
  "- 另有 13 处交互缺陷：弹窗重渲染抢焦点、回收站空菜单常驻、清空按钮可重复点击、Shift 范围选择退化、CSP 缺项等",
  "",
  "【优化】",
  "- 选中态统一为线框语言",
  "- 控件尺寸、圆角、字号、字重收敛到设计变量",
  "- 卡片标题单行 + 省略号，悬停向左滚动",
  "- 空分类不再显示计数徽标",
] as const;

export type AppInfo = {
  readonly name: typeof APP_NAME;
  readonly version: typeof APP_VERSION;
};

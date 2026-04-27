# UXP UI Runtime 强制规则

本项目运行在 Photoshop UXP runtime 中。面板 UI 只能使用经过 UXP 验证的 HTML、CSS、JavaScript 和 Spectrum 组件。所有前端改动都按本文执行。

## 基本原则

- 默认使用 Vue 3 + Vite + TypeScript 输出静态 IIFE bundle。
- 默认使用普通 HTML 容器加 UXP 支持的 CSS 做布局。
- 所有交互控件优先使用 Spectrum UXP Widgets。
- 需要新增 Spectrum Web Components 时，必须使用 Adobe UXP 文档推荐的 SWC wrapper 方案。
- 不直接引入浏览器网页里的通用 UI 组件库。
- 不依赖完整 Chromium、完整 DOM、完整 CSS 或完整 HTML5 表单能力。
- 改 UI 后必须运行 `npm run build:uxp`。
- 改 manifest、权限、entrypoint、SWC 开关后必须运行 `npm run verify:uxp`，并在 UXP Developer Tools 中 `Unload` / `Load`。

## 控件选型规则

| 场景 | 必须使用 | 说明 |
| --- | --- | --- |
| 普通按钮 | `sp-button` 或 `sp-action-button` | 禁止用自绘按钮替代标准操作控件。 |
| 输入框 | `sp-textfield` | 普通 `<input>` 只用于已实机验证的轻量场景。 |
| 多行文本 | `sp-textarea` | 不依赖 `textarea rows/cols`，尺寸走 CSS。 |
| 单选 | `sp-radio` + `sp-radio-group` | 不自建 radio。 |
| 复选 | `sp-checkbox` | 不自建 checkbox。 |
| 下拉选择 | `sp-dropdown` + `sp-menu` + `sp-menu-item` | `sp-dropdown` 必须显式设置宽度。 |
| 数值范围 | `sp-slider` | 需要同步数值时搭配 `sp-textfield`，校验由 JS 处理。 |
| 进度 | `sp-progressbar` | 长任务必须有状态反馈。 |
| 分隔 | `sp-divider` | 不用空白 div 模拟分隔线。 |
| 标题和正文 | `sp-heading`、`sp-body`、`sp-label`、`sp-detail` | 保持 Photoshop/Spectrum 视觉一致。 |
| 图标按钮 | `sp-action-button` + `sp-icon` 或 slot icon | 图标必须有可理解的 label/title。 |
| 对话框 | `<dialog>` + `uxpShowModal()` | 一次性确认、导入、导出使用 dialog。 |

## Spectrum UXP Widgets 规则

Spectrum UXP Widgets 是当前项目的默认控件方案。新增控件时先查官方 UXP Widgets 列表，能覆盖就直接使用。

允许直接使用：

- `sp-action-button`
- `sp-button`
- `sp-checkbox`
- `sp-divider`
- `sp-dropdown`
- `sp-icon`
- `sp-link`
- `sp-menu`
- `sp-menu-item`
- `sp-progressbar`
- `sp-radio`
- `sp-radio-group`
- `sp-slider`
- `sp-textfield`
- `sp-textarea`
- `sp-body`
- `sp-detail`
- `sp-heading`
- `sp-label`

使用要求：

- `sp-dropdown` 必须设置固定或约束宽度，避免按选中项改变面板布局。
- `sp-textfield` 的数值、必填、范围校验全部用 JS 处理。
- 密码输入不要依赖 `sp-textfield type="password"` 的跨平台行为。
- 控件状态使用 `disabled`、`checked`、`selected` 等组件支持的属性。
- 主题适配必须检查 `light`、`lightest`、`dark`、`darkest`。
- 用户可见文案只写操作、状态和结果，不写工程说明。

## SWC Wrapper 规则

只有 Spectrum UXP Widgets 无法覆盖需求时，才引入 Spectrum Web Components。

引入 SWC 必须同时满足：

- 使用 Adobe UXP 文档推荐的 `@swc-uxp-wrappers/*`。
- manifest 开启 `featureFlags.enableSWCSupport: true`。
- 包版本按官方 UXP SWC 文档或官方 sample 锁定。
- bundler alias 按官方 starter 或 wrapper 文档配置。
- 新增组件必须在 Photoshop UXP runtime 实机验证。
- `npm run verify:uxp` 必须增加或保留 SWC 相关静态校验。

禁止：

- 直接升级到最新 `@spectrum-web-components/*` 后上线。
- 混用未验证的 SWC 组件和内置 UXP Widgets 形成关键流程。
- 依赖 SWC 的 RTL、复杂动画或浏览器专属行为。
- 用 `allowCodeGenerationFromStrings` 作为常规解决方案。

## 普通 HTML 使用边界

允许作为结构或轻量展示使用：

- `div`
- `span`
- `section`
- `p`
- `a`
- `img`
- `canvas`
- `dialog`
- `form method="dialog"`
- `template`

谨慎使用，必须实机验证：

- `input`
- `select`
- `option`
- `textarea`
- `ul`
- `ol`
- `li`
- `code`
- `pre`
- `strong`
- `em`

处理要求：

- `ul`、`ol`、`li` 只按普通结构看待，列表样式用 CSS 自己控制。
- `code`、`pre`、`strong`、`em` 的视觉效果用 CSS 明确声明。
- `select` 的每个 `option` 必须写 `value`。
- `form` 只用于 dialog 关闭流程，不做 URL submit。
- `<input type="file">` 禁用，文件选择走 `uxp.storage.localFileSystem.getFileForOpening()`。
- `<input type="color">` 禁用，颜色选择用 Spectrum 控件组合实现。

## 禁用或不可依赖的 HTML 属性

| 属性 | 规则 | 替代 |
| --- | --- | --- |
| `accesskey` | 禁用 | JS 监听键盘事件。 |
| `aria*` | 不依赖 | 可保留语义意图，但不可作为功能前提。 |
| `autocapitalize` | 禁用 | JS 处理输入。 |
| `contenteditable` | 禁用 | 使用 `sp-textarea` 或 `sp-textfield`。 |
| `contextmenu` | 禁用 | 自定义 Spectrum 菜单。 |
| `dir` | 不依赖 | 布局方向用 CSS 和组件实测处理。 |
| `dropzone` | 禁用 | 暂不做拖放核心流程。 |
| `hidden` | 禁用 | 使用 `display: none` 或 `visibility: hidden`。 |
| `inputmode` | 禁用 | 使用具体控件和 JS 校验。 |
| `is` | 禁用 | 不使用 customized built-in elements。 |
| `item*` | 禁用 | 不使用 microdata。 |
| `part` | 禁用 | 不依赖 shadow part styling。 |
| `spellcheck` | 禁用 | 无稳定替代。 |
| `tabindex` | 谨慎 | 只用于必要聚焦，不指定复杂 tab 顺序。 |
| `translate` | 禁用 | 文案由应用自己管理。 |
| `on*` inline handler | 禁用 | Vue 事件或 `addEventListener()`。 |

## CSS 使用边界

允许优先使用：

- `display: flex`
- `flex-direction`
- `flex-wrap`
- `flex`
- `align-items`
- `justify-content`
- `gap`
- `width`
- `height`
- `min-width`
- `max-width`
- `min-height`
- `max-height`
- `padding`
- `margin`
- `border`
- `border-radius`
- `background`
- `background-color`
- `color`
- `font-family`
- `font-size`
- `font-weight`
- `line-height`
- `overflow`
- `position`
- `top`
- `right`
- `bottom`
- `left`
- `opacity`
- `visibility`
- CSS variables
- `calc()`
- `@media (prefers-color-scheme: ...)`

禁止或不依赖：

- CSS animations
- CSS transitions
- `font` shorthand
- `text-transform`
- 复杂 `z-index` 覆盖输入控件
- `window.devicePixelRatio` 精确判断
- `baseline` 对齐作为关键布局依据
- 只在浏览器预览中表现正常的 CSS trick

## WebView 使用边界

WebView 只用于原生 UXP UI 无法稳定实现的复杂界面，例如富文本编辑器、大型组件库、复杂动画或完整浏览器布局需求。

启用 WebView 前必须补充单独设计文档，写清楚：

- WebView 负责的页面范围。
- UXP panel 与 WebView 的通信协议。
- 文件、网络、剪贴板、宿主 Photoshop API 的调用边界。
- 打包方式。
- 安全限制。
- UXP Developer Tools 验证步骤。

## 代码实现要求

- Vue 组件只写 UI、交互状态和用户操作入口。
- Photoshop API、batchPlay、文件系统、网络适配放到 `src/uxp/` 或 composable。
- 组件中不拼复杂 batchPlay descriptor。
- 错误信息面向普通用户，避免出现 descriptor、manifest、bundle、runtime 等工程词。
- 所有长任务都需要 busy 状态和可见进度或状态。
- 面板最小宽度按 `plugin/manifest.json` 的 `minimumSize.width` 验证。

## 验证清单

每次 UI 改动后检查：

- `npm run build:uxp` 通过。
- `npm run verify:uxp` 通过。
- UXP Developer Tools `Reload` 后面板可打开。
- 改 manifest 或 SWC 后执行 `Unload` / `Load`。
- Photoshop 中 `light`、`dark` 主题可读。
- 停靠尺寸和浮动尺寸都不溢出。
- 所有按钮、输入、下拉、滑块可以操作。
- 控件文案没有工程说明。
- console 没有 fatal error。

## 参考来源

- Adobe Premiere Pro UXP User Interfaces: https://developer.adobe.com/premiere-pro/uxp/resources/fundamentals/user-interfaces/
- Adobe UXP HTML Unsupported Attributes: https://developer.adobe.com/premiere-pro/uxp/uxp-api/reference-html/General/Unsupported%20Attributes/
- Adobe UXP HTML Unsupported Elements: https://developer.adobe.com/premiere-pro/uxp/uxp-api/reference-html/General/Unsupported%20Elements/
- Adobe UXP CSS Reference: https://developer.adobe.com/premiere-pro/uxp/uxp-api/reference-css/
- Adobe UXP Spectrum Widgets: https://developer.adobe.com/premiere-pro/uxp/uxp-api/reference-spectrum/Spectrum%20UXP%20Widgets/
- Adobe UXP Spectrum Web Components: https://developer.adobe.com/premiere-pro/uxp/uxp-api/reference-spectrum/swc/
- Adobe UXP Known Issues: https://developer.adobe.com/premiere-pro/uxp/uxp-api/known-issues/
- AdobeDocs Premiere Pro UXP Samples: https://github.com/AdobeDocs/uxp-premiere-pro-samples
- AdobeDocs Photoshop UXP Plugin Samples: https://github.com/AdobeDocs/uxp-photoshop-plugin-samples
- AdobeDocs InDesign UXP Samples: https://github.com/AdobeDocs/uxp-indesign-samples

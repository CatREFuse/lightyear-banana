# Mugen 当前功能规格

版本：1.0
日期：2026-08-11

## 产品标识与线上入口

- 项目技术名统一为 `mugen`，英文品牌名为 `Mugen`，中文产品名为“无幻”。
- Photoshop 插件 ID 为 `com.tanshow.mugen`，独立插件 ID 为 `com.tanshow.mugen.standalone`，工作区 package scope 为 `@mugen/*`。
- 正式站点为 `https://mugen.catrefuse.com/`，公开 WebUI 镜像为 `https://mugen.catrefuse.com/webui/`，发行清单位于 `https://mugen.catrefuse.com/releases/`。
- 当前 CCX 版本为 `1.0.0`，Inner WebUI 版本为 `0.1.0`；Electron 桌面端继续独立版本化。
- 新配置写入 `mugen.settings.v1` 与 `mugen.theme.v1`；读取时兼容旧版 `lightyear-banana.*` key，成功迁移后只写入新 key。
- `mugen.catrefuse.com` 使用独立 Let’s Encrypt 证书；官网从 `/` 提供，公开 WebUI 镜像从 `/webui/` 提供。
- Photoshop 插件从 CCX 内的 `plugin:/webui/index.html` 打开工作台，不依赖公网 WebUI；桥接只允许本地 WebView。
- 旧域名 `webui.catrefuse.com` 只提供到新域名的 HTTPS 308 跳转。
- 官网只提供 `mugen-1.0.0.ccx`，不展示 macOS 或 Windows 桌面端下载。
- 官网静态资源使用相对路径，必须同时支持从域名根路径和本地静态预览加载。

## 本次范围

本规格覆盖 Nothing 视觉主题、Provider 注册架构、预设提示词，以及 Electron 工作台到 Photoshop 内置 WebUI 的迁移。WebUI 直接复用原工作台组件、交互和样式，参考图、模型参数、生成结果与 Photoshop 画布流程保持原有信息架构。

## Photoshop 内置 WebUI

- `apps/inner-webui` 的生产入口直接渲染共享 `src/components/mugen/MugenPanel.vue`，不保留另一套生产 UI。
- WebUI 通过 `inner-host/v1` 调用 UXP Host；模型 API、文件、凭据、画布和历史操作都在 Host 中执行。
- 生产入口只能使用 `WebViewHostClient`；无宿主时显示不可用状态，URL 参数不得启用 Mock Host。
- Mock Host 只允许在单元测试和 Playwright 测试夹具中使用，不得进入生产 bundle。
- CCX 必须包含 WebUI 的 HTML、JavaScript、CSS 和本地字体，资源路径必须相对 `webui/index.html`。
- UXP 宿主根节点必须占满面板可视区，并在面板尺寸变化时把实际像素宽高同步给 WebView；WebUI 不得退化为顶部固定高度区域。
- 主题、模型配置和预设提示词通过 UXP 数据目录保存；API Key 只保存在 UXP SecureStorage。

## Nothing 主题

### 主题和模式

- 界面主题支持 `Nothing` 和 `经典`，默认使用 `Nothing`。
- 明暗模式支持 `跟随系统`、`深色`、`浅色`，首次使用默认深色。
- Electron 主题偏好写入 `localStorage` key `mugen.theme.v1`；Photoshop 内置 WebUI 通过 UXP 设置文件保存主题偏好。
- Nothing 使用本地打包的 Doto、Space Grotesk 和 Space Mono 字体，不依赖远程字体服务。
- 经典主题保留原有字体和主体样式。
- Nothing 与经典主题共用组件尺寸、间距、布局和响应式规则，切换主题不会改变界面几何结构。

### 视觉规则

- 深色使用 OLED 黑背景，浅色使用暖白背景。
- 状态、参数和命令使用等宽字体，主标题和正文使用 Space Grotesk，数字式空状态使用 Doto。
- 控件使用 4px 技术圆角，菜单可使用 8px 圆角。
- 不使用渐变、阴影、发光、动画和过渡。
- 红色只承担错误、删除和少量选中标记。
- Nothing 模式使用 1.5px、无填充的线性图标。
- 最小面板宽度为 260px，不产生水平滚动或内容裁切。
- 运行状态采用括号文本；短时操作结果显示在输入区上方的行内状态条。

### UXP 中转面板

- 使用 Photoshop host token，并提供黑色和暖白 fallback。
- 状态使用 `[CONNECTED]`、`[WAITING]`、`[ERROR]`。
- 保留 Spectrum UXP Widgets 按钮与分隔线。
- 桥接轮询、重连和 Photoshop 命令行为不变。

## Provider 架构

### 分层

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 合同 | `src/providers/contracts.ts` | 请求、结果、适配器、定义和校验类型 |
| 定义 | `src/providers/definitions.ts` | Provider 能力、必填字段、模型差异和默认配置 |
| 注册表 | `src/providers/registry.ts` | 静态注册、查找、派发前校验和 generate/test 入口 |
| Wire 兼容层 | `src/providers/legacyRuntime.ts` | 已验证的请求构造、轮询、响应解析和错误映射 |
| 兼容 facade | `src/data/providerCapabilities.ts`、`src/services/imageApiClient.ts` | 保持旧 import 和公开导出稳定 |

### 注册和校验

- 11 个 Provider ID 必须同时出现在能力定义和静态注册表中。
- 未注册 Provider、Provider 不匹配、缺少模型、缺少必填 API Key 或 Base URL 时，不进入 wire 层。
- `supportsBaseUrl` 只表示配置界面允许编辑地址；`requiresBaseUrl` 单独决定地址是否必填。
- iMini、ComfyUI 和 Codex Image Server 可以使用 wire 层默认地址；自定义 OpenAI 配置必须填写 Base URL。
- 配置存储结构、Provider ID 和旧公开函数保持兼容。

## 预设提示词

### 管理

- 设置页提供预设提示词列表和新增、编辑、删除入口。
- 最多保存 100 条。
- 名称长度为 1–24 个 Unicode 字符，只支持中文、英文字母、数字、`_`、`-`。
- 名称使用 NFKC 和 ASCII 小写规则检查冲突。
- 提示词内容不能为空，可以包含多行和任意正文。
- Electron 中预设与模型配置写入 `localStorage` key `mugen.settings.v1`；Photoshop 内置 WebUI 通过 UXP 设置文件保存相同数据。

### 调用

- 在提示词框输入 `/` 或 `/名称片段` 打开过滤菜单，最多显示 6 条。
- `ArrowUp`、`ArrowDown` 移动选择，`Enter` 展开预设，`Escape` 关闭菜单。
- 点击菜单外区域关闭菜单；键盘操作只在提示词输入框聚焦时生效。
- 发送精确命令 `/名称` 时直接解析为预设正文。
- 输入 `//正文` 时发送字面量 `/正文`。
- 输入未知的精确命令时保留当前输入和参考图，并显示 `未找到预设“名称”`。
- 输入 `/名称 其他内容` 时按普通正文发送。
- 预设正文即使等于另一个斜杠命令，也只展开一次。

## 验收

- `npm run test:diagnostics`
- `npm run test:prompt-presets`
- `npm run test:regressions`
- `node scripts/custom-gemini-provider-smoke.mjs`
- `node scripts/imini-provider-smoke.mjs`
- `npm run build:web`
- `npm run verify:uxp`
- `npm run smoke:apimart-server`
- 浏览器检查 390px 深色、390px 浅色、主题菜单、预设管理、斜杠菜单和 260px 窄面板。
- Photoshop 中执行 UXP Developer Tools Reload 后检查中转面板的实际字体、明暗模式、连接状态和重连按钮。
- 安装最终 CCX 后，在 Photoshop 中选择图层，通过插件创建 APIMart 配置并填写本地 Base URL 与测试 Key，抓取图层作为参考图，生成猫图并将结果置入当前文档。
- `/__smoke/state` 必须显示上传、生成和任务查询均被调用，Photoshop 文档必须出现新生成结果图层。

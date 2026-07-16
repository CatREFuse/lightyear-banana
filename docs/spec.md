# Lightyear Banana 当前功能规格

版本：0.2
日期：2026-07-17

## 本次范围

本规格覆盖三项已实现能力：Nothing 视觉主题、Provider 注册架构、预设提示词。现有工作台、参考图、模型参数、生成结果和 Photoshop 画布流程保持原有信息架构。

## Nothing 主题

### 主题和模式

- 界面主题支持 `Nothing` 和 `经典`，默认使用 `Nothing`。
- 明暗模式支持 `跟随系统`、`深色`、`浅色`，首次使用默认深色。
- 主题偏好写入 `localStorage` key `lightyear-banana.theme.v1`。
- Nothing 使用本地打包的 Doto、Space Grotesk 和 Space Mono 字体，不依赖远程字体服务。
- 经典主题保留原有字体和主体样式。

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
- 预设与模型配置一起写入 `localStorage` key `lightyear-banana.settings.v1`。

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
- 浏览器检查 390px 深色、390px 浅色、主题菜单、预设管理、斜杠菜单和 260px 窄面板。
- Photoshop 中执行 UXP Developer Tools Reload 后检查中转面板的实际字体、明暗模式、连接状态和重连按钮。

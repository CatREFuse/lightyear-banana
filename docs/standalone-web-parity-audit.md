# Lightyear Banana Standalone 与 Web 技术原型对齐审计

日期：2026-04-28

## 检查范围

本次检查对比两套实现：

- Web/Vue 技术原型：`src/components/lightyear/`、`src/composables/useLightyearBanana.ts`、`src/services/imageApiClient.ts`、`src/data/providerCapabilities.ts`、`plugin/manifest.json`
- 当前 UXP 独立插件：`standalone-uxp-plugin/index.html`、`standalone-uxp-plugin/main.js`、`standalone-uxp-plugin/manifest.json`

同时核对项目约束：

- `ref/project-baseline.md`
- `ref/framework-build.md`
- `ref/uxp-ui-runtime-rules.md`
- `ref/atomic-capabilities.md`
- `ref/canvas-primitives.md`
- `ref/development-notes.md`

## 总体判断

当前 UXP 独立插件已经验证了 Photoshop 面板加载、参考图抓取、Mock 生成、结果置入、结果转参考、超分参数回填等基础闭环。它更像一个 UXP 可加载的最小插件。

Web/Vue 技术原型承载的是完整产品形态：供应商配置、模型能力约束、真实 API 适配、会话流、多结果卡片、按结果选择置入目标、设置页、Mock Server、配置持久化。

两者当前不是同一套产品实现。差异已经超过 UI 细节，影响功能需求、交互路径、数据结构和后续维护。

## 高优先级差异

| 编号 | 模块 | Web 技术原型 | 当前 UXP 独立插件 | 影响 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| A1 | 模型与供应商 | 使用 `providerCapabilities` 管理 OpenAI、Gemini、Seedream、Qwen、Kling、Flux、自定义 OpenAI 兼容能力 | 只有 `mock-image` 和 `copy-reference` | 无法验证真实生图产品链路 | P0 |
| A2 | API 调用 | `generateImagesWithProvider()` 已按供应商构造请求，并处理返回图片 | 不调用任何真实 API | 插件无法完成真实生成 | P0 |
| A3 | 配置管理 | 有配置列表、详情、启停、API Key、Base URL、测试 API、Mock Server、localStorage | 无设置页、无持久化、无 API Key | 用户无法配置模型 | P0 |
| A4 | 生成数量 | 原型按 `count` 请求并渲染多张结果 | 独立插件只生成 1 张，`quantity` 只写入历史 | “数量”控件实际无效 | P1 |
| A5 | 会话结果 | 原型用 `ChatTurn` 保存每轮 prompt、参考图、耗时、多结果 | 独立插件只有一个全局 `state.result` 和简单历史文本 | 不能回到任意结果继续操作 | P1 |
| A6 | 置入目标 | 原型在每张结果上打开置入菜单，支持参考图选区、全画布、当前选区 | 独立插件用全局目标下拉，参考图生成后被清空，只能用最后参考或结果边界 | 多参考图场景无法准确置入 | P1 |
| A7 | 参考图上限 | 原型按当前供应商动态读取 `referenceLimit` | 独立插件固定 `MAX_REFERENCES = 4` | 与模型能力不一致 | P1 |
| A8 | 浏览器预览 | 原型支持 browser runtime fallback | 独立插件只面向 UXP runtime | 无法复用 Web 原型的快速预览流 | P2 |
| A9 | 构建体系 | 原型由 Vue + Vite + TypeScript + verify 脚本统一管理 | 独立插件是单独手写 HTML/JS/CSS，未纳入根 `package.json` | 双实现继续漂移 | P1 |

## 功能对齐明细

### 参考图

Web 原型：

- `visible`、`selection`、`layer` 在 UXP 中走 `canvasPrimitiveService`
- 浏览器预览下走 Mock 图像
- `upload`、`clipboard` 当前也是 Mock
- 上限来自当前模型能力
- 每张参考图保留 `sourceBounds`

当前 UXP 独立插件：

- `visible`、`selection`、`layer` 直接调用 `imaging.getPixels()` / `imaging.getSelection()`
- `upload`、`clipboard` 是 Mock
- 固定 4 张
- 只保留最后一张为 `state.reference`
- 图像边界字段叫 `bounds`

差异结论：

- Photoshop 抓图能力基本对齐。
- 动态参考图上限未对齐。
- 多参考图的后续定位能力未对齐。
- `sourceBounds` / `bounds` 数据结构未对齐，后续共享逻辑会出问题。

### 生成

Web 原型：

- 校验 prompt 或参考图
- 校验 API Key
- 校验 Base URL
- 支持 Mock Server
- 调用真实 provider adapter
- 支持多结果
- 生成期间展示发送内容、参考图和耗时
- API 未返回图片会抛出明确错误

当前 UXP 独立插件：

- 校验 prompt 或参考图
- 使用本地 SVG Mock 生成
- `copy-reference` 复制最后一张参考图
- `quantity` 不改变实际结果数量
- 无 API Key、Base URL、Mock Server、provider adapter

差异结论：

- 当前独立插件只能作为 UXP 交互验证，不能作为真实生成插件。
- “模型、尺寸、质量、数量、比例”控件看起来完整，但只有尺寸、比例、质量影响 Mock 图像，数量未真正生效。

### 结果与会话

Web 原型：

- 每轮生成形成 `ChatTurn`
- 每个 `ChatTurn` 保留 sent references
- 每张结果都有 `置入`、`超分`、`参考`
- `置入` 是结果级菜单
- 自动滚动到最新轮次

当前 UXP 独立插件：

- 只有一个当前结果
- 历史只显示最近 5 条文本
- 不能对历史结果执行置入、超分、参考
- `参考`、`超分` 只作用于当前结果

差异结论：

- 独立插件没有实现 Web 原型的消息流体验。
- 用户生成多次后，只能操作最新结果。

### 置入 Photoshop

Web 原型：

- `reference-selection` 使用发送时选区参考图的 bounds
- `current-selection` 读取当前 Photoshop 选区
- `full-canvas` 读取文档尺寸
- 写入走 `canvasPrimitiveService`

当前 UXP 独立插件：

- `full-canvas`、`current-selection` 已实现
- `reference-bounds` 读取 `state.reference || state.result`
- 生成完成后会清空 references，导致 `reference-bounds` 通常落到 result bounds
- 写入走 `core.executeAsModal()` 和 `imaging.putPixels()`

差异结论：

- Photoshop 写入原子能力是可用的。
- “参考图位置”没有按 Web 原型的每张选区参考图语义实现。

## 交互差异

| 交互 | Web 技术原型 | 当前 UXP 独立插件 | 风险 |
| --- | --- | --- | --- |
| 主界面 | 顶部状态、消息流、底部输入区 | 分区式表单 | 产品体验明显不一致 |
| 设置入口 | 顶部设置按钮，进入配置路由 | 无设置入口 | 真实模型不可配置 |
| 主题 | 有主题切换 | 无主题切换 | 与原型视觉不一致 |
| 发送 | 空输入禁用发送按钮 | 生成按钮只在 busy 时禁用，点击后提示 | 行为不一致 |
| 添加参考 | 下拉菜单，显示动态上限 | 一排行动按钮，固定上限 | 信息架构不一致 |
| 置入 | 每张结果有置入菜单 | 全局目标下拉 + 全局置入按钮 | 多结果场景不可用 |
| 反馈 | toast + status + loading turn | status line + generationStatus | 反馈层级不一致 |

## UXP 兼容性和规则差异

### 控件规则

`ref/uxp-ui-runtime-rules.md` 要求所有交互控件优先使用 Spectrum UXP Widgets，新增 SWC 时必须走 `@swc-uxp-wrappers/*` 并开启 `enableSWCSupport`。

当前独立插件基本符合这条方向：

- 按钮使用 `sp-button` / `sp-action-button`
- 多行输入使用 `sp-textarea`
- 选择控件使用 `sp-picker` + `sp-menu` + `sp-menu-item`
- 标题和正文使用 `sp-heading`、`sp-body`、`sp-detail`

Web/Vue 技术原型当前仍大量使用普通 `<button>`、`<input>`、`<textarea>` 和自建菜单。它适合浏览器原型验证，但如果直接作为 UXP 最终面板，需要替换成 Spectrum UXP Widgets 或 SWC wrapper。

### 文档与实现存在一个规则冲突

`ref/uxp-ui-runtime-rules.md` 当前写的是下拉选择必须使用 `sp-dropdown`，但独立插件的 `verify.mjs` 明确禁止 `sp-dropdown`，要求使用 `sp-picker`。

这个规则需要统一。建议以实机验证结果为准，把项目规则更新为：

- 下拉选择使用 `sp-picker` + `sp-menu` + `sp-menu-item`
- 如果后续确认 `sp-dropdown` 在目标 UXP runtime 稳定，再调整 verify 和文档

### CSS 风险

`ref/uxp-ui-runtime-rules.md` 标记 CSS animations 和 transitions 为禁止或不依赖。Web/Vue 技术原型里大量使用 `Transition`、CSS transition、animation。当前构建能通过静态校验，但这不等同于 Photoshop UXP 里所有动画稳定。

建议最终 UXP 面板：

- 保留必要的状态切换
- 去掉关键路径上的动画依赖
- 所有控件尺寸用稳定宽高和约束
- 在 Photoshop 浮动面板、停靠面板、light/dark 主题下回归

### 网络与权限

Web 原型的 `plugin/manifest.json` 已配置网络域名：

- 本地 Mock Server
- OpenAI
- Gemini
- DashScope
- BytePlus Ark

独立插件的 manifest 没有 `requiredPermissions.network`。如果在独立插件里补真实 API，必须先补 manifest 权限，然后执行 UDT `Unload` / `Load`。

### 文件与剪贴板

Web 原型和独立插件的 `upload`、`clipboard` 当前都是 Mock。后续真实实现必须遵守 UXP 文件访问边界：

- 文件选择走 `uxp.storage.localFileSystem.getFileForOpening()`
- 不使用 `<input type="file">`
- 剪贴板能力必须实机验证，不能默认使用浏览器 Clipboard API

## 架构差异

### 当前有两套业务逻辑

Web 原型的核心在：

- `useLightyearBanana.ts`
- `providerCapabilities.ts`
- `imageApiClient.ts`
- `canvasPrimitiveService.ts`

独立插件的核心在：

- `standalone-uxp-plugin/main.js`

两边重复实现了：

- 图像捕获
- 选区读取
- RGBA 转换
- 结果置入
- 参考图管理
- 生成状态
- 超分回填

这会持续制造漂移。当前已经出现数据字段、能力上限、生成数量、置入语义不一致。

### 推荐收敛方向

建议把 Web/Vue 技术原型作为产品源头，把当前独立插件作为 UXP API 验证样本。后续分三步收敛：

1. 抽出共享核心

   - `providerCapabilities`
   - `imageApiClient`
   - `CapturedCanvasImage` / `GeneratedImage` 类型
   - Photoshop canvas primitives
   - 生成、置入、参考图的服务层

2. 改造 UXP 面板 UI

   - 保留 Web 原型的信息架构
   - 控件替换为 Spectrum UXP Widgets
   - 下拉统一为 `sp-picker`
   - 不引入未验证的浏览器 UI 组件库

3. 废弃或冻结独立插件

   - 独立插件只保留为低层 Photoshop API smoke sample
   - 产品功能只在 Vue/UXP 主实现中继续开发

## 回归结果

本次检查期间执行：

```bash
PATH="/opt/homebrew/bin:$PATH" npm run verify:uxp
PATH="/opt/homebrew/bin:$PATH" node standalone-uxp-plugin/verify.mjs
PATH="/opt/homebrew/bin:$PATH" node standalone-uxp-plugin/smoke-test.mjs
```

结果：

- 主 Vue UXP 构建通过，输出 `dist/ps-uxp`
- 独立插件静态校验通过
- 独立插件 smoke test 通过
- npm 有非阻塞警告：`Unknown user config "home"`、`Unknown env config "home"`

## 后续修复清单

| 优先级 | 工作 | 验收标准 |
| --- | --- | --- |
| P0 | 决定最终产品源头为 Vue/UXP 主实现 | 独立插件不再承载新增产品功能 |
| P0 | 把模型配置、API Key、Base URL、Mock Server 接入 UXP 可用 UI | Photoshop 面板内可新建、启停、测试配置 |
| P0 | 接入真实 provider adapter | 至少一个 Mock Server 和一个真实 provider 端到端生成成功 |
| P1 | 修复数量控件 | 选择 2/4 时实际生成 2/4 张结果 |
| P1 | 恢复消息流和结果卡片 | 每轮结果可单独置入、参考、超分 |
| P1 | 修复参考图选区置入 | 每张选区参考图都能作为置入目标 |
| P1 | 统一图像数据结构 | 全项目使用 `sourceBounds`，或提供明确 adapter |
| P1 | 统一 `sp-picker` / `sp-dropdown` 规则 | 文档、verify、实现一致 |
| P2 | 替换 Web 原型中的普通交互控件 | 最终 UXP 面板关键控件全部使用 Spectrum UXP Widgets 或 SWC wrapper |
| P2 | 减少关键路径 CSS 动画依赖 | 停靠、浮动、light/dark 主题实机无布局错位 |


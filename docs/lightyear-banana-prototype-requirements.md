# Lightyear Banana 技术原型功能需求

版本：0.1  
日期：2026-04-28  
范围：当前技术原型已标定和已暴露的功能

## 产品定位

Lightyear Banana 是面向 Photoshop 的 UXP 生图插件原型。它把 Photoshop 当前画布、选区、图层和外部生图模型连接起来，让用户可以从画布取参考图，调用图像生成 API，再把生成结果置入 Photoshop 文档。

当前原型同时承担两类任务：验证 Photoshop UXP 画布交互能力，验证多模型生图工作台的核心交互闭环。

## 用户和场景

主要用户是熟悉 Photoshop 的设计师、插画师、视觉运营和 AI 图像工作流使用者。

核心场景：

- 从当前 Photoshop 文档取可见图层、选区或选中图层作为参考图。
- 输入提示词并选择模型、尺寸、质量、数量、比例。
- 发送生成请求，等待模型返回图片。
- 查看生成历史，把结果作为新参考图、超分输入或置入 Photoshop。
- 配置不同模型供应商的 API Key、模型和 Base URL。
- 用 Mock Server 验证成功、错误、限流、超时等路径。

## 当前功能总览

| 功能域 | 当前状态 | 主要入口 |
| --- | --- | --- |
| UXP 插件入口 | 已实现 | `plugin/manifest.json`、`src/uxp/main.ts` |
| Vue 面板挂载 | 已实现 | `src/uxp/main.ts`、`src/App.vue` |
| Photoshop 创建图层命令 | 已实现 | `createLayer` command |
| 主工作台 | 已实现 | `LightyearPanel.vue`、`ComposerDock.vue`、`MessageThread.vue` |
| 参考图采集 | 部分实现 | `useLightyearBanana.ts`、`canvasPrimitiveService.ts` |
| 生图请求 | 已实现原型 | `imageApiClient.ts` |
| 结果展示 | 已实现 | `MessageThread.vue` |
| 结果置入 Photoshop | 已实现原型 | `canvasPrimitives.ts` |
| 结果作为参考图 | 已实现 | `useResultAsReference()` |
| 超分参数填充 | 已实现 | `upscaleImage()` |
| 模型配置管理 | 已实现原型 | `SettingsPanel.vue`、`ConfigEditorForm.vue` |
| Mock Server | 已实现 | `scripts/mock-image-api-server.mjs` |
| 浏览器预览 | 已实现 | `vite.uxp.config.ts` 生成 `browser-preview.html` |
| UXP 构建校验 | 已实现 | `scripts/verify-uxp-build.mjs` |

## 已标定功能需求

### FR-001 UXP 插件加载与入口

用户可以把插件加载到 Photoshop UXP Developer Tools，并打开 Lightyear Banana 面板。

验收标准：

- manifest 使用 v5。
- host 为 Photoshop。
- main 指向 `uxp-panel.html`。
- 插件包含 `panel` entrypoint。
- 插件包含 `createLayer` command。
- `npm run verify:uxp` 能生成并校验 `dist/ps-uxp`。
- 产物 HTML 使用 classic script，不保留 `type="module"`。

来源：

- `plugin/manifest.json`
- `vite.uxp.config.ts`
- `scripts/verify-uxp-build.mjs`

### FR-002 Photoshop 创建图层命令

用户可以从 Photoshop 菜单执行创建图层命令，在当前文档中新建名为 `Lightyear Banana` 的图层。

验收标准：

- command id 为 `createLayer`。
- 执行时调用 Photoshop API。
- 修改文档状态的操作进入 `core.executeAsModal()`。
- 没有 UXP runtime 时返回明确错误。

来源：

- `src/uxp/main.ts`
- `src/uxp/photoshopHost.ts`

### FR-003 面板启动与运行时识别

面板可以在 Photoshop UXP runtime 中挂载 Vue 应用，也可以在浏览器预览中进入 fallback 状态。

验收标准：

- UXP 中通过 `require("uxp").entrypoints.setup()` 注册面板。
- 面板 `create` 和 `show` 均可触发挂载。
- 浏览器预览时传入 `runtime: "browser"`。
- Photoshop UXP 中传入 `runtime: "photoshop-uxp"`。
- 启动失败时显示可读错误。

来源：

- `src/uxp/main.ts`
- `src/App.vue`

### FR-004 主工作台导航

用户可以在工作台和设置页之间切换，并查看顶部状态。

验收标准：

- 顶部显示当前标题和状态。
- 工作台标题为 `Lightyear Banana v0.1`。
- 设置页显示 `设置`、`新建配置` 或当前配置名称。
- 用户可以打开设置。
- 用户可以从配置详情返回配置列表，也可以返回工作台。
- 用户可以切换浅色和深色主题。

来源：

- `LightyearPanel.vue`
- `PanelHeader.vue`

### FR-005 添加参考图

用户可以从多个来源添加参考图，参考图数量受当前模型能力限制。

参考图来源：

| 来源 | 当前状态 | 说明 |
| --- | --- | --- |
| 可见图层 | 已接 Photoshop | 抓取当前文档可见合成图 |
| 选区 | 已接 Photoshop | 抓取当前选区合成图和选区 bounds |
| 当前选中图层 | 已接 Photoshop | 抓取当前 active layer 像素 |
| 上传文件 | 占位 | 当前使用 mock 图像 |
| 剪贴板 | 占位 | 当前使用 mock 图像 |
| 生成结果 | 已实现 | 用户可把生成结果加入参考图 |

验收标准：

- 面板显示 `参考图 当前数量 / 当前模型上限`。
- 达到上限后不能继续添加。
- 可见图层、选区、选中图层在 Photoshop UXP 中调用 `canvasPrimitiveService`。
- 浏览器预览中使用 mock 图像。
- 用户可以删除单张参考图。
- 用户可以清空全部参考图。
- 没有有效选区时显示可读错误。
- 没有选中图层时显示可读错误。

来源：

- `ComposerDock.vue`
- `ReferenceThumb.vue`
- `useLightyearBanana.ts`
- `canvasPrimitiveService.ts`
- `canvasPrimitives.ts`

### FR-006 提示词输入与发送

用户可以输入提示词，按发送按钮或 Enter 发起生成。

验收标准：

- 提示词和参考图至少存在一项时允许发送。
- 没有提示词但有参考图时，使用默认提示词 `根据参考图生成`。
- Enter 发送。
- Shift + Enter 换行。
- 输入法组合状态不触发发送。
- 生成中禁用发送。
- 发送前校验 API Key。
- 自定义 Base URL 配置在真实 API 模式下必须填写 Base URL。
- 发送后清空输入框和当前参考图。

来源：

- `ComposerDock.vue`
- `useLightyearBanana.ts`

### FR-007 生图参数选择

用户可以选择模型配置、尺寸、质量、数量和比例。

验收标准：

- 模型配置列表只显示启用配置。
- 切换模型配置时，同步更新尺寸、质量、数量、比例的可用选项。
- 选项来自当前 provider 的能力声明。
- 比例支持 `原图比例`、`1:1`、`4:3`、`3:4`、`16:9`、`9:16`。
- 数量受 provider 能力限制。
- 尺寸和质量受 provider 能力限制。

来源：

- `ComposerDock.vue`
- `ControlSelect.vue`
- `RatioPicker.vue`
- `providerCapabilities.ts`
- `useLightyearBanana.ts`

### FR-008 多供应商图像生成

系统可以根据当前配置调用对应供应商的生图 API，并统一读取返回图片。

支持供应商：

| Provider | 默认模型 | 当前接入方式 |
| --- | --- | --- |
| OpenAI | `gpt-image-2` | `/v1/images/generations`、`/v1/images/edits` |
| Google Gemini | `gemini-3-pro-image-preview` | `models/{model}:generateContent` |
| ByteDance Seedream | `seedream-4-0-250828` | `/api/v3/images/generations` |
| Alibaba Qwen | `qwen-image-2.0-pro` | DashScope multimodal generation |
| Kuaishou Kling | `kling/kling-v3-omni-image-generation` | DashScope task create + task result |
| OpenAI compatible | `custom-image-model` | 自定义 Base URL + OpenAI 风格接口 |

验收标准：

- 每个 provider 有独立请求构造函数。
- OpenAI 风格接口读取 `data[].url` 或 `data[].b64_json`。
- Gemini 读取 `candidates[].content.parts[].inlineData`。
- Qwen 读取 `output.choices[].message.content[].image`。
- Kling 创建任务后读取 `task_id`，再请求任务结果。
- API 无图片返回时显示 `API 未返回图片`。
- 网络失败时显示 `无法连接 API`。

来源：

- `providerCapabilities.ts`
- `imageApiClient.ts`
- `image-model-api-specs.md`

### FR-009 生成过程反馈

用户发送请求后可以看到生成中的状态和耗时。

验收标准：

- 生成开始时展示用户提示词和已发送参考图。
- 生成中展示 `正在生成中... Ns`。
- 每 250ms 更新内部计时，展示秒级耗时。
- 请求完成后停止 loading。
- 请求失败后停止 loading 并显示错误状态。

来源：

- `useLightyearBanana.ts`
- `MessageThread.vue`

### FR-010 生成结果展示

用户可以在对话流中查看每轮生成结果。

验收标准：

- 每轮结果包含提示词、参考图、耗时、模型生成文案和图片列表。
- 图片以卡片方式展示。
- 每张结果图提供 `置入`、`超分`、`参考` 三个操作。
- 新结果出现后对话区滚动到底部。
- 空状态显示 `暂无生成结果`。

来源：

- `MessageThread.vue`
- `useLightyearBanana.ts`

### FR-011 结果置入 Photoshop

用户可以把生成结果写入 Photoshop 文档。

置入目标：

- 全画布。
- 当前选区。
- 本轮参考图中的选区位置。

验收标准：

- 浏览器预览中不执行 Photoshop 写入，并提示无法置入。
- 全画布置入读取当前文档尺寸。
- 当前选区置入读取当前 Photoshop 选区 bounds。
- 参考图选区置入使用该参考图的 `sourceBounds`。
- 写入前把结果图 RGBA 缩放到目标尺寸。
- 写入 Photoshop 时创建新像素图层。
- 写入调用 `imaging.putPixels()`。
- 写入完成后更新状态。

来源：

- `MessageThread.vue`
- `useLightyearBanana.ts`
- `canvasPrimitiveService.ts`
- `canvasPrimitives.ts`
- `imagePixels.ts`

### FR-012 结果作为参考图

用户可以把任一生成结果加入参考图列表，用于下一轮生成。

验收标准：

- 点击 `参考` 后新增来源为 `generated` 的参考图。
- 新参考图使用生成结果的预览、像素、尺寸和 bounds。
- 仍受当前模型参考图上限约束。
- 添加成功后更新状态。

来源：

- `MessageThread.vue`
- `useLightyearBanana.ts`

### FR-013 超分参数填充

用户可以对任一生成结果点击 `超分`，快速填充下一轮请求参数。

验收标准：

- 当前模型切换为结果所属模型配置。
- 参考图替换为当前结果图。
- 提示词填入 `提升分辨率`。
- 数量设置为 1。
- 尺寸选择当前模型支持的高分辨率选项。
- 质量选择当前模型支持的最高质量选项。
- 比例优先使用 `原图比例`。
- 状态提示该图片已填入超分参数。

来源：

- `MessageThread.vue`
- `useLightyearBanana.ts`

### FR-014 模型配置列表

用户可以在设置页查看所有模型配置和可用状态。

验收标准：

- 配置列表展示配置名称、provider 名称、模型 ID。
- 配置状态显示 `启用`、`未启用` 或 `API 不可用`。
- 没有 API Key 的启用配置在真实 API 模式下显示不可用。
- 自定义 Base URL 配置缺少 Base URL 时显示不可用。
- 用户可以进入任一配置详情。
- 用户可以新建配置。

来源：

- `SettingsPanel.vue`
- `providerCapabilities.ts`

### FR-015 模型配置编辑

用户可以创建、编辑、保存、删除模型配置。

字段：

- 配置名称。
- 启用状态。
- 供应商。
- 模型。
- Base URL。
- API Key。

验收标准：

- 新建配置默认使用 OpenAI compatible。
- provider 改变时更新默认模型。
- 不支持 Base URL 的 provider 禁用 Base URL 输入。
- 支持 Base URL 的 provider 允许自定义模型名和 Base URL。
- 保存后配置可在输入区选择。
- 删除配置后回到配置列表。
- 至少保留一个配置。
- 新建配置未保存时点击删除执行取消。

来源：

- `ConfigEditorForm.vue`
- `useLightyearBanana.ts`

### FR-016 API 配置测试

用户可以在配置详情中测试 API 配置。

验收标准：

- 缺少 API Key 时返回缺少 Key 状态。
- 支持 Base URL 的配置缺少 Base URL 时返回缺少 Base URL 状态。
- Mock Server 开启时发起真实 mock 请求。
- Mock Server 关闭时当前原型用短等待和 key 文本规则模拟测试结果。
- 测试中按钮显示 `测试中`。
- 成功显示 `API 可用`。
- 失败显示 `API 不可用` 或具体错误。

来源：

- `ConfigEditorForm.vue`
- `useLightyearBanana.ts`
- `imageApiClient.ts`

### FR-017 设置持久化

用户配置需要保存在本地，下次打开面板恢复。

持久化内容：

- 当前激活配置 ID。
- 模型配置数组。
- Mock Server 开关。
- Mock Server Base URL。

验收标准：

- 使用 `localStorage` key `lightyear-banana.settings.v1`。
- 读取失败时回退默认配置。
- 写入失败时不阻断主流程。
- 默认配置升级时合并本地已存配置。
- 自定义配置保留。

来源：

- `useLightyearBanana.ts`

### FR-018 Mock Server 开关

用户可以在设置页打开 Mock Server，用本地服务验证接口和错误路径。

验收标准：

- Mock Server 默认关闭。
- 开启后所有 provider 请求发往本地 Base URL。
- 本地地址可编辑。
- 设置页展示可用 mock key。
- 没有填 mock key 时自动使用 `mock-good`。
- 关闭后请求真实 provider。

来源：

- `SettingsPanel.vue`
- `useLightyearBanana.ts`
- `imageApiClient.ts`
- `mock-image-api-server.mjs`

### FR-019 Mock Server API

开发者可以启动本地 Mock Server，获得稳定的成功和失败响应。

验收标准：

- 默认监听 `127.0.0.1:38321`。
- 支持通过环境变量修改端口和延迟范围。
- 支持 `/mock/manual` 查看能力。
- 支持 `/mock-images/cats/*.jpg` 返回 fixture。
- 支持 OpenAI、Gemini、Qwen、Kling、Seedream、OpenAI compatible 的 mock endpoint。
- 支持 `mock-good` 和 provider 专属 good key。
- 支持 invalid、expired、permission、rate、quota、server、timeout 错误。
- Kling 创建任务后可以通过 task id 获取同一组结果。

来源：

- `scripts/mock-image-api-server.mjs`
- `docs/mock-image-api-server.md`

### FR-020 Photoshop 画布原语

系统提供一组可复用的 Photoshop 画布交互原语，供生图工作流调用。

能力：

- 抓取可见图像。
- 抓取选区图像。
- 抓取选中图层图像。
- 读取画布尺寸。
- 读取选区位置。
- 插入图像到指定位置。
- 插入图像到全画布。
- 插入图像到当前选区。
- 创建 sample 图像。

验收标准：

- 读取图像统一输出 `CapturedCanvasImage`。
- 输出包含 `id`、`label`、`width`、`height`、`sourceBounds`、`previewUrl`、`rgba`。
- 只处理 8-bit 图像。
- 图像数据使用后释放 Photoshop imageData。
- 修改文档状态进入 `executeAsModal()`。
- 无文档、无选区、无选中图层时返回可读错误。

来源：

- `canvasPrimitiveService.ts`
- `canvasPrimitives.ts`
- `canvas-primitives-reference.md`

### FR-021 浏览器预览

开发者可以在浏览器中预览 Vue UI 和 mock 状态。

验收标准：

- `npm run dev` 可启动浏览器预览。
- UXP 构建时生成 `browser-preview.html`。
- 浏览器预览注入 mock `window.require("uxp")`。
- 浏览器预览不调用 Photoshop API。
- 画布相关操作在浏览器中返回 mock 图像或提示无法置入。

来源：

- `vite.uxp.config.ts`
- `useLightyearBanana.ts`

### FR-022 UXP 构建与打包

开发者可以生成、校验和打包 UXP 插件产物。

验收标准：

- `npm run build:uxp` 生成 `dist/ps-uxp`。
- `npm run verify:uxp` 构建并执行静态校验。
- `npm run package:uxp` 生成 `.ccx`。
- 构建产物复制 manifest 和 icons。
- 校验失败时输出明确错误。

来源：

- `package.json`
- `vite.uxp.config.ts`
- `scripts/verify-uxp-build.mjs`

## 非功能需求

### UXP 兼容性

- 插件必须在 Photoshop UXP runtime 下加载。
- 面板入口必须使用 classic script。
- 不允许在产物中保留 `eval()`、`new Function`、动态 `import()`、`import.meta`。
- Photoshop 文档修改必须进入 modal scope。
- UXP UI 后续要按 `ref/uxp-ui-runtime-rules.md` 收敛到 Spectrum UXP Widgets 或 SWC wrapper。

### 性能

- 大型 RGBA 数据使用 `shallowRef` 或普通对象保存，避免深层响应式代理。
- 生成中状态只保留必要的参考图、提示词和计时。
- 图像写入前按目标区域缩放。
- 长任务必须展示 busy 或 loading 状态。

### 可用性

- 面板要适配 docked size 和 floating size。
- 所有错误文案面向普通用户。
- 生成、测试、置入等异步操作需要明确状态。
- 参考图和结果图都需要可识别标签。

### 安全和隐私

- API Key 当前保存在 `localStorage`，后续稳定版本应迁移到 `secureStorage`。
- 自定义 Base URL 在 UXP 中受 manifest 网络域名限制，正式版本需要明确可用域名策略。
- Mock Server 只用于本地开发和验证。
- 上传文件和剪贴板入口当前未接真实文件系统或剪贴板。

## 当前限制

| 限制 | 影响 | 后续要求 |
| --- | --- | --- |
| 上传文件入口为占位 | 用户不能从本地文件添加参考图 | 接入 UXP `localFileSystem` |
| 剪贴板入口为占位 | 用户不能直接从剪贴板添加参考图 | 接入 UXP clipboard 能力并做权限声明 |
| API Key 存在 `localStorage` | 不适合正式存储敏感信息 | 改为 `secureStorage` |
| 自定义 Base URL 受 manifest 限制 | 任意域名无法直接请求 | 明确白名单、代理或配置策略 |
| OpenAI edit 的 reference Blob 仍需修正 | 多参考图真实请求可能失败 | 把 data URL 转成二进制 Blob |
| 远程图片转 RGBA 依赖 canvas | UXP runtime 下需要实机验证 | 增加 UXP 兼容图像读取方案 |
| UI 大量使用普通 HTML/CSS 动效 | UXP 稳定性风险 | 迁移 Spectrum UXP Widgets 或 SWC wrapper |
| 当前只处理 8-bit 图像 | 16-bit、32-bit 文档不可用 | 扩展像素转换 |
| Flux provider 仅声明能力 | 当前请求层未实现 Flux API | 增加 BFL 请求和 polling |

## 里程碑建议

### M1 UXP 稳定化

目标：让当前原型在 Photoshop UXP runtime 中稳定加载、操作和回归。

交付内容：

- UI 控件迁移到 Spectrum UXP Widgets 或 SWC wrapper。
- 移除关键路径 CSS transition、animation 和未验证 grid 布局。
- 完成 Photoshop 实机回归。
- 补充 UXP UI 静态校验。

### M2 参考图真实输入

目标：把所有参考图入口接入真实数据源。

交付内容：

- 上传文件读取。
- 剪贴板读取。
- 参考图压缩和尺寸限制。
- 文件、剪贴板权限声明。

### M3 API 接入完善

目标：让多 provider 请求在真实 API 下稳定工作。

交付内容：

- 修复 OpenAI edit reference 上传。
- 完成 Flux provider。
- 明确自定义 Base URL 策略。
- API Key 使用 secureStorage。
- 增加 provider 级错误展示。

### M4 Photoshop 工作流增强

目标：让生成结果更自然地进入 Photoshop 编辑流程。

交付内容：

- 置入到指定图层或新组。
- 支持画板范围。
- 支持 16-bit、32-bit 文档。
- 支持从结果创建版本组或命名图层。

## 验证清单

- `npm run verify:uxp` 通过。
- UXP Developer Tools 可加载 `dist/ps-uxp/manifest.json`。
- Photoshop 菜单命令可创建图层。
- 面板可打开并显示工作台。
- 可见图层、选区、选中图层可添加为参考图。
- Mock Server 成功路径可返回图片。
- Mock Server 错误 key 可返回对应错误。
- 生成结果可显示在对话流。
- 生成结果可作为参考图。
- 超分按钮可填入下一轮参数。
- 生成结果可置入全画布。
- 生成结果可置入当前选区。
- 设置页可新建、编辑、启用、删除配置。
- 配置保存后重开面板可恢复。
- 浏览器预览不阻断 UI 开发。

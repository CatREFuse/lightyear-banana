# Mugen 当前功能规格

版本：vNext
日期：2026-08-12
状态：当前开发基线

## 产品决策

- 对外品牌名只使用 `Mugen`。
- Electron 桌面端已整体移除（2026-08-12），不再有桌面入口或打包流程。
- 旧官网实现与旧官网内容已废弃。正式站点重构为单屏 Mugen 品牌页。
- Inner WebUI `0.1.x` 已废弃，不作为 vNext 的兼容目标或发布基线。
- Inner WebUI vNext 是当前工作台，当前开发版本为 `0.2.0`，可在 CCX 内和普通浏览器中运行。
- 独立 UXP 技术原型已删除，不再承载产品功能或参与构建。
- Photoshop CCX 是当前正式运行层。CCX Host 负责 Photoshop 画布读取、结果置入和需要 Adobe 插件权限的本地能力。
- 当前 CCX 版本为 `1.0.3`，Photoshop 插件 ID 为 `com.tanshow.mugen`。不得恢复旧 ID，也不得为 vNext 新建第二个产品插件 ID。

## 官方单屏站点

### 页面内容

官网只有一个视口高度的主画面，不提供导航、功能介绍、长文案、页脚或第二屏。用户可见内容限于：

- 品牌主文字 `Mugen`。
- `下载 CCX` 按钮。
- `进入 WebUI` 按钮。
- 当前 CCX 标本号。

标本号必须来自同一份 CCX 发布元数据，不能在 HTML 中维护第二份独立版本值。下载按钮必须指向该标本号对应、完成校验的 CCX 文件；WebUI 按钮进入浏览器运行时的正式入口。

### 书法主文字

- `Mugen` 使用 ImageGen 生成的毛笔书法位图作为主视觉。
- 生成后必须进行超分，保留高分辨率源文件和网站优化版本。
- 页面只渲染最终选定版本，不在生产站点展示提示词、制作说明或候选稿。
- 图片需要提供可访问名称 `Mugen`；书法资源未加载时仍显示文字兜底。
- 不使用未经授权的字体、封面图或品牌资产复刻参考作品。

### Three.js 背景

- 背景完整复用 `mugen/prototype/prism-demo` 的 Three.js `0.184.0` 场景链，使用透视相机、四面体表面 Raycaster、逐色三维折射、光束 Shader、焦散与空间微粒实时渲染透明三棱镜、一束入射白光和折射后的彩色光谱。
- 构图可以参考深色空间、单体棱镜和克制光线的封面氛围，不复制现有封面的具体图形或排版。
- 三棱镜支持指针拖动或移动产生的旋转，并在触摸设备上保留可操作方式。
- 三棱镜使用四面体造型并始终保持自转；指针或触摸拖动只叠加观察角度，不停止自转。
- 色散偏移默认值为 `2.5`，红光折射率默认值为 `1.3`，转速默认值为 `0.55`，入射角默认值为 `8°`。连续点击三棱镜 5 次后显示光路参数面板，面板可调整色散偏移、红光折射率、转速和入射角，不提供关闭自转的选项。
- 三棱镜使用更清晰、更强的环境高光反射，同时保持玻璃透射与内部光路可见。
- 光束起点、棱镜和光谱必须保持清楚的因果关系；彩色光线从棱镜出射面开始。
- 固定入射角在旋转中错过四面体时，入射方向自动校正到当前棱镜表面，确保白色入射光始终可见并与折射光路连续。
- 旋转只改变三维视角和光线方向，不遮挡主文字与主要按钮。
- `prefers-reduced-motion`、WebGL 不可用和低性能设备必须有稳定静态兜底。

### 液态玻璃按钮

- 两个按钮使用 CSS 实现的半透明液态玻璃材质，共用同一视觉系统。
- 材质至少包含透明层、边缘高光、背景模糊和清楚的交互状态。
- 按钮文字在明暗背景、悬停、聚焦和按下状态下均满足可读性要求。
- 支持键盘焦点与触摸，不以动效作为唯一状态反馈。
- 页面在常见桌面与移动视口中保持单屏；允许安全区内自适应，不产生正文滚动。

## Inner WebUI vNext

### 代码平移原则

- vNext 以原 Electron UI 的实际 Vue、TypeScript、状态管理、Provider、提示词、结果流和主题代码为迁移源（迁移已完成并删除桌面源码）。
- 迁移保留了源代码级结构与行为对应关系，并针对 WebUI 运行环境做适配。
- 不允许根据截图重新搭建一套相似界面，也不允许保留简化版 0.1 UI 作为生产入口。
- 迁移过程中可拆出共享模块或移动文件，每个核心模块都能追溯到 Electron UI 原实现或有明确的运行时适配原因。
- Electron runtime、preload、IPC、本地 Bridge 和桌面窗口代码已从 vNext 中移除。

### 共同功能

CCX 与浏览器运行时使用同一套生产 WebUI 和应用状态，保留原 Electron 工作台的以下能力：

- 工作台、消息流、结果卡片和设置页。
- Provider 配置、API Key、Base URL、模型和能力约束。
- 预设提示词、参考图、生成参数、生成状态和错误反馈。
- 图片生成、任务轮询、取消、历史、结果作为参考和超分入口。
- Nothing 与经典主题，以及既有响应式布局规则。

### 运行时能力矩阵

| 能力 | CCX 内 WebUI | 普通浏览器 WebUI |
| --- | --- | --- |
| Provider 配置与测试 | 支持 | 支持 |
| 真实网络生成流程 | 支持 | 支持 |
| 提示词、参数、结果流 | 支持 | 支持 |
| 上传运行时可访问的参考图 | 按 CCX 能力实现 | 支持 |
| 读取 Photoshop 可见画布 | 支持 | 不显示入口 |
| 读取 Photoshop 选区 | 支持 | 不显示入口 |
| 读取 Photoshop 当前图层 | 支持 | 不显示入口 |
| 把结果置入 Photoshop | 支持 | 不显示入口 |
| UXP SecureStorage | 支持 | 不可用，使用浏览器适配层 |

普通浏览器是可独立使用的生产运行时，不再是 Mock Host 预览。没有 Photoshop Host 时，画布读取和置入控件必须从界面和键盘导航中移除，不能用禁用按钮、模拟图片或错误提示占位。网络生成、配置保存、配置测试和结果查看仍需完整可用。

### 运行时适配

- WebUI 启动时通过能力探测选择 CCX Host adapter 或 Browser adapter，不依赖 URL 参数伪造运行时。
- 应用组件只消费明确的能力合同，不直接访问 Electron IPC、UXP `require()` 或全局 Host 对象。
- CCX 中所有 Photoshop 文档修改继续由 CCX Host 在 `core.executeAsModal()` 内执行。
- CCX 中 API Key 保存在 UXP SecureStorage；浏览器中的凭据由浏览器适配层保存，并明确仅留在当前浏览器配置中。
- 两种运行时共享 Provider 请求语义和错误映射。因跨域策略无法使用的自定义服务必须给出可操作错误。
- 生产 bundle 不自动启用 Mock Server，不包含自动注入的 Mock Host。

## 保留的工作台规格

### Nothing 主题

- 界面主题支持 `Nothing` 和 `经典`，首次使用默认 `Nothing`。
- 明暗模式支持 `跟随系统`、`深色`、`浅色`，首次使用默认深色。
- 浏览器偏好写入 `mugen.theme.v1`；CCX 通过 Host 设置存储保存同一语义。
- Nothing 使用本地打包的 Doto、Space Grotesk 和 Space Mono 字体，不依赖远程字体服务。
- 生产 bundle 必须将三套字体输出为本地哈希资源，并拒绝未解析的 `@fontsource` 包路径。
- 深色使用 OLED 黑，浅色使用暖白；经典主题保留原有字体和主体样式。
- 状态、参数和命令使用等宽字体，主标题和正文使用 Space Grotesk，数字式空状态使用 Doto。
- 控件使用 4px 技术圆角，菜单可使用 8px 圆角。
- 不使用渐变、阴影、发光、动画和过渡；红色只承担错误、删除和少量选中标记。
- Nothing 与经典主题共用组件尺寸、间距、布局和响应式规则，260px 宽度下不产生水平滚动或内容裁切。

### Provider 注册架构

| 层 | 主要入口 | 职责 |
| --- | --- | --- |
| 合同 | `packages/mugen-core/src/providers/contracts.ts` | 请求、结果、适配器、定义和校验类型 |
| 定义 | `packages/mugen-core/src/providers/definitions.ts` | Provider 能力、必填字段、模型差异和默认配置 |
| 注册表 | `packages/mugen-core/src/providers/registry.ts` | 静态注册、查找、派发前校验和 generate/test 入口 |
| Wire 兼容层 | `packages/mugen-core/src/providers/legacyRuntime.ts` | 已验证的请求构造、轮询、响应解析和错误映射 |
| 兼容 facade | `packages/mugen-core/src/data/providerCapabilities.ts`、`packages/mugen-core/src/services/imageApiClient.ts` | 保持旧 import 和公开导出稳定 |

- 11 个 Provider ID 必须同时出现在能力定义和静态注册表中。
- 未注册 Provider、Provider 不匹配、缺少模型、必填 API Key 或 Base URL 时不进入 wire 层。
- `supportsBaseUrl` 只表示界面允许编辑地址；`requiresBaseUrl` 单独决定地址是否必填。
- iMini、ComfyUI 和 Codex Image Server 可以使用 wire 层默认地址；自定义 OpenAI 配置必须填写 Base URL。
- iMini 使用 `https://openapi.imini.ai/imini/router` 和 Bearer API Key；图片任务提交到 `POST /v1/images/generate`，随后查询 `GET /v1/images/tasks/{task_id}`。
- iMini 只处理 `queued`、`processing`、`succeeded`、`failed` 四种任务状态；图片任务使用 10 分钟总超时、1.5 倍指数退避、30 秒上限与正负 20% 抖动，429 的等待下限为 5 秒。
- iMini 错误保留 `error.code`、`error.message` 和 `request_id`，发布验证必须运行独立的 iMini Provider 冒烟。
- iMini Provider 冒烟从 monorepo 的 `packages/mugen-core` 编译输出加载共享能力和请求实现，目录重构后仍必须通过发布门禁。
- 配置结构、Provider ID、请求语义和旧公开函数在源码平移中保持兼容，运行时存储由 adapter 接管。

### 预设提示词

- 设置页提供预设列表以及新增、编辑和删除入口，最多保存 100 条。
- 名称长度为 1–24 个 Unicode 字符，只支持中文、英文字母、数字、`_` 和 `-`。
- 名称使用 NFKC 和 ASCII 小写规则检查冲突；提示词内容不能为空并支持多行。
- 在提示词框输入 `/` 或 `/名称片段` 打开最多 6 条的过滤菜单。
- `ArrowUp`、`ArrowDown`、`Enter`、`Escape` 和鼠标操作可用，点击菜单外区域关闭。
- 发送精确 `/名称` 时解析为预设正文；`//正文` 发送字面量 `/正文`。
- 未知精确命令保留输入和参考图并显示错误；`/名称 其他内容` 按普通正文发送。
- 预设正文只展开一次，并随两种运行时各自的设置存储恢复。

## APIMart 测试夹具

- 本地测试服务按 APIMart 接口格式提供模型列表、参考图上传、生图提交、任务查询和图片获取。
- 成功响应中的所有图片固定使用同一张小猫 fixture，确保断言稳定；同一任务在提交、轮询和下载阶段必须引用同一内容。
- 服务提供状态重置和请求记录，使测试可以断言上传、生成、轮询和图片下载的调用次数与关键参数。
- 测试 Key、Base URL 和返回内容只用于本地验证，不进入正式默认配置。

### 浏览器冒烟

- 新建、编辑、测试、保存并重载 APIMart 配置。
- 发送生成请求，完成上传或生成、轮询和图片获取，并显示固定小猫结果。
- 错误、超时和取消路径不会破坏下一次请求。
- 页面不存在 Photoshop 画布读取、选区读取、图层读取和结果置入入口。
- 浏览器不会调用 CCX Host 或伪造 Photoshop 资产。

### CCX 冒烟

CCX 测试必须在真实 Photoshop 中完成一个完整闭环：

1. 打开具有可辨识内容的测试文档。
2. 从 Photoshop 读取可见画布、选区或当前图层作为参考图，并确认像素与边界信息有效。
3. 使用 APIMart 本地配置发送请求。
4. 完成参考图上传、生成提交、任务查询和固定小猫图片获取。
5. 把返回图片置入当前 Photoshop 文档。
6. 证明新图层存在、尺寸与目标区域正确，并能继续参与下一轮工作流。

`/__smoke/state` 或等价请求记录必须证明网络阶段真实发生。仅通过单元测试、静态构建、浏览器 Mock 或人工观察界面，不能替代 Photoshop 完整闭环。

## 发布边界

- 当前阶段允许在 WebUI、单屏官网和 CCX 各自门禁通过后部署正式入口。官网使用 `download/mugen-<version>.ccx` 直连标准，CCX 随站点快照发布并纳入全站逐字节校验；`releases/latest.json` 已废弃。
- 旧官网、Electron 桌面端与 Inner WebUI 0.1 只保留历史记录；独立 UXP 原型代码已删除，均不进入新首页、WebUI 入口或活动发布说明。
- CCX 包必须内含与浏览器版同源构建的 WebUI，且不依赖公网 WebUI 才能启动。
- CCX 必须由 Adobe UXP Developer Tools 的 `Package` 动作从已验证的 `dist/ccx-host` 生成；发布脚本只校验、改名、计算校验和并登记该 UDT 产物，不得使用 PowerShell、系统 `zip` 或其他通用压缩工具重新创建 CCX。
- Windows 分发验收必须从资源管理器双击最终 CCX，确认 Creative Cloud 显示第三方插件信任提示、完成安装、在“管理插件”中出现，并在 Photoshop 插件菜单中可用；命令行 `/install` 结果不能替代这条验收。
- 浏览器 WebUI 和 CCX WebUI 可以独立部署，但必须记录可追溯的提交、版本和兼容信息。
- 任何版本号与官网发布仍受 `docs/build-todo-list.md` 门禁约束。

## 非目标

- Electron 桌面端已删除，不再恢复。
- 本阶段不扩展官网介绍、教程、价格、案例或账号系统。
- 本阶段不把浏览器运行时伪装成 Photoshop。
- 本阶段不继续维护 Inner WebUI 0.1 的视觉或协议兼容。
- 不恢复独立 UXP 产品、构建入口或第二套界面实现。

## 验收证据

- 官网桌面与移动视口截图及交互录屏，证明单屏、书法字、可旋转棱镜、折射光线、两个液态玻璃按钮和 CCX 标本号均成立。
- 生产 bundle 扫描拒绝 Electron runtime（见 `webui/scripts/bundlePolicy.mjs` 回归防线）。
- 浏览器自动化测试，证明真实网络与配置流程可用且无 Photoshop 操作入口。
- `npm run verify:ccx`、UDT 官方打包校验与 Windows 资源管理器双击安装验收通过。
- Photoshop 实机完整闭环记录，证明画布抓取、APIMart 请求、小猫图片获取和新图层置入均成功。

## 历史归档

截至 2026-08-11，Inner WebUI `0.1.0`、CCX `1.0.0`、`inner-host/v1` 和旧官网曾完成部分构建、协议、静态发布与自动化验证。这些结果只说明旧基线曾可运行，不证明 vNext 已通过验收。Electron `0.3.x` 的安装包、构建记录和 Bridge 文档已随源码移除，历史见 `docs/build-todo-list.md` 发行记录。

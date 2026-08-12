# Mugen vNext 功能需求

版本：vNext 需求基线
日期：2026-08-11
状态：实施中

## 1. 产品范围

Mugen vNext 由三个活动交付物组成：

| 交付物 | 用途 | 当前决策 |
| --- | --- | --- |
| 官方单屏站点 | 品牌、CCX 下载、浏览器 WebUI 入口 | 重构 |
| Inner WebUI vNext | 生图工作台，在浏览器和 CCX 内运行 | 重构 |
| Photoshop CCX | 提供 Photoshop 画布能力并承载同源 WebUI | 保留并适配 |

以下实现进入归档状态：

| 归档对象 | 处理方式 |
| --- | --- |
| Electron 桌面端 | 已删除（2026-08-12） |
| 旧官网 | 停止作为设计和内容基线；线上替换必须通过新站门禁 |
| Inner WebUI 0.1 | 停止维护，不要求 vNext 保持其简化 UI 或 Mock Host 行为 |
| Standalone UXP 插件原型 | 已从源码、构建、测试与版本链删除 |

独立 UXP 产品已经删除。Photoshop CCX 仍通过 Adobe UXP runtime 提供画布读取、文档写入、SecureStorage 和原生权限能力；这个厂商运行时属于 CCX 的底层依赖，不是独立产品。

## 2. 官方站点需求

### WEB-FR-001 单屏结构

- 官网在单个视口中完成全部主要交互。
- 页面无导航栏、介绍段落、功能列表、案例、价格、页脚和第二屏内容。
- 用户可见主体只有 `Mugen`、`下载 CCX`、`进入 WebUI` 和 CCX 标本号。
- 桌面与移动视口均不依赖纵向滚动完成主要操作。
- 刘海、安全区和浏览器工具栏变化不会遮挡按钮。

### WEB-FR-002 毛笔书法品牌字

- `Mugen` 使用 ImageGen 生成并经过超分的毛笔书法图像。
- 高分辨率母版与网站优化资源均可追溯。
- 资源为独立原创生成内容，不直接复制参考封面的字形或排版。
- 书法图像加载失败时显示 `Mugen` 文字兜底。
- 图片具有可访问名称，生产页面不展示生成提示词或制作说明。

### WEB-FR-003 三棱镜折射背景

- 场景包含一束入射白光、一个透明三棱镜和从出射面展开的彩色光谱。
- 三棱镜可通过指针或触摸交互旋转。
- 棱镜旋转时光束、出射方向和遮挡关系同步更新。
- 背景不阻断按钮点击、键盘焦点或页面文字阅读。
- WebGL 不可用、资源加载失败或用户偏好减少动态时显示可用静态画面。
- 首屏不存在持续增长的 GPU 资源、重复 animation loop 或明显输入延迟。

### WEB-FR-004 液态玻璃按钮与标本号

- 下载和 WebUI 入口使用统一的 CSS 液态玻璃材质。
- 默认、悬停、键盘聚焦、按下和禁用状态清楚。
- 不支持 `backdrop-filter` 时仍有可读的半透明兜底。
- `下载 CCX` 指向完成发布校验的 CCX 文件。
- `进入 WebUI` 指向独立浏览器运行时。
- 标本号从 CCX 发布元数据读取，并与下载文件、Manifest 和 SHA256 记录对应。
- 数据不可用时不显示伪造版本或硬编码占位值。

## 3. WebUI vNext 迁移需求

### UI-FR-001 源码平移

- WebUI vNext 已从原 Electron UI 源码平移，并针对 Web 与 CCX 环境适配。
- 工作台、消息流、输入 Dock、设置、Provider、预设、结果卡片和主题均有源代码级迁移对应。
- 迁移以移动、复用或抽取 Vue、TypeScript 和 CSS 模块为主，不以截图或视觉观察重新实现。
- 评审材料包含旧模块到 vNext 模块的映射（桌面源码已删除）。
- 关键交互的自动化测试或行为断言得到保留或迁移。
- Electron preload、IPC、本地 Bridge、桌面窗口和自动更新代码不进入 vNext 运行依赖。
- Inner WebUI 0.1 的简化生产入口被替换，不能与 vNext 并存为两个可发布工作台。

### UI-FR-002 共享应用内核

- CCX 和浏览器运行时共享同一套生产 UI、业务状态和 Provider 语义。
- 提示词、参数、Provider 能力、任务状态、结果解析、历史和错误映射一致。
- 运行时差异通过明确 adapter 或 capability contract 实现。
- Vue 组件不直接调用 Electron IPC、Photoshop API 或复杂 `batchPlay` descriptor。
- 不通过两份分叉组件实现 CCX 与浏览器页面。

### UI-FR-003 运行时识别

- 有受信任 CCX Host 时进入 Photoshop 能力模式。
- 没有 CCX Host 时进入可独立使用的浏览器模式。
- 普通 URL 参数不能伪造 Photoshop 能力。
- 能力探测失败时只影响对应能力，不使设置与网络生图整体不可用。
- 运行时状态可供自动化测试读取，但不在普通用户界面显示工程调试文案。

### UI-FR-004 工作台与结果流

- 用户可以管理参考图、输入提示词、选择配置和模型参数并发送。
- 生成中显示本轮输入、参考图、状态和耗时。
- 每轮结果保留提示词、参考图、模型配置、耗时和图片列表。
- 每张结果支持继续作为参考和进入超分流程。
- 错误不会清空仍可重试的输入和参考图。
- 界面在常见浏览器宽度和 Photoshop 停靠、浮动面板尺寸下可用。

### UI-FR-005 Provider 配置与网络

- 两种运行时都支持配置新建、编辑、启停、测试、删除和重载恢复。
- 配置至少包含名称、Provider、模型、API Key 和适用时的 Base URL。
- Provider 能力决定参考图上限、尺寸、比例、质量和数量选项。
- Browser adapter 可以直接执行浏览器允许的 Provider 请求，并正确报告 CORS、网络、鉴权和限流错误。
- CCX adapter 按 Host 安全边界执行网络和凭据操作。
- 生产运行时不会自动开启本地 Mock Server。

### UI-FR-006 预设提示词

- 支持新增、编辑、删除和重载恢复，最多 100 条。
- 名称长度为 1–24 个 Unicode 字符，只支持中文、英文字母、数字、`_` 和 `-`。
- 名称按 NFKC 和 ASCII 小写规则判重。
- 输入 `/` 或 `/片段` 显示最多 6 条匹配结果。
- 支持键盘与鼠标选择、`Escape` 关闭和 `//` 字面量转义。
- 两种运行时行为一致。

### UI-FR-007 浏览器独立运行

- 浏览器模式可以完成配置、配置测试、网络生成、任务轮询、取消和结果展示。
- Photoshop 可见画布、选区、当前图层抓取入口不存在。
- 结果置入 Photoshop 的按钮、菜单项、快捷键和无障碍节点不存在。
- 不使用小猫或其他 Mock 图像替代 Photoshop 画布。
- 不要求安装任何桌面端或浏览器扩展。
- 浏览器刷新后可以恢复允许持久化的配置；凭据只保存在当前浏览器适配层。

### UI-FR-008 CCX Photoshop 能力

- 可以抓取当前文档可见合成图、当前选区的可见合成内容与边界，以及当前选中图层。
- 图像数据使用统一结构保存预览、宽高、像素和 `sourceBounds`。
- 可以把生成结果置入全画布、当前选区或本轮参考图记录的选区位置。
- 修改 Photoshop 文档的操作全部进入 `core.executeAsModal()`。
- WebUI 不直接构造复杂 `batchPlay` descriptor；能力先由 `canvasPrimitives.ts` 提供最小原子函数，再由 `canvasPrimitiveService.ts` 暴露。
- API Key 存入 UXP SecureStorage，不通过 WebView 消息回传明文。

### UI-FR-009 运行时能力可见性

- 浏览器模式完全移除 Photoshop 专属入口及其菜单分隔、占位和快捷键说明。
- CCX 连接暂时中断时显示恢复操作，并防止发起会丢失数据的 Photoshop 命令。
- 共同功能在两种运行时中的位置和文案保持一致。
- 自动化测试覆盖能力切换，避免只靠 CSS 隐藏仍可触发的命令。

## 4. APIMart 测试夹具

### TEST-FR-001 固定小猫成功结果

- 服务只监听 loopback 地址，端口可配置。
- 支持模型列表、参考图上传、生成提交、任务查询和图片获取。
- 同一个固定小猫文件用于所有成功结果，不随机选择图片。
- 同一任务在创建、轮询和最终下载中保持相同结果标识与内容。
- 返回图片具有稳定 MIME、尺寸和 SHA256，便于断言。
- 支持 `GET /__smoke/state` 和 `POST /__smoke/reset`。
- 支持鉴权失败、权限、限流、额度、服务错误、超时和取消测试。

### TEST-FR-002 浏览器网络冒烟

- 在普通浏览器启动 vNext，不注入 Mock Host。
- 新建 APIMart 配置，填写本地 Base URL 与测试 Key并保存。
- 配置测试成功，页面重载后配置仍存在。
- 发起生成并取得固定小猫结果。
- 请求记录证明需要的 APIMart endpoint 被真实调用。
- 断言 DOM、焦点顺序和快捷键中均不存在 Photoshop 读取与置入入口。
- 至少验证一次可恢复错误与一次取消或超时路径。

### TEST-FR-003 CCX Photoshop 完整冒烟

- 在真实 Photoshop 和正式 CCX 构建中执行，不能只使用浏览器或 CCX Host 静态 Mock。
- 打开已知测试文档并抓取画布内容；采集结果像素与边界有效。
- 参考图通过 APIMart 上传或随生成请求发送。
- 生成提交、任务查询和固定小猫获取全部成功。
- 把小猫结果置入当前文档并生成新图层。
- 新图层的尺寸、位置和内容与选定目标一致。
- APIMart 请求记录与 Photoshop 文档状态共同构成通过证据。

## 5. 非功能需求

### 性能与兼容

- 官网 Three.js 加载不阻塞按钮，并在卸载时释放 GPU 资源、事件和动画帧。
- 大型 RGBA 数据不进入深层响应式代理，不通过 WebView 重复传输完整副本。
- CCX 满足 Photoshop UXP Manifest v5 和目标 Photoshop 版本要求。
- 两种运行时使用相同的 Provider 合同和结果数据结构。

### 可访问性

- 官网按钮有可见焦点、可访问名称和足够对比度。
- 书法位图具有文字等价内容。
- 减少动态偏好下停止非必要旋转和视差。
- WebUI 的隐藏能力不会留下不可见的可聚焦控件。

### 安全与隐私

- CCX API Key 只进入 UXP SecureStorage。
- 浏览器凭据不得发送到除用户配置 Provider 以外的服务，也不得写入日志。
- 日志不记录 API Key、图片正文或完整提示词。
- 自定义 Base URL 必须拒绝带嵌入凭据的 URL，并清楚处理非安全网络限制。
- 本地 APIMart 夹具只监听 loopback，测试 Key 不进入正式默认配置。

## 6. 发布验收

- 官网有桌面与移动视口截图或录屏，证明单屏、书法字、可旋转棱镜、折射光线、液态玻璃按钮和 CCX 标本号。
- 代码搜索证明没有 Electron runtime 依赖进入 WebUI bundle（bundlePolicy 回归防线覆盖）。
- WebUI 单元、Provider、协议和浏览器 E2E 通过。
- `npm run verify:ccx` 通过；修改 Manifest、entrypoint、icon 或权限后在 Adobe UXP Developer Tools 执行 Unload/Load。
- 修改 Vue、TypeScript 或 CSS 后重新构建 CCX，并在 Adobe UXP Developer Tools 中 Reload。
- TEST-FR-002 浏览器冒烟通过。
- TEST-FR-003 Photoshop 完整冒烟通过。
- 官网、WebUI 和 CCX 的版本、来源和 SHA256 满足 `docs/build-todo-list.md`。

## 7. 当前阶段顺序

1. 冻结旧官网和 Inner WebUI 0.1；删除 Standalone UXP 产品代码。
2. Electron 桌面端已整体移除（2026-08-12）。
3. 平移共享 UI 与业务模块，去除 Electron runtime 依赖（已完成）。
4. 建立 Browser adapter 与 CCX Host adapter，并按能力裁剪入口。
5. 固化 APIMart 单猫 fixture，完成浏览器冒烟。
6. 打包 CCX，在真实 Photoshop 完成抓取、请求、取图和置入闭环。
7. 完成单屏官网和发布门禁，再切换正式入口。

## 8. 历史归档

2026-04-28 至 2026-08-11 的技术原型曾标定 UXP 面板、画布原语、多 Provider、结果流、设置、Mock Server、Nothing 主题和预设提示词等能力。Inner WebUI `0.1.0` 曾以 `inner-host/v1` 与 CCX Host 连接，旧官网与公开 WebUI 也曾完成构建和公网校验。Electron `0.3.x` 曾提供桌面窗口、Bridge、诊断与安装包。

这些记录仍可用于追溯代码和回归行为。它们属于历史实现，不能用来证明 vNext 的浏览器独立运行、源码平移、单屏官网或 Photoshop 完整冒烟已经完成。

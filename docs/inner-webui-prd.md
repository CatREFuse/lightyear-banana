# Mugen WebUI vNext 产品需求与源码迁移规格

版本：vNext
日期：2026-08-11
状态：当前实施规格，取代 Inner WebUI 0.1 PRD

## 1. 决策摘要

Mugen WebUI vNext 从原 Electron UI 源码平移，随后适配 CCX 和普通浏览器两个运行时。Electron 桌面端、Inner WebUI 0.1 和 Standalone UXP 产品实现均已废弃或归档。

Photoshop CCX 继续保留。CCX 内使用同一套 WebUI，并通过 UXP Host 获得画布抓取、选区、图层、置入、SecureStorage 和原生权限。普通浏览器独立完成配置与网络生图，不显示任何 Photoshop 读取或置入入口。

## 2. 目标与非目标

### 产品目标

- 恢复并延续原 Electron UI 的完整工作台体验。
- 让同一 WebUI 在 CCX 与浏览器中使用。
- 让浏览器用户无需 Electron、CCX 或 Bridge 即可配置 Provider 并生成图片。
- 让 Photoshop 用户在共享工作台中完成画布到模型再回到画布的闭环。
- 用 APIMart 格式本地夹具稳定验证两种运行时。

### 工程目标

- 保留原 Electron UI 的组件、状态、Provider、预设、结果流、主题和测试资产。
- 去除 Electron runtime、preload、IPC、Bridge 和桌面窗口依赖。
- 用能力合同隔离 Browser adapter 与 CCX Host adapter。
- 保持 Provider 请求语义和结果数据结构跨运行时一致。
- 只保留一个生产工作台实现。

### 非目标

- 不维护 Inner WebUI 0.1 的简化界面或 Mock Host 启动语义。
- 不恢复 Electron 应用、桌面安装包、自动更新或本地 Bridge。
- 不把浏览器页面伪装为 Photoshop，也不显示不可用的 Photoshop 按钮。
- 不继续扩展 `standalone-uxp-plugin/`。
- 不通过截图、设计图或视觉能力重做 Electron UI。

## 3. 源码平移原则

### 3.1 迁移来源

| 原模块 | vNext 职责 |
| --- | --- |
| `src/components/mugen/` | 工作台、消息流、输入 Dock、设置、结果和通用控件 |
| `src/composables/useMugen.ts` | 会话、参考图、生成、设置和结果操作 |
| `src/providers/` | Provider 合同、能力、注册、校验和请求语义 |
| `src/data/providerCapabilities.ts` | 旧 import 兼容与能力入口 |
| `src/services/imageApiClient.ts` | 旧请求 facade 与迁移来源 |
| `src/styles/` | Nothing、经典主题、字体和布局 token |
| 原 Electron UI 测试 | 交互与回归行为基线 |

迁移可以移动文件、拆分模块、抽取共享包和改写运行时边界。核心交互必须保留代码与行为来源，不接受根据旧界面外观重新搭建的新组件集合。

### 3.2 必须去除的依赖

- `electron` runtime 与主进程模块。
- preload 暴露的 IPC API。
- 桌面窗口、托盘、自动更新和本地文件路径约定。
- Electron Bridge Server、Bridge Token 和桌面轮询。
- 仅对桌面诊断与安装包有意义的状态。

### 3.3 迁移证据

代码评审必须包含模块映射，至少覆盖 `MugenPanel`、消息流、结果卡片、Composer、参考图、参数选择、设置、配置编辑、API 测试、预设提示词、Provider、主题和原有自动化测试。

## 4. 产品信息架构

| 页面或区域 | 主要任务 |
| --- | --- |
| 工作台 | 查看历史、参考图、输入提示词、选择参数、发送 |
| 消息流 | 查看每轮输入、状态、耗时和结果 |
| 输入 Dock | 管理参考图、提示词、Provider 配置和生成参数 |
| 设置列表 | 管理 Provider、主题、预设与运行时允许的本地设置 |
| 配置详情 | 新建、编辑、测试、启停和删除配置 |

共同交互：

- 提示词或参考图至少存在一项时允许发送。
- Enter 发送，Shift+Enter 换行，输入法组合状态不发送。
- 参数选项由当前 Provider 能力驱动。
- 每轮生成保留输入、参考图、配置、耗时、状态和结果。
- 每张结果可以继续作为参考或填入超分流程。
- 可恢复错误保留输入和参考图。
- 配置和主题重载后恢复。

## 5. 运行时能力

### 5.1 能力矩阵

| 能力 | Browser adapter | CCX Host adapter |
| --- | --- | --- |
| Provider 配置与 API 测试 | 支持 | 支持 |
| 真实生图网络流程 | 支持 | 支持 |
| 任务轮询和取消 | 支持 | 支持 |
| 结果流、参考、超分 | 支持 | 支持 |
| 浏览器文件输入 | 支持 | 按 UXP 文件能力适配 |
| Photoshop 可见画布 | 不提供 | 支持 |
| Photoshop 选区 | 不提供 | 支持 |
| Photoshop 当前图层 | 不提供 | 支持 |
| Photoshop 结果置入 | 不提供 | 支持 |
| UXP SecureStorage | 不提供 | 支持 |

### 5.2 能力探测

- 应用启动时探测受信任的 Host，不使用普通查询参数打开 Photoshop 能力。
- Host 存在并完成握手后选择 CCX adapter。
- Host 不存在时选择 Browser adapter，应用仍可完整进入工作台和设置。
- Host 暂时中断时保留用户输入，停止发出新的 Photoshop 命令，并提供恢复路径。
- 能力状态由应用层决定控件是否存在，不能只用 CSS 隐藏。

### 5.3 浏览器规则

- 浏览器是正式生产运行时，不是 UI 预览或 Mock Host。
- 画布、选区、当前图层抓取入口不渲染。
- 结果置入按钮、菜单、快捷键和无障碍节点不渲染。
- 不生成 Mock 画布图来填补缺失能力。
- Provider 配置、真实请求、轮询、取消、结果和历史可用。
- Browser adapter 负责浏览器持久化和凭据存储边界。
- CORS、混合内容、鉴权、限流和网络错误必须转成用户可操作的提示。

### 5.4 CCX 规则

- CCX 内的 WebUI 与浏览器版同源构建，不依赖公网 WebUI 才能启动。
- WebUI 通过受信任消息桥请求 Host 能力，不直接调用 Photoshop API。
- 大图使用 asset ID、受控缩略图或分块策略，避免在消息桥重复复制完整 RGBA。
- API Key 只保存在 UXP SecureStorage，不把明文回传 WebUI。
- 文件 token、imaging、modal execution 和原生确认全部留在 Host。
- 修改文档状态的操作进入 `core.executeAsModal()`。
- 新增 Photoshop 能力遵循 `canvasPrimitives.ts` 到 `canvasPrimitiveService.ts` 的分层。

## 6. Runtime 合同

WebUI 应依赖能力导向合同，名称可在实现中调整，但语义至少覆盖：

```ts
interface MugenRuntime {
  kind: 'browser' | 'photoshop-ccx'
  capabilities: {
    photoshopRead: boolean
    photoshopPlace: boolean
    secureCredentials: boolean
  }
  settings: SettingsPort
  providers: ProviderPort
  assets: AssetPort
  photoshop?: PhotoshopPort
}
```

- 共同业务不根据全局对象到处分支。
- Browser adapter 不实现假的 `PhotoshopPort`。
- CCX adapter 的 Photoshop 命令有明确 timeout、取消和错误映射。
- Host 消息经过 schema、会话和命令白名单校验。
- 协议如需破坏性变化，升级协议版本并记录 CCX/WebUI 兼容矩阵。

## 7. 配置与凭据

- 共同配置包括当前激活配置、Provider、模型、名称、启用状态、Base URL、生成默认参数、主题与预设提示词。
- 浏览器配置保存在当前 Origin；凭据只用于用户选择的 Provider 请求，不进入日志或分析。
- 浏览器无法跨域访问的 Provider 给出明确说明，不静默切换代理。
- CCX 非敏感配置保存在 UXP 数据目录，API Key 保存在 UXP SecureStorage。
- WebUI 只读取 CCX 凭据是否存在等状态，不读取明文。
- Host 负责最终 URL 安全校验和网络权限边界。

## 8. Photoshop 工作流

### 8.1 参考图抓取

- 可见画布抓取当前文档可见合成结果。
- 选区抓取选区内所有可见内容，并保留 `sourceBounds`。
- 当前图层抓取 active layer 像素。
- 无文档、无有效选区或无活动图层时返回可读错误。
- 图像对象统一保留 ID、标签、宽高、预览、像素和边界。

### 8.2 结果置入

- 支持全画布、当前选区和本轮参考图选区目标。
- 置入前按目标区域转换并缩放像素。
- Host 创建新像素图层并写入结果。
- 置入成功返回文档、图层和边界确认数据。
- 失败不破坏结果卡片和下一次重试。

## 9. APIMart 测试夹具

- 支持模型列表、参考图上传、生成提交、任务查询、图片获取、状态重置和请求记录。
- 所有成功结果固定使用同一张小猫 fixture。生成数量大于一时可以多次引用同一内容。
- 创建任务、轮询和最终下载保持相同内容，禁止随机抽取猫图。
- 错误路径至少覆盖无效或过期 Key、权限、额度、限流、服务端临时错误、超时和取消。

## 10. 测试矩阵

### 10.1 共享自动化

- 组件、状态和 Provider 单元测试。
- 预设提示词回归。
- runtime capability 渲染测试。
- 设置持久化与迁移测试。
- 生产 bundle 扫描，拒绝 Electron runtime 和 Mock Host 注入。

### 10.2 浏览器 E2E

1. 打开普通浏览器 WebUI。
2. 新建 APIMart 配置并填写 loopback Base URL 与测试 Key。
3. 测试配置、保存并刷新页面。
4. 发送生成请求并等待任务完成。
5. 显示固定小猫结果。
6. 验证请求记录中的上传、生成、轮询和下载。
7. 验证一次错误与一次取消或超时路径。
8. 验证 Photoshop 专属入口在 DOM、菜单、焦点和快捷键中均不存在。

### 10.3 CCX 实机 E2E

1. 安装正式构建的 CCX 并打开 WebUI。
2. 打开已知测试文档。
3. 抓取可见画布、选区或当前图层并检查预览与边界。
4. 使用 APIMart 配置发送参考图和提示词。
5. 完成上传、生成、轮询和固定小猫获取。
6. 选择目标并置入文档。
7. 断言新图层存在，位置、尺寸和内容正确。
8. 把结果继续作为参考，确认工作流仍可继续。

自动化单元测试、浏览器 Mock 或静态 UXP 校验不能替代该流程。

## 11. 迁移与完成定义

迁移顺序：冻结归档线，建立模块映射，平移共同应用，实现双 adapter，完成浏览器冒烟，完成 CCX 实机冒烟，再进入发布。

只有以下证据全部存在时，WebUI vNext 才能标记完成：

- Electron UI 源码迁移映射与代码评审通过。
- 没有 Electron runtime 依赖进入生产 WebUI。
- 浏览器和 CCX 从同一生产 UI 构建。
- 浏览器网络、配置和固定小猫冒烟通过，且无 Photoshop 入口。
- CCX 在真实 Photoshop 完成抓取、请求、取图与置入。
- 构建、版本、来源和发布门禁全部通过。

## 12. 历史归档

Inner WebUI 0.1 曾采用线上或本地 WebView、`inner-host/v1`、Mock Host 和 CCX Host 的方案，并完成部分协议、单元、Playwright、静态 UXP 与公网验证。旧 PRD 还记录过 Web Host 热发布、Electron 双轨灰度和退出门禁。这些内容描述旧阶段，不再是 vNext 的产品或工程要求。

`ref/electron-bridge-architecture.md` 和 `docs/inner-webui-deployment.md` 继续保留旧架构与部署历史；开发新功能时不得把其中的 Electron Bridge 或 Inner WebUI 0.1 发布流程恢复为活动依赖。

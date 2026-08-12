# 项目基线

日期：2026-08-11
阶段：Mugen vNext 开发

## 当前项目定位

Mugen 是一个同时运行在普通浏览器和 Photoshop CCX 中的图像生成工作台。浏览器版负责配置、网络生成和结果处理；CCX 版在相同工作台上增加 Photoshop 画布读取与结果置入能力。官网是只承载品牌、CCX 下载和 WebUI 入口的单屏页面。

## 生命周期

| 组件 | 状态 | 说明 |
| --- | --- | --- |
| 官方单屏站点 vNext | 开发中 | 毛笔书法 `Mugen`、Three.js 三棱镜折射、液态玻璃按钮、CCX 标本号 |
| Inner WebUI vNext `0.2.0` | 开发中 | 从 Electron UI 源码平移，支持 CCX 与独立浏览器 |
| Photoshop CCX `1.1.0` | 活动 | 插件 ID `com.tanshow.mugen`；继续提供画布、置入、Adobe SecureStorage 和原生权限 |
| APIMart 本地测试夹具 | 活动 | 双运行时冒烟；所有成功图片固定为同一张小猫 |
| Electron 桌面端 `0.3.19` | 已废弃 | 根版本被冻结，不再开发或发布；UI 源码仅作迁移来源与历史证据 |
| Inner WebUI 0.1.0 | 已废弃 | 不再作为生产 UI、兼容目标或验收基线 |
| 旧官网实现 | 已废弃 | 不再作为页面结构或文案来源 |
| Standalone UXP 插件原型 | 已删除 | 已退出源码、构建、测试和版本链 |

## 目标技术边界

- WebUI 使用 Vue 3、Vite、TypeScript 与 Pinia，并平移原 Electron UI 的现有样式和组件结构。
- 官网背景使用 Three.js；主品牌字使用 ImageGen 生成并超分后的位图资源。
- WebUI 业务组件只依赖运行时能力合同。
- Browser adapter 提供真实网络、配置和浏览器持久化，不提供 Photoshop 能力。
- CCX Host adapter 通过受信任消息桥提供 Photoshop 与 UXP 能力。
- Photoshop 文档修改仍由 CCX Host 在 `core.executeAsModal()` 中执行。
- CCX API Key 只进入 UXP SecureStorage；浏览器凭据由浏览器适配层管理。
- CCX 与浏览器使用同源 WebUI，不维护两套生产组件。

## 开发不变量

- vNext 必须平移原 Electron UI 的 Vue、TypeScript、状态、Provider、预设、结果流和主题代码，不能按截图复刻。
- Electron runtime、preload、IPC、Bridge Server 和桌面窗口不得成为 WebUI vNext 依赖。
- 普通浏览器中完全移除画布、选区、图层读取和 Photoshop 置入入口，不提供 Mock 占位。
- CCX 中保留完整 Photoshop 工作流。
- 新增画布能力先进入 `plug-in/src/ccx/canvasPrimitives.ts`，再由 `plug-in/src/ccx/canvasPrimitiveService.ts` 暴露。
- 生产运行时不自动启用 Mock Host 或 APIMart 测试配置。

## 当前代码入口

| 模块 | 当前用途 |
| --- | --- |
| `webui/src/components/mugen/` | Electron UI 的共享组件与 vNext 平移来源 |
| `webui/src/composables/useMugen.ts` | 原工作台状态和行为的迁移来源 |
| `packages/mugen-core/src/providers/` | Provider 合同、能力、注册与 wire 兼容逻辑 |
| `webui/src/` | WebUI vNext 目标工程；旧 0.1 入口应被替换 |
| `packages/inner-protocol/src/` | CCX Host 消息合同；按 vNext 兼容需要演进 |
| `plug-in/src/ccx/main.ts` | CCX panel、会话和 Host 注册 |
| `plug-in/src/ccx/inner/` | CCX 资产、历史、Provider、存储与确认能力 |
| `plug-in/src/ccx/canvasPrimitiveService.ts` | 画布业务服务层 |
| `plug-in/src/ccx/canvasPrimitives.ts` | Photoshop imaging、选区、图层与写入原语 |
| `utils/apimart-smoke-server.mjs` | vNext APIMart 固定小猫 fixture、状态与请求记录 |
| `utils/mock-image-api-server.mjs` | 历史多 Provider Mock 回归 |
| `site/` | 官方单屏站点 vNext 目标目录；旧内容已废弃 |

## 常用命令

```bash
npm install
npm run dev:inner-webui
npm run build:inner-webui
npm run verify:inner-webui:release
npm run smoke:apimart-server
npm run verify:ccx
npm run package:ccx
npm run build:site
```

在 vNext 测试与构建脚本更新完成前，旧 `verify:inner-webui:release` 的通过结果只代表 0.1 基线，不足以证明浏览器独立运行、Electron UI 平移或双运行时能力裁剪完成。正式验收以 `docs/mugen-prototype-requirements.md` 和 `docs/build-todo-list.md` 为准。

## 必要验证

### 浏览器

- 完成 APIMart 配置的新建、测试、保存和重载。
- 真实调用本地 APIMart fixture 并显示固定小猫结果。
- 验证错误与取消路径。
- 验证 DOM、焦点与快捷键中没有 Photoshop 读取或置入入口。

### CCX

- 执行 `npm run verify:ccx`。
- 修改 Manifest、entrypoint、icon 或权限后在 UXP Developer Tools 中 Unload/Load；普通 Vue、TypeScript、CSS 变更后 Reload。
- 在真实 Photoshop 中完成画布抓取、APIMart 上传与生成、固定小猫获取、结果置入和新图层断言。

### 官网

- 验证单屏、毛笔书法资源、Three.js 可旋转棱镜与正确折射、液态玻璃按钮和 CCX 标本号。
- 验证 WebGL/减少动态兜底、键盘操作、移动视口与资源性能。
- 发布前执行完整发行物与 SHA256 门禁。

## 已有历史证据

截至 2026-08-11，旧基线曾通过 `inner-host/v1` 协议测试、Inner WebUI 0.1 单元与构建测试、部分 Playwright E2E、CCX Host 单元测试、CCX 静态打包和公网 WebUI 校验。`dist/mugen-1.0.0.ccx` 也曾被生成并校验。真实 Photoshop 中的旧 Inner WebUI 完整闭环尚未形成发布证据。

这些事实只保留为回归参考。它们不证明 vNext 已完成。

## 文档入口

- `docs/spec.md`：当前产品决策与验收边界。
- `docs/mugen-prototype-requirements.md`：vNext 功能与双运行时测试需求。
- `docs/inner-webui-prd.md`：WebUI 源码平移、runtime adapter 和迁移门禁。
- `docs/mugen-interaction-spec.md`：工作台与双运行时交互。
- `docs/build-todo-list.md`：版本、CCX、官网与发布门禁。
- `docs/mock-image-api-server.md`：APIMart 本地夹具。
- `docs/ref/canvas-primitives.md`：画布交互原语。
- `docs/ref/atomic-capabilities.md`：UXP 原子能力。
- `docs/ref/framework-build.md`：框架和构建。
- `docs/ref/development-notes.md`：UDT 与 Photoshop 实机注意事项。

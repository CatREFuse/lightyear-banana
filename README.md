# Mugen

Mugen vNext 是一个同时运行在普通浏览器和 Photoshop CCX 中的图像生成工作台。

浏览器版提供 Provider 配置、网络生成和结果流。CCX 版使用同一套 WebUI，并增加 Photoshop 画布读取、选区、图层和结果置入能力。

## 当前阶段

| 组件 | 状态 |
| --- | --- |
| 官方单屏站点 vNext | 开发中 |
| Inner WebUI vNext `0.2.2` | 开发中 |
| Photoshop CCX `1.1.6` | 活动 |
| APIMart 本地测试夹具 | 活动 |
| Inner WebUI 0.1 | 已废弃 |
| 旧官网 | 已废弃 |
| Standalone UXP 原型 | 已删除 |

原 Electron UI 源码已整体移除（2026-08-12），WebUI vNext 为独立实现，不依赖 Electron runtime、preload、IPC 或本地 Bridge。

## 运行时

### 浏览器

- Provider 配置与测试。
- API Key、模型和 Base URL 管理。
- 真实网络生成、轮询、取消和结果查看。
- 不显示 Photoshop 画布、选区、图层读取或置入入口。

### Photoshop CCX

- 包含与浏览器版同源构建的 WebUI。
- 通过 CCX Host 抓取可见画布、选区和当前图层。
- 通过 CCX Host 把生成结果置入当前文档。
- API Key 保存在 UXP SecureStorage。

插件 ID：`com.tanshow.mugen`

## 开发

```bash
npm install
npm run dev:inner-webui
npm run smoke:apimart-server
npm run build:inner-webui
npm run verify:inner-webui:release
npm run verify:ccx
npm run package:ccx
npm run build:site
```

当前自动化验收覆盖 WebUI vNext 0.2 的浏览器配置与网络生成，以及 CCX Host 协议级画布抓取、请求、小猫结果和置入流程。真实 Photoshop 实机闭环仍按发布门禁单独执行。验收基线请查看：

- `docs/spec.md`
- `docs/mugen-prototype-requirements.md`
- `docs/inner-webui-prd.md`
- `docs/build-todo-list.md`
- `docs/ref/project-baseline.md`

## 测试

APIMart 本地夹具固定返回同一张小猫。

浏览器冒烟覆盖配置新建、测试、保存、重载、真实网络生成、结果展示和 Photoshop 入口缺失。

CCX 冒烟必须在真实 Photoshop 中完成画布抓取、APIMart 请求、小猫图片获取、结果置入和新图层验证。

## CCX 开发约定

- 新增画布能力先写入 `plug-in/src/ccx/canvasPrimitives.ts`，再由 `plug-in/src/ccx/canvasPrimitiveService.ts` 暴露。
- Vue 组件和 composable 不直接拼复杂 `batchPlay` descriptor。
- 修改 Photoshop 文档状态的操作进入 `core.executeAsModal()`。
- 修改 Vue、TypeScript 或 CSS 后执行 `npm run build:ccx`，再在 Adobe UXP Developer Tools 中 Reload。
- 修改 Manifest、entrypoint、icon 或权限后执行 `npm run verify:ccx`，再在 Adobe UXP Developer Tools 中 Unload/Load。

## 历史归档

Electron `0.3.x` 桌面端源码与打包链路已于 2026-08-12 移除，历史发行记录见 `docs/build-todo-list.md`。旧官网、Inner WebUI `0.1.0` 与旧 Bridge 架构仅用于历史追溯。Standalone UXP 原型源码和构建入口已从活动仓库删除。

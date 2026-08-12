# 开发框架与构建参考

日期：2026-08-11

## 当前技术路线

Mugen vNext 有两个前端交付物和一个 Photoshop Host：

| 交付物 | 技术 | 作用 |
| --- | --- | --- |
| Inner WebUI vNext | Vue 3、Composition API、TypeScript、Vite、Pinia | 浏览器与 CCX 共用工作台 |
| 官方单屏站点 | HTML/CSS/JavaScript、Three.js | 品牌、CCX 下载和 WebUI 入口 |
| CCX Host 壳 | Photoshop UXP Manifest v5、classic IIFE bundle | WebView、消息桥、画布、置入和 SecureStorage |

原 Electron UI 是 WebUI 的源码平移来源。Electron runtime、preload、IPC、本地 Bridge 和桌面窗口不进入 vNext 生产构建。

## 目录职责

```text
webui/          WebUI vNext 工程与静态构建
packages/inner-protocol/  Host 合同、schema 和兼容信息
webui/src/components/mugen/     原 Electron UI 组件与迁移来源
webui/src/composables/          原工作台行为与迁移来源
packages/mugen-core/src/providers/            Provider 合同、能力、注册和 wire 语义
plug-in/src/ccx/main.ts           CCX entrypoint、会话与 WebView Host
plug-in/src/ccx/inner/            消息桥、资产、存储、Provider 与确认
plug-in/src/ccx/canvasPrimitives.ts       Photoshop 原子能力
plug-in/src/ccx/canvasPrimitiveService.ts 画布业务服务层
site/                     官方单屏站点
plugin/                   当前 CCX Manifest 和图标
```

独立 UXP 技术原型已经删除，不参与源码、构建、测试或版本链。

## WebUI 构建规则

- WebUI 使用相对资源路径，确保普通静态部署和 `plugin:/webui/index.html` 都能加载。
- Browser adapter 与 CCX Host adapter 从同一源码构建。
- 运行时能力通过受信任 Host 探测选择，不使用 URL 参数伪造。
- Browser adapter 不注入 Mock Host，也不实现假的 Photoshop API。
- 生产 bundle 不包含 Electron runtime、preload、IPC 或 Bridge 模块。
- CCX 构建把完整 `webui/dist/` 复制到 `dist/ccx-host/webui/`。
- CCX 启动依赖本地内嵌 WebUI，不依赖公网 WebUI。

## CCX Host 构建规则

`vite.ccx.config.ts` 负责生成 Adobe Photoshop 可加载的 CCX Host 壳：

- `base: "./"` 保持 Host 资源相对路径。
- Rollup 使用 IIFE，Host 入口不保留 ESM runtime。
- Host HTML 使用 classic script。
- 构建后复制 `plug-in/manifest.json`、icons 和 WebUI 静态目录。
- 生产 WebView 入口为 `plugin:/webui/index.html`。
- 本地 WebView 使用 `allowLocalRendering: "yes"` 与 `enableMessageBridge: "localOnly"`。
- WebUI 与 Host 的协议和兼容元数据进入静态校验。
- production mode 固定注入 `__MUGEN_APP_ENV__ = "production"`；设置 `VITE_MUGEN_ENV` 或 `MUGEN_ENV` 为 `development` / `test` 时构建直接失败。

## Manifest 基线

- `manifestVersion: 5`。
- `id: "com.tanshow.mugen"`。
- `name: "Mugen"`。
- host 为 Photoshop，版本要求与当前发布策略一致。
- panel 与 command ID 和 `plug-in/src/ccx/main.ts` 的 `entrypoints.setup()` 一致。
- WebView 只允许本地打包页面通过 local-only bridge 通信。
- 修改 ID、entrypoint、icon、权限或 WebView 配置后重新构建，并在 Adobe UXP Developer Tools 中 Unload/Load。

版本号以 `plug-in/manifest.json` 和 `docs/build-todo-list.md` 的活动发布链为准，不从历史示例复制。

## 静态校验

`plug-in/scripts/verify-ccx-build.mjs` 至少校验：

- `dist/ccx-host/manifest.json`、Host HTML、icons 和 `webui/index.html` 存在。
- Manifest v5、插件 ID、host、entrypoint 和 WebView 权限正确。
- Host HTML 使用 classic script。
- WebUI 资源完整且使用可在 `plugin:/` 下加载的相对路径。
- `webui/dist/` 与 `dist/ccx-host/webui/` 的文件集和每个文件的字节完全一致，且两份 `release.json` 的 `contentHash` 可复算。
- 两份 WebUI `release.json` 都声明活动版本 `0.2.0` 并绑定当前 Git HEAD；本地 `verify:ccx` 要求 `dirty` 与实际工作树状态一致，正式 `package:ccx` 进一步要求干净工作树和 `dirty: false`。
- CCX 归档生成后逐文件核对归档文件集与最终 staging 目录的字节哈希；`dist/ccx-release.json` 的 `sourceCommit` 必须绑定同一干净提交。
- Host bundle 不包含 `eval`、`new Function`、动态 `import()` 或 `import.meta`。
- 正式 CCX 产物不包含 smoke 全局对象、MockHost、fixture key、`/__smoke/` 路由或开发域名。
- WebUI bundle 不包含 Electron runtime 或生产 Mock Host 注入。
- 协议与版本兼容信息一致。

静态校验不能替代真实 Photoshop 的抓取、请求、取图和置入闭环。

## UI 写法

- WebUI 组件使用 `<script setup lang="ts">` 和明确类型。
- 派生状态使用 `computed`；大型 RGBA、Photoshop handle 和文件对象避免深层响应式。
- 组件只消费 runtime capability contract，不直接访问 Electron IPC、UXP `require()` 或复杂 `batchPlay`。
- Photoshop API 细节保留在 `plug-in/src/ccx/`。
- CCX Host 壳使用 Adobe 稳定控件；WebView 工作台与普通浏览器共享原 Electron UI 平移后的浏览器组件。
- 浏览器中不渲染 Photoshop 抓取和置入入口。

## 常用命令

```bash
npm run dev:inner-webui
npm run build:inner-webui
npm run verify:inner-webui:release
npm run smoke:apimart-server
npm run build:ccx
npm run verify:ccx
npm run package:ccx
npm run build:site
```

在 vNext 脚本更新完成前，旧 `verify:inner-webui:release` 的绿色结果可能只覆盖 0.1 行为。是否达到发布标准必须对照 `docs/mugen-prototype-requirements.md` 和 `docs/build-todo-list.md` 的双运行时门禁。

## 开发循环

修改 WebUI 的 Vue、TypeScript 或 CSS 后，构建 WebUI、运行相关测试、执行 `npm run build:ccx`，再在 Adobe UXP Developer Tools 中 Reload。

修改 Manifest、entrypoint、icon、权限或 WebView 配置后，执行 `npm run verify:ccx`，在 Adobe UXP Developer Tools 中 Unload，再重新 Load `dist/ccx-host/manifest.json`，最后在真实 Photoshop 中回归受影响能力。

正式完成仍需 APIMart 浏览器冒烟和 Photoshop CCX 完整冒烟。

## 历史说明

早期技术原型曾把 Vue 直接挂载到 Adobe panel，并通过 IIFE 和浏览器 fallback 验证画布原语。该代码已经删除。当前产品使用 CCX Host 壳承载本地 WebView，不得恢复旧直挂原型替代 vNext WebUI。

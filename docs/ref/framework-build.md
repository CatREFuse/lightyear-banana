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

- WebUI 使用相对资源路径，确保 `https://mugen.catrefuse.com/webui/` 和 Hash Router 可以独立部署。
- Browser adapter 与 CCX Host adapter 从同一源码构建。
- 运行时能力通过受信任 Host 探测选择，不使用 URL 参数伪造。
- Browser adapter 不注入 Mock Host，也不实现假的 Photoshop API。
- 生产 bundle 不包含 Electron runtime、preload、IPC 或 Bridge 模块。
- WebUI 构建和部署独立于 CCX；`webui/dist/` 不复制到 `dist/ccx-host/`。
- CCX WebView 固定加载 `https://mugen.catrefuse.com/webui/`，云端 WebUI 保持 `inner-host/v1` 兼容时可以独立更新。

## CCX Host 构建规则

`vite.ccx.config.ts` 负责生成 Adobe Photoshop 可加载的 CCX Host 壳：

- `base: "./"` 保持 Host 资源相对路径。
- Rollup 使用 IIFE，Host 入口不保留 ESM runtime。
- Host HTML 使用 classic script。
- 构建后复制 `plug-in/manifest.json` 和 icons，不复制 WebUI 静态目录。
- 生产 WebView 入口为 `https://mugen.catrefuse.com/webui/`。
- WebView Manifest 只授权 `https://mugen.catrefuse.com`，使用 `enableMessageBridge: "localAndRemote"`，不启用本地渲染。
- Host bundle 的协议标记、固定 URL 和 Origin 权限进入静态校验。
- production mode 固定注入 `__MUGEN_APP_ENV__ = "production"`；设置 `VITE_MUGEN_ENV` 或 `MUGEN_ENV` 为 `development` / `test` 时构建直接失败。

## Manifest 基线

- `manifestVersion: 5`。
- `id: "com.tanshow.mugen"`。
- `name: "Mugen"`。
- host 为 Photoshop，版本要求与当前发布策略一致。
- panel 与 command ID 和 `plug-in/src/ccx/main.ts` 的 `entrypoints.setup()` 一致。
- WebView 只允许 `https://mugen.catrefuse.com` 通过 `localAndRemote` bridge 通信。
- 修改 ID、entrypoint、icon、权限或 WebView 配置后重新构建，并在 Adobe UXP Developer Tools 中 Unload/Load。

版本号以 `plug-in/manifest.json` 和 `docs/build-todo-list.md` 的活动发布链为准，不从历史示例复制。

## 静态校验

`plug-in/scripts/verify-ccx-build.mjs` 至少校验：

- `dist/ccx-host/manifest.json`、Host HTML、icons 和 Host JavaScript 存在，且 `webui/` 目录不存在。
- Manifest v5、插件 ID、host、entrypoint 和 WebView 权限正确。
- Host HTML 使用 classic script。
- Host bundle 只包含固定云端 WebUI URL，不包含 `plugin:/webui/`。
- Manifest 的 WebView domains 精确等于正式 Origin，不包含 `allowLocalRendering`，消息桥为 `localAndRemote`。
- CCX 归档生成后逐文件核对归档文件集与最终 staging 目录的字节哈希；`dist/ccx-release.json` 的 `sourceCommit` 绑定 CCX Host 的干净提交。
- Host bundle 不包含 `eval`、`new Function`、动态 `import()` 或 `import.meta`。
- 正式 CCX 产物不包含 smoke 全局对象、MockHost、fixture key、`/__smoke/` 路由或开发域名。
- 协议与版本兼容信息一致。

静态校验不能替代真实 Photoshop 的抓取、请求、取图和置入闭环。

## UDT 兼容打包格式

Windows 正式 CCX 由 `plug-in/scripts/package-ccx.mjs` 从已验证的 `dist/ccx-host/` 生成。脚本使用 `udt-compatible-zip.mjs` 写出与 Adobe UXP Developer Tools `Package` 产物一致的关键 ZIP 特征；PowerShell `Compress-Archive` 和系统右键压缩不能直接生成正式发行包。

UDT 产物具有以下可校验特征：

- CCX 是 ZIP 容器，归档根目录直接包含 `manifest.json`、`ccx-panel.html`、`assets/` 与 `icons/`，不能再套一层父目录，也不能包含 `webui/` 目录或独立目录条目。
- 归档中的 Manifest 必须保持 `manifestVersion: 5`、`id: "com.tanshow.mugen"`、`host.app: "PS"`，版本必须与 `plug-in/manifest.json` 和 `dist/ccx-host/manifest.json` 一致。
- `manifest.json` 排在首项，并移除末尾的单个 LF 或 CRLF，与 UDT 的 Manifest 行为一致；发布校验只对这一处换行差异做归一化，其他文件仍逐字节匹配 `dist/ccx-host/`。
- 文件使用 Deflate、ZIP 数据描述符、Unix create-system 元数据和 `0644` 权限，避免 Windows 通用压缩器产生的权限与条目标记差异。
- 归档文件集必须与已验证的 `dist/ccx-host/` 完全一致，不能包含额外父目录、源码映射、开发入口或临时文件。
- `plug-in/scripts/package-ccx.mjs` 从不可变 staging 快照生成 `dist/mugen-<version>.ccx`，随后逐文件回读归档并生成 `.sha256` 与 `dist/ccx-release.json`。
- 正式打包要求干净工作树。CCX 发布元数据和归档内容绑定同一个 CCX Host Git HEAD，不绑定 WebUI 部署提交。

Windows 操作顺序：

```text
npm run verify:ccx
npm run package:ccx:local
```

可将同一 `dist/ccx-host/manifest.json` 交给 UDT `Package` 生成对照包，比较条目和 ZIP 元数据，但正式产物无需依赖 UDT 图形操作。最终分发验收仍使用资源管理器双击 `dist/mugen-<version>.ccx`，确认 Creative Cloud 显示第三方插件提示、安装完成并能在 Photoshop 中打开。命令行 `/install` 只用于诊断，不能作为分发验收结果。

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

修改 WebUI 的 Vue、TypeScript 或 CSS 后，构建、测试并独立部署 WebUI；保持 `inner-host/v1` 兼容时无需重新构建 CCX。协议或 CCX Host adapter 发生不兼容变化时，发布对应 CCX 并在 Adobe UXP Developer Tools 中 Reload。

修改 Manifest、entrypoint、icon、权限或 WebView 配置后，执行 `npm run verify:ccx`，在 Adobe UXP Developer Tools 中 Unload，再重新 Load `dist/ccx-host/manifest.json`，最后在真实 Photoshop 中回归受影响能力。

正式完成仍需 APIMart 浏览器冒烟和 Photoshop CCX 完整冒烟。

## 历史说明

早期技术原型曾把 Vue 直接挂载到 Adobe panel，并通过 IIFE 和浏览器 fallback 验证画布原语。该代码已经删除。当前产品使用 CCX Host 壳承载云端 WebUI，不得恢复旧直挂原型替代 vNext WebUI。

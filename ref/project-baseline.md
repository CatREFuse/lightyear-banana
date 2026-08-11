# 项目基线

## 项目定位

Mugen 是 Photoshop UXP 生图插件。当前架构由 CCX Host、`inner-host/v1` 消息协议和线上 Inner WebUI 组成；Electron 0.3.x 进入维护状态。

当前技术栈：

- Vue 3
- Vite
- TypeScript
- Tailwind CSS
- Pinia
- Vue Router
- Photoshop UXP Manifest v5
- CCX Host `1.0.0`
- Inner WebUI `0.1.0`

## 当前已经验证

- `npm run verify:inner-webui:release` 已通过协议、WebUI 单元测试、生产构建和两种面板宽度的 Playwright E2E。
- UXP Host 已通过资产生命周期、用户确认、历史、Provider、安全 URL、选区绑定和 SecureStorage 测试。
- `npm run package:uxp` 已生成并校验 `dist/mugen-1.0.0.ccx`、SHA256 和 `dist/uxp-release.json`。
- Inner WebUI `0.1.0` 已部署到 `https://mugen.catrefuse.com/inner/v1/`，公网资源、发布元数据、安全响应头和 releases 索引通过正式门禁。
- 真实 Photoshop 中的 Inner WebUI 完整业务回归仍是正式发布前门禁。

## 常用命令

```bash
npm install
npm run dev:inner-webui
npm run verify:inner-webui:release
npm run verify:inner-webui:public
npm run verify:uxp
npm run package:uxp
```

命令含义：

- `npm run dev:inner-webui`：使用 Mock Host 启动普通浏览器开发环境。
- `npm run verify:inner-webui:release`：运行协议、WebUI、构建和 E2E 门禁。
- `npm run verify:inner-webui:public`：逐字节校验已部署 WebUI，并校验 releases 索引与响应头。
- `npm run verify:uxp`：构建并静态校验 UXP 产物。
- `npm run package:uxp`：完成全部生产门禁并生成带来源元数据的 `.ccx` 包。

加载到 Photoshop 时选择：

```text
dist/ps-uxp/manifest.json
```

## 运行时边界

普通浏览器使用 Mock Host，不具备 Photoshop 能力。真实 WebView 仅通过 `window.uxpHost` 和 CCX Host 通信；BYOK 密钥只进入 UXP SecureStorage。Photoshop API、文件 token、modal execution、imaging 与原生确认必须在 UXP 运行时验证。

## 核心源码入口

| 模块 | 作用 |
| --- | --- |
| `apps/inner-webui/src` | Vue 3 Inner WebUI、路由、工作台、设置和 Mock Host |
| `packages/inner-protocol/src` | `inner-host/v1` envelope、命令、事件、校验和 Provider 能力单一数据源 |
| `src/uxp/main.ts` | 注册 UXP command、panel、会话和 WebView Host |
| `src/uxp/inner` | 会话、命令、资产、历史、Provider、SecureStorage 和原生确认 |
| `src/uxp/canvasPrimitiveService.ts` | 面向业务的画布交互服务层 |
| `src/uxp/canvasPrimitives.ts` | Photoshop imaging、选区、图层、写入像素等底层原语 |
| `vite.uxp.config.ts` | UXP 专用 Vite 构建适配 |
| `scripts/deploy-inner-webui.mjs` | WebUI 原子部署、回滚和公网门禁 |
| `scripts/verify-uxp-build.mjs` | UXP 产物静态校验 |

## 文档入口

- `ref/canvas-primitives.md`：画布交互原语。
- `ref/atomic-capabilities.md`：可复用原子能力。
- `ref/framework-build.md`：框架和构建。
- `ref/development-notes.md`：开发注意事项。
- `docs/inner-webui-prd.md`：Inner WebUI 产品规格、协议、迁移和上线门禁。


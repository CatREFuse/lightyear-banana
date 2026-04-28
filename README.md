# Lightyear Banana

Photoshop + Electron 生图工作台实验项目。Electron 承载主工作台和本地 Bridge，UXP 插件只负责连接状态和 Photoshop 画板操作。

## 已验证

- `npm run verify:uxp` 能生成并校验 `dist/ps-uxp`。
- UXP Developer Tools 能加载 `dist/ps-uxp/manifest.json`。
- Photoshop 2026 `27.3.0` 能执行 `增效工具 > Lightyear Banana > 创建图层`。
- Electron App 能从 `http://127.0.0.1:38321/app/?runtime=electron` 加载 Web 工作台。
- UXP 插件能通过本地 HTTP long-poll Bridge 连接 Electron App。
- Electron Renderer 能读取 Photoshop 连接状态，并通过 Bridge 发起 Photoshop 操作。
- Mock Image API 默认运行在 `http://127.0.0.1:38322`，用于本地调试生图流程。

## 常用命令

```bash
npm install
npm run dev
npm run mock:image-api
npm run start:electron
npm run dev:electron
npm run build:web
npm run verify:uxp
node standalone-uxp-plugin/verify.mjs
node standalone-uxp-plugin/smoke-test.mjs
node standalone-uxp-plugin/package.mjs
```

加载到 Photoshop 时选择：

```text
dist/ps-uxp/manifest.json
```

## 关键文档

- [开发参考入口](ref/README.md)
- [Electron Web App + UXP Bridge 架构](ref/electron-bridge-architecture.md)
- [技术原型功能需求](docs/lightyear-banana-prototype-requirements.md)
- [技术原型交互规格](docs/lightyear-banana-interaction-spec.md)
- [Photoshop 画板交互原语参考](docs/canvas-primitives-reference.md)
- [UXP 开发最佳实践报告](docs/uxp-development-best-practices-report.md)
- [UXP cookbook](docs/uxp-cookbook.md)
- [研究记录](docs/research-notes.md)

## 独立 UXP 子插件

`standalone-uxp-plugin/` 是一个无需 Vite 构建的独立 Photoshop UXP 插件原型。加载到 Photoshop 时选择：

```text
standalone-uxp-plugin/manifest.json
```

# 项目基线

## 项目定位

Lightyear Banana 是 Photoshop UXP 插件实验项目。当前目标是建立一套可持续扩展的 Photoshop 画布交互基础层，并用 Vue 面板验证抓图和插图能力。

当前技术栈：

- Vue 3
- Vite
- TypeScript
- Photoshop UXP Manifest v5
- Photoshop 2026 `27.3.0`
- UXP Developer Tools `2.2.1`

## 当前已经验证

- `npm run verify:uxp` 可以生成并校验 `dist/ps-uxp`。
- UXP Developer Tools 可以加载 `dist/ps-uxp/manifest.json`。
- Photoshop 菜单 `增效工具 > Lightyear Banana > 创建图层` 可以创建图层。
- 面板 entrypoint 可以触发 `panel create` / `panel show`。
- Vue 可以在 UXP panel 中完成挂载。
- 面板可以验证可见图像、选区图像、选中图层的抓取。
- 面板可以验证 sample 图片插入到全图、选区位置、指定坐标和尺寸。

## 常用命令

```bash
npm install
npm run dev
npm run build:uxp
npm run verify:uxp
npm run package:uxp
```

命令含义：

- `npm run dev`：浏览器预览 Vue UI，只用于 UI 状态检查。
- `npm run build:uxp`：构建 Photoshop UXP 产物。
- `npm run verify:uxp`：构建并静态校验 UXP 产物。
- `npm run package:uxp`：生成 `.ccx` 包。

加载到 Photoshop 时选择：

```text
dist/ps-uxp/manifest.json
```

## 运行时边界

浏览器预览没有 `globalThis.require("photoshop")`，所以只能验证 UI fallback。Photoshop API、文件 token、modal execution、imaging 相关能力必须在 UXP 运行时验证。

## 核心源码入口

| 模块 | 作用 |
| --- | --- |
| `src/uxp/main.ts` | 注册 UXP command 和 panel，挂载 Vue |
| `src/uxp/photoshopHost.ts` | 封装 UXP runtime 检测、Photoshop require、创建基础图层 |
| `src/uxp/canvasPrimitiveService.ts` | 面向业务的画布交互服务层 |
| `src/uxp/canvasPrimitives.ts` | Photoshop imaging、选区、图层、写入像素等底层原语 |
| `src/composables/useCanvasProbe.ts` | 面板状态和异步流程 |
| `src/components/CanvasProbePanel.vue` | 抓图/插图验证 UI |
| `vite.uxp.config.ts` | UXP 专用 Vite 构建适配 |
| `scripts/verify-uxp-build.mjs` | UXP 产物静态校验 |

## 文档入口

- `ref/canvas-primitives.md`：画布交互原语。
- `ref/atomic-capabilities.md`：可复用原子能力。
- `ref/framework-build.md`：框架和构建。
- `ref/development-notes.md`：开发注意事项。


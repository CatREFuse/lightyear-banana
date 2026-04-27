# Lightyear Banana 开发参考

本目录把当前实现、cookbook 和研究结论整理成可直接查阅的开发参考。开发时优先看这里，再回到 `docs/` 查更完整的历史记录。

## 文件路由

| 想查什么 | 先看 |
| --- | --- |
| 项目在做什么、当前验证到哪里、怎么运行 | `ref/project-baseline.md` |
| 当前原型标定了哪些功能 | `docs/lightyear-banana-prototype-requirements.md` |
| 工作台、结果流、设置页和 Photoshop 写入怎么交互 | `docs/lightyear-banana-interaction-spec.md` |
| Photoshop 画布抓图、选区、图层、插图等交互原语 | `ref/canvas-primitives.md` |
| UXP entrypoint、Photoshop host、imaging、modal、文件访问等原子能力 | `ref/atomic-capabilities.md` |
| Vue 3 + Vite + TypeScript + Manifest v5 的框架和构建方式 | `ref/framework-build.md` |
| UXP UI runtime、HTML/CSS 限制、Spectrum UXP Widgets、SWC wrapper 强制规则 | `ref/uxp-ui-runtime-rules.md` |
| 开发、调试、加载、验证、扩展时需要注意的事项 | `ref/development-notes.md` |
| 主流生图模型 API 格式、参考图上限和接入差异 | `ref/image-model-api-specs.md` |

## 源文件

这些参考来自当前仓库实现和已有文档：

- `README.md`
- `docs/lightyear-banana-prototype-requirements.md`
- `docs/lightyear-banana-interaction-spec.md`
- `docs/uxp-cookbook.md`
- `docs/canvas-primitives-reference.md`
- `docs/uxp-development-best-practices-report.md`
- `docs/research-notes.md`
- Adobe Premiere Pro / Photoshop / InDesign UXP 官方文档与 samples
- `src/uxp/main.ts`
- `src/uxp/photoshopHost.ts`
- `src/uxp/canvasPrimitives.ts`
- `src/uxp/canvasPrimitiveService.ts`
- `src/composables/useCanvasProbe.ts`
- `src/components/CanvasProbePanel.vue`
- `vite.uxp.config.ts`
- `plugin/manifest.json`
- `scripts/verify-uxp-build.mjs`
- 外部官方/准官方生图 API 文档

# Lightyear Banana

Photoshop UXP 插件最小实验项目，技术栈是 Vue 3 + Vite + TypeScript。

## 已验证

- `npm run verify:uxp` 能生成并校验 `dist/ps-uxp`。
- UXP Developer Tools 能加载 `dist/ps-uxp/manifest.json`。
- Photoshop 2026 `27.3.0` 能执行 `增效工具 > Lightyear Banana > 创建图层`。
- Vue 面板入口会触发 `panel create` / `panel show`，并完成 Vue 挂载。

## 常用命令

```bash
npm install
npm run dev
npm run verify:uxp
```

加载到 Photoshop 时选择：

```text
dist/ps-uxp/manifest.json
```

## 关键文档

- [Photoshop 画板交互原语参考](docs/canvas-primitives-reference.md)
- [UXP 开发最佳实践报告](docs/uxp-development-best-practices-report.md)
- [UXP cookbook](docs/uxp-cookbook.md)
- [研究记录](docs/research-notes.md)

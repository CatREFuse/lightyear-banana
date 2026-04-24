# 开发框架与构建参考

## 技术路线

当前项目继续使用：

- Vue 3
- Composition API
- `<script setup lang="ts">`
- Vite
- TypeScript
- Manifest v5
- 静态 IIFE bundle
- `globalThis.require("uxp")`
- `globalThis.require("photoshop")`

这个组合已经跑通构建、UDT 加载、command 调用、panel 挂载和画布交互验证。

## 推荐目录职责

```text
src/
  uxp/
    main.ts
    photoshopHost.ts
    canvasPrimitives.ts
    canvasPrimitiveService.ts
  composables/
    useCanvasProbe.ts
  components/
    CanvasProbePanel.vue
  App.vue
```

职责：

- `src/uxp/main.ts`：entrypoints、panel mount、command 注册。
- `src/uxp/photoshopHost.ts`：host runtime、Photoshop require、通用宿主方法。
- `src/uxp/canvasPrimitives.ts`：底层 Photoshop 原语。
- `src/uxp/canvasPrimitiveService.ts`：业务可调用服务层。
- `src/composables/`：状态、异步流程、错误信息。
- `src/components/`：展示控件和用户操作入口。
- `App.vue`：组合 feature，不承载大量 Photoshop 业务逻辑。

## Vite UXP 构建规则

UXP 面板加载本地静态文件。`vite.uxp.config.ts` 负责把 Vite 产物调整成 UXP 可加载形态：

- `base: "./"` 保持相对路径。
- `publicDir: false` 避免无关 public 资源进入 UXP 产物。
- `modulePreload.polyfill: false` 避免浏览器预加载 polyfill。
- Rollup `format: "iife"` 避免 ESM 运行时依赖。
- 构建后移除 HTML 里的 `type="module"` 和 `crossorigin`。
- 构建后把 `<script>` 移到 `#app` 之后。
- 构建后复制 `plugin/manifest.json` 和 `plugin/icons/`。

## 静态校验

`scripts/verify-uxp-build.mjs` 校验这些条件：

- `dist/ps-uxp/manifest.json` 存在。
- `dist/ps-uxp/uxp-panel.html` 存在。
- UXP icon 文件齐全。
- manifest 是 v5。
- host 是 Photoshop。
- minVersion 是 `27.3.0`。
- entrypoints 包含 `panel` 和 `createLayer`。
- `uxp-panel.html` 使用 classic script。
- bundle 中没有 Vite modulepreload polyfill。
- bundle 中没有 `eval`、`new Function`、动态 `import()`、`import.meta`。

## Manifest 基线

当前 manifest 要点：

```json
{
  "manifestVersion": 5,
  "id": "com.tanshow.lightyearbanana",
  "name": "Lightyear Banana",
  "version": "0.1.0",
  "main": "uxp-panel.html",
  "host": {
    "app": "PS",
    "minVersion": "27.3.0",
    "data": {
      "apiVersion": 2
    }
  }
}
```

panel 和 command 的 id 必须和 `src/uxp/main.ts` 中的 `entrypoints.setup()` 对齐。

## UI 写法

- 组件使用 `<script setup lang="ts">`。
- 派生状态使用 `computed`。
- 大图像、Photoshop handle、文件对象使用局部变量或 `shallowRef`。
- Photoshop API 细节放在 `src/uxp/`，组件不直接拼 batchPlay descriptor。
- 面板最小宽度控制在 UXP 可停靠范围内。

## 可评估的后续方向

- 简单 Photoshop 风格控件可以引入 Spectrum UXP widgets。
- 更完整 Spectrum 组件可以评估 Spectrum Web Components。
- 复杂 Web UI 或需要完整浏览器能力时再评估 Bolt UXP WebView UI。


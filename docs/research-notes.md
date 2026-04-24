# Lightyear Banana 研究记录

## Adobe 官方文档

官方入口：

- https://developer.adobe.com/photoshop/uxp/guides/
- https://developer.adobe.com/photoshop/uxp/2022/guides/uxp_guide/uxp-misc/manifest-v5/
- https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/plugin-workflows/
- https://developer.adobe.com/photoshop/uxp/2022/guides/debugging/
- https://developer.adobe.com/photoshop/uxp/2022/guides/uxp_guide/unsupported/
- https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/imaging/
- https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/batchplay/
- https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/executeasmodal/
- https://developer.adobe.com/photoshop/uxp/2022/uxp-api/reference-js/Modules/uxp/Persistent%20File%20Storage/FileSystemProvider/
- https://developer.adobe.com/photoshop/uxp/2022/uxp/reference-spectrum/
- https://developer.adobe.com/photoshop/uxp/2022/uxp-api/reference-spectrum/swc/
- https://developer.adobe.com/photoshop/uxp/2022/design/ux-patterns/Designingforphotoshop/
- https://developer.adobe.com/photoshop/uxp/2022/design/user-interface/
- https://developer.adobe.com/photoshop/uxp/2022/guides/code_samples/
- https://developer.adobe.com/photoshop/uxp/2022/guides/uxp_guide/uxp-misc/uxp-toolchain/
- https://developer.adobe.com/premiere-pro/uxp/resources/fundamentals/user-interfaces/
- https://github.com/hyperbrew/bolt-uxp
- https://blog.developer.adobe.com/en/publish/2026/03/introducing-webview-ui-in-bolt-uxp-build-richer-adobe-plugins-faster

关键结论：

- Photoshop 插件通过 UXP Developer Tools 添加 `manifest.json`，再 `Load` 到宿主。
- Manifest v5 需要 `manifestVersion`、`id`、`name`、`version`、`main`、`host`、`entrypoints`。
- Photoshop host 使用 `"app": "PS"`。
- Manifest v5 完整能力从 Photoshop 23.3 起可用；本机实测 host 是 Photoshop 2026 `27.3.0`，本项目把 `minVersion` 固定到 `27.3.0`，减少版本变量。
- panel entrypoint 使用 `type: "panel"`、`id`、`label`、尺寸字段和 icon 字段。
- command entrypoint 使用 `type: "command"`、`id`、`label`。
- 调试路径是 UDT 的 `Debug`、Photoshop UXP log、`Reload`、`Watch`。
- Adobe unsupported 页面把 Vue.js 列在不支持框架中，同时提到有人成功使用。这里采用静态 bundle 路线，避免 UXP 不稳定的浏览器特性。
- 图像读取使用 Photoshop `imaging` 子模块。`getPixels` 可读取当前文档合成图或指定图层，`sourceBounds` 支持坐标矩形，`targetSize` 支持缩略图级采样。
- 选区读取使用 `imaging.getSelection`，得到的是选区像素表达，适合当作蒙版处理。
- 面板预览使用 `imaging.encodeImageData` 转成 JPEG base64，再写到 `<img>`。
- 所有返回 `PhotoshopImageData` 的调用都要尽快 `dispose()`，Adobe 文档明确提示大图像会带来 UDT 内存告警。
- 写入像素使用 `imaging.putPixels`，目标必须是 pixel layer。置入外部文件更适合走 `batchPlay` 的 `placeEvent`，并通过 UXP `localFileSystem.createSessionToken()` 传文件。
- 修改 Photoshop 文档或应用状态的操作需要包在 `core.executeAsModal()` 内。
- `batchPlay` 是高级 API。Adobe 建议优先使用 DOM API；需要动作描述符时，通过 Actions 面板的 `Copy As JavaScript` 或监听记录确认真实 descriptor。
- UXP UI 有三条路线：标准 HTML、内置 Spectrum UXP widgets、Spectrum Web Components。SWC 在 UXP v7.0 后可用，需要 manifest feature flag、安装并 import 单个组件。
- Photoshop 插件 UI 选择上，需要持续访问画布时用 panel；只执行一次动作、不需要画布交互时用 dialog。
- Photoshop 面板要适配主题和停靠空间，避免设置大于 240px 的最小固定宽度。
- Adobe Code Samples 明确不指定唯一 UI 库。React、Vue、Svelte 都有 sample，复杂 UI 可以根据团队经验和项目需要选择。
- Adobe UXP Toolchain 文档把原生 HTML/CSS/JS 作为简单插件路径；涉及 React 或非平凡 UI 时需要 Node/npm/yarn 这类构建工具链。
- Spectrum UXP Widgets 是无需框架的内置控件，直接写 `sp-*` 标签即可。
- SWC 是后续更完整的 Spectrum 组件方向。Photoshop SWC starter 目前重点覆盖 vanilla 和 React，使用时要启用 `enableSWCSupport` 并管理组件版本。
- UXP 与网页前端的核心差异在宿主 API、文件权限、HTML/CSS 支持子集、manifest/icons、UDT 加载循环和 `executeAsModal()`。
- Bolt UXP 代表社区生产级实践，支持 React/Vue/Svelte + Vite + TypeScript。2026 年新增 WebView UI，适合复杂 UI 和更完整浏览器能力，但会增加 UXP backend 与 WebView UI 的通信层。

## UXP Developer Tools 模板

本机 UXP Developer Tools：

```text
/Applications/Adobe UXP Developer Tools/Adobe UXP Developer Tools.app
```

版本：

```text
2.2.1
```

模板提取位置：

```text
/tmp/uxp-udt-templates/node_modules/@adobe/uxp-template-*
```

通过 UDT 新建得到的最小模板：

```text
/tmp/udt-template-research/Test-qml8ulcom.tanshow.udt.template.research/
```

Vanilla 模板 manifest 是 v5，包含一个 command 和一个 panel：

```json
{
  "manifestVersion": 5,
  "id": "com.tanshow.udttemplateresearch",
  "main": "index.html",
  "host": {
    "app": "PS",
    "minVersion": "27.3.0"
  },
  "entrypoints": [
    {
      "type": "command",
      "id": "showAlert",
      "label": "Show alert"
    },
    {
      "type": "panel",
      "id": "vanilla",
      "label": {
        "default": "Starter Panel"
      }
    }
  ]
}
```

Vanilla 模板入口：

```js
const { entrypoints } = require("uxp");

entrypoints.setup({
  commands: {
    showAlert
  },
  panels: {
    vanilla: {
      show(node) {}
    }
  }
});
```

对本项目的启发：

- UXP 原生模板使用普通 script 和 CommonJS `require("uxp")`。
- `entrypoints.setup()` 的 key 必须和 manifest id 对齐。
- panel 和 command 可以共存，command 很适合做自动化回归。
- manifest 改动后，UDT `Reload` 可能继续使用旧 manifest，需要完整 `Unload` / `Load`。

## GitHub starter

Adobe 官方样例仓库：

- https://github.com/AdobeDocs/uxp-photoshop-plugin-samples

本机 clone：

```text
/tmp/uxp-photoshop-plugin-samples
```

关键样例：

```text
plugins/ui-vue-3-starter
```

该样例使用 Vue 3 + Webpack。入口模式：

```js
import hello from "./hello.vue";
import { createApp } from 'vue'

const { entrypoints } = require("uxp");
global.SVGElement = global.Element;

entrypoints.setup({
  panels: {
    helloworld: {
      create() {
        createApp(hello).mount('#container')
      },
    },
  },
});
```

对本项目的启发：

- Vue 3 在 UXP 里需要补 `SVGElement`，否则 Vue runtime 可能访问缺失的 DOM 构造器。
- Vue 挂载可以发生在 panel `create()` 里。
- Adobe 样例仍是 Webpack 和旧 manifest 形态，本项目把这个模式迁移到 Manifest v5 + Vite IIFE。

社区 starter：

- https://github.com/hyperbrew/bolt-uxp
- https://github.com/bubblydoo/uxp-toolkit
- https://github.com/AdobeDocs/uxp-photoshop-plugin-samples

观察：

- `hyperbrew/bolt-uxp` 是更完整的多框架 Vite starter，适合后续做生产级插件工程模板。
- `bubblydoo/uxp-toolkit` 提供 UXP/Vite 相关工具和类型，适合后续减少手写 post-build 逻辑。
- 本次实验保留最小依赖，只使用 Vue、Vite、TypeScript 和一个本地 verify 脚本。
- Adobe samples 里的 `jszip-sample` 使用 `app.activeDocument.artboards` 和 `exportSelectionAsFileTypePressed` 遍历导出画板。
- Adobe samples 里的 `ui-kitchen-sink` 覆盖 Spectrum UXP widgets、dialog、tabs、事件可用性，适合作为面板控件行为参考。
- Adobe samples 里的 `swc-uxp-starter` 展示 SWC 组件安装、import、`<sp-theme>` 包裹和版本锁定方式。
- Adobe samples 里的 `ui-vue-3-starter` 使用 `createApp(hello).mount('#container')` 演示 Vue 3 panel。
- Adobe samples 里的 `ui-react-starter` 演示多 panel、flyout menu 和 Spectrum UXP widgets。
- Adobe samples 里的 `swc-uxp-react-starter` 演示 React + SWC wrapper，适合 React 项目参考。
- 当前仓库继续使用 Vue 3 是合理选择：已有构建链和 UXP 回归记录，UI 复杂度尚未达到需要 React 生态或 WebView UI 的程度。

## 本项目验证链

构建产物：

```text
dist/ps-uxp/manifest.json
dist/ps-uxp/uxp-panel.html
dist/ps-uxp/assets/uxp-panel-*.js
dist/ps-uxp/icons/*.png
```

静态校验：

```text
npm run verify:uxp
UXP build verified: dist/ps-uxp
```

UDT 加载：

```text
com.tanshow.lightyearbanana
Plugin Load Successful
State: Loaded
```

Photoshop command 回归：

```text
执行前：1|Lightyear Banana Test|1|背景
执行后：1|Lightyear Banana Test|2|Lightyear Banana
```

Photoshop UXP log：

```text
[Lightyear Banana] script loaded true
[Lightyear Banana] panel create
[Lightyear Banana] mounting Vue panel
[Lightyear Banana] Vue panel mounted
[Lightyear Banana] panel text Photoshop UXP...
[Lightyear Banana] command createLayer
[Lightyear Banana] command createLayer done
```

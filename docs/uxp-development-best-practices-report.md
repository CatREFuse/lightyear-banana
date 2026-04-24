# Photoshop UXP 开发最佳实践报告

## 结论

当前项目建议继续采用 `Vue 3 + Vite + TypeScript + Manifest v5`。这个选择已经在本仓库跑通过构建、UDT 加载、面板挂载和 Photoshop command 调用，迁移到 React 暂时没有明显收益。

UXP 开发要分成两层看：UI 层可以像前端一样使用 HTML/CSS/JavaScript 和框架；宿主层要按 UXP 的限制处理文件权限、Photoshop API、modal execution、manifest、图标和加载流程。开发策略不能直接套 Web app 经验。

## 调研来源

- [Adobe Photoshop UXP Getting Started](https://developer.adobe.com/photoshop/uxp/2021/guides/)：UXP 使用 HTML/CSS/JavaScript，但底层引擎不是完整浏览器。
- [Adobe UXP Toolchain](https://developer.adobe.com/photoshop/uxp/2022/guides/uxp_guide/uxp-misc/uxp-toolchain/)：简单插件可以用原生 HTML/CSS/JS；非平凡 UI 通常需要 Node/npm/yarn 等构建工具。
- [Adobe Photoshop Code Samples](https://developer.adobe.com/photoshop/uxp/2022/guides/code_samples/)：Adobe 不指定唯一 UI 库，React、Vue、Svelte 都有官方 sample。
- [Adobe Spectrum UXP Widgets](https://developer.adobe.com/photoshop/uxp/2022/uxp/reference-spectrum/)：内置 `sp-*` 控件可直接在 UXP 中使用。
- [Adobe Spectrum Web Components](https://developer.adobe.com/photoshop/uxp/2022/uxp-api/reference-spectrum/swc/)：UXP v7.0 起支持 SWC，需要 `featureFlags.enableSWCSupport` 和组件 import。
- [Adobe executeAsModal](https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/executeasmodal/)：修改 Photoshop 文档、应用状态或偏好设置时需要 modal scope。
- [Adobe BatchPlay](https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/batchplay/)：DOM API 覆盖不到时使用 descriptor，并可通过 Actions 面板复制 UXP JavaScript。
- [Adobe Imaging API](https://developer.adobe.com/photoshop/uxp/2022/ps_reference/media/imaging/)：读取合成图、图层像素、选区蒙版、写入像素。
- [Adobe UXP Photoshop samples](https://github.com/AdobeDocs/uxp-photoshop-plugin-samples)：包含 vanilla、React、Vue 3、Svelte、SWC、UI kitchen sink 等样例。
- [Bolt UXP](https://github.com/hyperbrew/bolt-uxp)：社区生产级实践，支持 React/Vue/Svelte + Vite + TypeScript；[2026 年新增 WebView UI](https://blog.developer.adobe.com/en/publish/2026/03/introducing-webview-ui-in-bolt-uxp-build-richer-adobe-plugins-faster)。

## UXP 和网页前端的核心差异

| 维度 | 网页前端 | UXP 插件 |
| --- | --- | --- |
| 运行位置 | 浏览器页面 | Photoshop 宿主内的 panel、dialog、command |
| 引擎能力 | 完整浏览器能力 | UXP 支持的 HTML/CSS/JS 子集 |
| 宿主通信 | 后端 API、Web API | `require("uxp")`、`require("photoshop")` |
| 文件访问 | 浏览器沙箱、上传下载 | 插件目录、data、temp；外部文件需要用户授权或 token |
| UI 组件 | 任意 Web UI 库 | HTML、Spectrum UXP widgets、SWC |
| 开发循环 | dev server、HMR | build 后通过 UDT Load / Reload |
| 状态修改 | DOM、前端状态、后端状态 | Photoshop 文档修改必须进入 `executeAsModal()` |
| 调试 | Browser DevTools | UXP Developer Tools、Photoshop UXP log、宿主实测 |
| 分发 | Web 部署 | manifest、HTML、JS、CSS、icons 打包成 UXP/CCX |

## UI 技术选型

| 方案 | 适合场景 | 成本 | 建议 |
| --- | --- | --- | --- |
| 原生 HTML/CSS/JS | command、简单 panel、少量表单、API 验证 | 复杂 UI 会快速散乱 | 用作最小样例和回归命令 |
| Vue 3 | 中等复杂面板、表单、预览、状态清晰的小团队项目 | Adobe sample 少于 React，需要处理 UXP 构建约束 | 当前项目主线 |
| React | 大型面板、团队已有 React 经验、需要 SWC React wrapper | 依赖、bundle、JSX 和调试成本更高 | 新大型项目可选 |
| Svelte | 追求小 bundle、运行时代码少 | 团队经验和生态要确认 | 轻量项目可评估 |
| Spectrum UXP Widgets | Photoshop 风格按钮、输入框、选择器、滑块 | 能力有限 | 默认控件层 |
| Spectrum Web Components | 更多 Spectrum 组件、跨框架组件、后续 Adobe 方向 | manifest flag、依赖版本、组件 import 管理 | 按需引入 |
| Bolt UXP WebView UI | 复杂布局、动画、完整浏览器能力、迁移已有 Web UI | UXP backend 和 WebView UI 通信复杂 | 复杂插件再评估 |

## 当前项目技术路线

继续使用：

- `Vue 3`
- `Composition API`
- `<script setup lang="ts">`
- `Vite` 静态 IIFE bundle
- `Manifest v5`
- `globalThis.require("uxp")`
- `globalThis.require("photoshop")`

继续避免：

- dev server 直接作为 UXP 入口
- HMR 依赖
- 动态 `import()`
- `eval`
- `new Function`
- 把 Photoshop document、layer、image data 放进深层 reactive state

## 推荐架构

```text
src/
  uxp/
    main.ts
    photoshopHost.ts
  composables/
    usePhotoshopProbe.ts
    useCanvasPrimitives.ts
  components/
    <feature>/
      FeaturePanel.vue
      FeatureControls.vue
      FeaturePreview.vue
  App.vue
```

职责分层：

- `src/uxp/main.ts`：只负责 entrypoints、panel mount、command 注册。
- `src/uxp/photoshopHost.ts`：封装 `require("photoshop")`、`require("uxp")`、Photoshop API、文件 token、`batchPlay`。
- `src/composables/`：封装状态、异步流程、错误状态、取消逻辑、进度。
- `src/components/`：展示控件、表单、预览，不直接拼 `batchPlay` descriptor。
- `App.vue`：组合 feature，不承载大量 Photoshop 业务逻辑。

## UI 开发原则

优先使用 host 主题：

```css
body {
  background-color: var(--uxp-host-background-color);
  color: var(--uxp-host-text-color);
  border-color: var(--uxp-host-border-color);
  font-size: var(--uxp-host-font-size);
}
```

控件选择：

- 普通布局用 HTML + CSS。
- Photoshop 风格控件优先用 Spectrum UXP widgets。
- 需要更多 Spectrum 能力时引入 SWC。
- 同一个面板可以混用 HTML、Spectrum UXP widgets、SWC，但要记录组件来源。
- 图标、主题、字体和间距要在 light、lightest、dark、darkest 下检查。

面板和对话框选择：

- 用户需要边看画布边操作时用 panel。
- 一次性确认、设置、导入、导出可以用 dialog。
- 面板最小宽度不要大于 `240px`。
- 长任务要显示进度，并在 `executeAsModal()` 内使用 `executionContext.reportProgress()`。

Vue 写法：

- 组件使用 `<script setup lang="ts">`。
- 数据流使用 props down / events up。
- 派生数据用 `computed`。
- 异步副作用放在 composable。
- Photoshop handle、文件对象、大图像数据用局部变量或 `shallowRef`。
- 图像数据读取后尽快 `dispose()`。

## Photoshop 宿主 API 原则

文档修改：

- 创建图层、移动图层、置入图片、写入像素等操作要进入 `core.executeAsModal()`。
- 不要在普通 click handler 里直接改 Photoshop 状态。
- modal scope 内只做必要的宿主操作，避免长时间阻塞 Photoshop。

DOM API 与 BatchPlay：

- DOM API 能完成时优先使用 DOM API。
- DOM API 不覆盖时使用 `action.batchPlay()`。
- `batchPlay` descriptor 要通过官方文档、Actions 面板 `Copy As JavaScript`、实际运行日志校准。
- 不要凭记忆手写复杂 descriptor。

图像 IO：

- 可见合成图：`imaging.getPixels({ documentID, sourceBounds })`
- 指定图层：`imaging.getPixels({ documentID, layerID, sourceBounds })`
- 选区蒙版：`imaging.getSelection({ documentID, sourceBounds })`
- 面板预览：`imaging.encodeImageData({ imageData, base64: true })`
- 写入图层：`imaging.putPixels()`
- 外部文件置入：`localFileSystem.getFileForOpening()` + `createSessionToken()` + `placeEvent`

资源释放：

- 所有 `PhotoshopImageData` 都要在 `finally` 中 `dispose()`。
- 预览图建议转成 data URL 或临时文件路径后释放原始像素。
- 不要把大 `Uint8Array` 长期放进 Vue state。

## 画板交互原语

开发插件时应先沉淀这些基础能力：

- 获取当前可见合成图，全图或指定坐标矩形。
- 获取指定图层图像，全图层 bounds 或指定坐标矩形。
- 获取当前选区蒙版。
- 获取画板范围内的合成图。
- 导出画板。
- 置入图片到当前文档。
- 置入图片后铺满画布。
- 置入图片到指定位置和尺寸。
- 写入 RGBA 像素到 pixel layer。

这些能力应集中在 host 层、canvas primitives 模块和 `canvasPrimitiveService` 服务层里。UI 层只调用 typed function。

当前项目维护了一份专门的业务参考文档：

- [Photoshop 画板交互原语参考](canvas-primitives-reference.md)

## 文件访问和权限

文件访问路径：

- 插件安装目录：适合读取静态资源。
- `data`：适合保存插件持久数据。
- `temp`：适合中间文件和导出缓存。
- 用户选择的外部文件：通过 `getFileForOpening()` 获取。
- 写入外部位置：通过 `getFileForSaving()` 或用户选择文件夹。

Photoshop 需要访问 UXP file entry 时：

- 使用 `localFileSystem.createSessionToken(file)`。
- 长期保存授权时再评估 persistent token。
- 不要直接把 native path 当成 Photoshop 可访问路径。

## 构建与加载

开发 UI：

```bash
npm run dev
```

只用于浏览器预览 Vue UI，不验证 Photoshop API。

构建 UXP：

```bash
npm run build:uxp
```

静态校验：

```bash
npm run verify:uxp
```

改动重载规则：

- 改 Vue、TS、CSS：构建后在 UDT 里 `Reload`。
- 改 manifest、entrypoint、图标、权限：执行 `verify:uxp`，再 `Unload` / `Load`。
- 不要只依赖 `Reload` 验证 manifest 变化。

## 验证清单

基础验证：

- `npm run verify:uxp`
- UDT 能加载 `dist/ps-uxp/manifest.json`
- Photoshop 菜单 command 可执行
- 面板能打开和挂载 Vue
- Photoshop UXP log 没有 fatal error

UI 验证：

- light / lightest / dark / darkest 主题
- panel 停靠、浮动、窄宽度
- 无文档、无选中图层、取消文件选择
- 长任务进度和取消状态
- 错误信息能被用户理解

图像能力验证：

- 小图
- 超大图
- 透明图层
- 空选区
- 部分越界的坐标矩形
- 智能对象、文字图层、组图层
- PNG、JPEG、PSD、WebP 置入

## 版本策略

当前仓库已验证环境：

```text
Adobe Photoshop 2026 27.3.0
Adobe UXP Developer Tools 2.2.1
```

短期策略：

- `host.minVersion` 固定到已验证版本，减少变量。
- 等画板原语和 UI 结构稳定后，再评估降低 `minVersion`。
- 引入 SWC 前先确认目标 Photoshop 的 UXP 版本和 SWC 支持状态。
- 引入 WebView UI 前单独做 PoC，不和现有 Vue 面板主线混改。

## 落地路线

第一阶段：保住当前闭环。

- 保持 Vue 3 + Vite + Manifest v5。
- 把画板交互原语从 cookbook 落到 `src/uxp/photoshopHost.ts` 或独立 `canvasPrimitives.ts`。
- 每个原语配 command 或面板按钮做宿主内回归。

第二阶段：整理 UI。

- 把 `App.vue` 变成组合层。
- 新建 feature components。
- 把 Photoshop 状态、副作用和错误处理放入 composable。
- 引入 Spectrum UXP widgets 替换普通按钮和输入控件。

第三阶段：评估 SWC。

- 只在内置 Spectrum UXP widgets 不够时引入。
- 先做一个独立分支 PoC。
- 明确依赖版本、manifest feature flag、bundle 增量和主题表现。

第四阶段：评估 WebView UI。

- 只在原生 UXP UI 阻碍复杂界面开发时评估。
- PoC 要验证 UXP backend 与 WebView UI 通信、文件选择、Photoshop API 调用链、打包和调试体验。

# Photoshop UXP + Vue 3 + Vite Cookbook

## 当前结论

本项目已经跑通 Photoshop 2026 `27.3.0` 上的最小 UXP 插件闭环：

- Vue 3 + Vite 构建为 UXP 可加载的静态 IIFE bundle。
- UXP Developer Tools 能从 `dist/ps-uxp/manifest.json` 加载插件。
- Photoshop 的 `增效工具 > Lightyear Banana > 创建图层` 能调用 UXP Photoshop API，并在当前文档创建 `Lightyear Banana` 图层。
- 面板入口 `panel` 能触发 `entrypoints.setup()` 的 `create` / `show`，Vue 挂载成功，日志能输出面板 DOM 文案。

Adobe 文档仍把 Vue 放在 unsupported 列表里，但 Adobe 官方样例仓库提供过 Vue starter。当前方案把 Vue 当作编译后的静态 UI 使用，避开 dev server、HMR、动态 import 和运行时代码生成。

## 项目结构

```text
plugin/manifest.json
uxp-panel.html
src/uxp/main.ts
src/uxp/photoshopHost.ts
src/App.vue
src/composables/usePhotoshopProbe.ts
src/style.css
plugin/icons/*.png
vite.uxp.config.ts
scripts/verify-uxp-build.mjs
docs/research-notes.md
docs/uxp-cookbook.md
```

## 安装依赖

```bash
npm install
```

## 浏览器预览

```bash
npm run dev
```

浏览器预览只检查 Vue UI。`globalThis.require("photoshop")` 只在 Photoshop UXP 运行时存在。

## 构建和静态校验

```bash
npm run verify:uxp
```

成功输出：

```text
UXP build verified: dist/ps-uxp
```

产物目录：

```text
dist/ps-uxp
```

该目录需要包含：

```text
manifest.json
uxp-panel.html
assets/*.js
assets/*.js.map
icons/*.png
```

## 用 UXP Developer Tools 加载

1. 打开 Photoshop。
2. 打开 Adobe UXP Developer Tools。
3. 点击 `Add Plugin...`。
4. 选择 `dist/ps-uxp/manifest.json`。
5. 在插件行点击 `Load`。
6. 回到 Photoshop，打开 `增效工具 > Lightyear Banana > Lightyear Banana`。
7. 打开任意文档后，点击面板里的 `读取文档` 或 `创建图层`。
8. 也可以直接执行 `增效工具 > Lightyear Banana > 创建图层` 验证 Photoshop API。

## 修改后的重载规则

改 Vue、TS、CSS 后：

```bash
npm run build:uxp
```

然后在 UXP Developer Tools 点击 `Reload`。

改 `plugin/manifest.json`、entrypoint id、command、panel、icon、权限后：

```bash
npm run verify:uxp
```

然后在 UXP Developer Tools 先 `Unload`，再 `Load`。只点 `Reload` 容易保留旧 manifest，常见报错是 `Could not find command ... in manifest` 或 `Could not find panel ... in manifest`。

需要监听构建时：

```bash
npm run build:uxp:watch
```

同时在 UXP Developer Tools 里点 `Watch`。Vite watch 负责刷新 `dist/ps-uxp`，UDT Watch 负责让 Photoshop 重新加载插件。

## Vite 到 UXP 的构建约束

UXP 面板加载本地静态文件。当前 `vite.uxp.config.ts` 做了这些处理：

- `base: "./"`，让资源路径相对 `manifest.json` 所在目录。
- `publicDir: false`，避免 Vite 默认 public 资源混进 UXP 产物。
- `modulePreload.polyfill: false`，避免 Vite 注入浏览器预加载逻辑。
- Rollup 输出 `format: "iife"`，避免 ESM 运行时依赖。
- 构建后移除 `uxp-panel.html` 中的 `type="module"` 和 `crossorigin`。
- 构建后把 classic `<script src="...">` 移到 `#app` 之后，避免脚本早于挂载节点执行。
- 构建后复制 `plugin/manifest.json` 和 `plugin/icons/` 到 `dist/ps-uxp/`。
- 校验脚本检查 `eval`、`new Function`、动态 `import()`、`import.meta` 和 Vite modulepreload polyfill。

## Manifest v5 基线

当前已经验证的 manifest 关键字段：

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
  },
  "entrypoints": [
    {
      "type": "command",
      "id": "createLayer",
      "label": {
        "default": "创建图层"
      }
    },
    {
      "type": "panel",
      "id": "panel",
      "label": {
        "default": "Lightyear Banana"
      }
    }
  ]
}
```

`entrypoints.setup()` 里的 `commands.createLayer` 和 `panels.panel` 必须和 manifest id 完全一致。

## 图标规则

本机 Photoshop 2026 可用的 panel icon 尺寸是 23px。`scale: [1, 2]` 会让 Photoshop 查找这些文件：

```text
dark@1x.png
dark@2x.png
light@1x.png
light@2x.png
icon_D@1x.png
icon_D@2x.png
icon_N@1x.png
icon_N@2x.png
```

文件名或尺寸不匹配时，Photoshop 会在 UXP log 里记录 scaled icon missing，严重时会拒绝加载插件。

## UXP 入口模式

`src/uxp/main.ts` 不直接从 `uxp` 或 `photoshop` 做 ESM import。运行时通过 `globalThis.require("uxp")` 取 `entrypoints`：

```ts
const { entrypoints } = getUxpRequire()('uxp')

entrypoints.setup({
  commands: {
    async createLayer() {
      await createNamedLayer()
    }
  },
  panels: {
    panel: {
      create() {
        mountPanel()
      },
      show() {
        mountPanel()
      }
    }
  }
})
```

Vue 挂载到 `uxp-panel.html` 里的 `#app`。这个节点必须早于 bundle 脚本出现。

## Photoshop API 调用

Photoshop API 只在 UXP 运行时可用：

```ts
const photoshop = globalThis.require('photoshop')
const doc = photoshop.app.activeDocument
```

修改文档时使用 `executeAsModal`：

```ts
await photoshop.core.executeAsModal(
  async () => {
    await photoshop.action.batchPlay(
      [
        {
          _obj: 'make',
          _target: [{ _ref: 'layer' }],
          using: {
            _obj: 'layer',
            name: 'Lightyear Banana'
          },
          _options: {
            dialogOptions: 'dontDisplay'
          }
        }
      ],
      {}
    )
  },
  { commandName: 'Create Lightyear Banana Layer' }
)
```

## 画板交互原语

这些原语是后续插件能力的基础层。读取图像统一优先走 Photoshop `imaging` API，修改文档统一包在 `core.executeAsModal()` 内。`batchPlay` 只在 DOM API 覆盖不到时使用，并保留 Actions 面板 `Copy As JavaScript` 记录作为校准来源。

参考来源：

- Adobe Imaging API：`getPixels`、`getSelection`、`putPixels`、`encodeImageData`
- Adobe BatchPlay 文档：descriptor 结构、Actions 面板 `Copy As JavaScript`
- Adobe Modal Execution 文档：修改文档状态要使用 `executeAsModal`
- Adobe UXP FileSystemProvider：`getFileForOpening()`、`createSessionToken()`
- Adobe sample `jszip-sample`：`app.activeDocument.artboards` 与画板导出

坐标约定：

- Photoshop 文档左上角是 `{ left: 0, top: 0 }`。
- Imaging API 的 `sourceBounds` 包含 `left` / `top`，不包含 `right` / `bottom`。
- `{ left: 0, top: 0, right: 10, bottom: 10 }` 代表 `10 x 10` 像素。
- 需要全图时使用文档尺寸；需要局部时传入矩形；需要缩略图时加 `targetSize`。
- 图层有效像素范围优先用 `layer.boundsNoEffects`，它排除图层效果，更适合作为图像处理输入边界。

基础类型：

```ts
type PixelBounds = {
  left: number
  top: number
  right?: number
  bottom?: number
  width?: number
  height?: number
}

type TargetSize = {
  width?: number
  height?: number
}

function docBounds(doc: { width: number; height: number }): PixelBounds {
  return {
    left: 0,
    top: 0,
    width: Math.round(doc.width),
    height: Math.round(doc.height)
  }
}

function normalizeBounds(bounds: PixelBounds): Required<Pick<PixelBounds, 'left' | 'top' | 'right' | 'bottom'>> {
  const right = bounds.right ?? bounds.left + (bounds.width ?? 0)
  const bottom = bounds.bottom ?? bounds.top + (bounds.height ?? 0)

  return {
    left: Math.round(bounds.left),
    top: Math.round(bounds.top),
    right: Math.round(right),
    bottom: Math.round(bottom)
  }
}

function intersectBounds(a: PixelBounds, b: PixelBounds) {
  const aa = normalizeBounds(a)
  const bb = normalizeBounds(b)
  const result = {
    left: Math.max(aa.left, bb.left),
    top: Math.max(aa.top, bb.top),
    right: Math.min(aa.right, bb.right),
    bottom: Math.min(aa.bottom, bb.bottom)
  }

  if (result.right <= result.left || result.bottom <= result.top) {
    return null
  }

  return result
}
```

### 获取可见合成图

不传 `layerID` 时，`imaging.getPixels()` 返回当前文档的合成结果，适合读取用户当前看到的画面。全图读取用文档边界，局部读取用业务传入的 `sourceBounds`。

```ts
export async function getCompositePixels(options: {
  bounds?: PixelBounds
  targetSize?: TargetSize
} = {}) {
  const photoshop = globalThis.require('photoshop')
  const { app, imaging } = photoshop
  const doc = app.activeDocument

  const result = await imaging.getPixels({
    documentID: doc.id,
    sourceBounds: options.bounds ?? docBounds(doc),
    targetSize: options.targetSize,
    colorSpace: 'RGB',
    componentSize: 8
  })

  try {
    const data = await result.imageData.getData()
    return {
      data,
      width: result.imageData.width,
      height: result.imageData.height,
      components: result.imageData.components,
      sourceBounds: result.sourceBounds,
      level: result.level
    }
  } finally {
    result.imageData.dispose()
  }
}
```

面板预览时不要把大图像数据长期留在 Vue state 里。转成 data URL 后释放 `PhotoshopImageData`。

```ts
export async function getCompositePreviewDataUrl(bounds?: PixelBounds) {
  const photoshop = globalThis.require('photoshop')
  const { app, imaging } = photoshop
  const doc = app.activeDocument

  const result = await imaging.getPixels({
    documentID: doc.id,
    sourceBounds: bounds ?? docBounds(doc),
    targetSize: { width: 512 },
    colorSpace: 'RGB',
    componentSize: 8
  })

  try {
    const base64 = await imaging.encodeImageData({
      imageData: result.imageData,
      base64: true
    })

    return `data:image/jpeg;base64,${base64}`
  } finally {
    result.imageData.dispose()
  }
}
```

### 获取特定图层图片

传入 `layerID` 时，`getPixels()` 返回指定图层的像素。局部读取时先和图层有效像素范围求交集，避免请求空区域。

```ts
export async function getLayerPixels(layer: { id: number; boundsNoEffects: PixelBounds }, bounds?: PixelBounds) {
  const photoshop = globalThis.require('photoshop')
  const { app, imaging } = photoshop
  const doc = app.activeDocument
  const sourceBounds = bounds
    ? intersectBounds(layer.boundsNoEffects, bounds)
    : normalizeBounds(layer.boundsNoEffects)

  if (!sourceBounds) {
    return null
  }

  const result = await imaging.getPixels({
    documentID: doc.id,
    layerID: layer.id,
    sourceBounds,
    colorSpace: 'RGB',
    componentSize: 8
  })

  try {
    const data = await result.imageData.getData()
    return {
      data,
      width: result.imageData.width,
      height: result.imageData.height,
      components: result.imageData.components,
      sourceBounds: result.sourceBounds
    }
  } finally {
    result.imageData.dispose()
  }
}
```

读取当前选中图层：

```ts
export async function getActiveLayerPreviewDataUrl(bounds?: PixelBounds) {
  const photoshop = globalThis.require('photoshop')
  const { app, imaging } = photoshop
  const doc = app.activeDocument
  const layer = doc.activeLayers[0]
  const sourceBounds = bounds
    ? intersectBounds(layer.boundsNoEffects, bounds)
    : normalizeBounds(layer.boundsNoEffects)

  if (!sourceBounds) {
    return null
  }

  const result = await imaging.getPixels({
    documentID: doc.id,
    layerID: layer.id,
    sourceBounds,
    targetSize: { width: 512 },
    colorSpace: 'RGB',
    componentSize: 8
  })

  try {
    const base64 = await imaging.encodeImageData({
      imageData: result.imageData,
      base64: true
    })

    return `data:image/jpeg;base64,${base64}`
  } finally {
    result.imageData.dispose()
  }
}
```

### 获取选区蒙版

选区按灰度蒙版处理。`imaging.getSelection()` 返回灰度图像，适合当作蒙版和后续图像算法输入。

```ts
export async function getSelectionMask(bounds?: PixelBounds) {
  const photoshop = globalThis.require('photoshop')
  const { app, imaging } = photoshop
  const doc = app.activeDocument

  const result = await imaging.getSelection({
    documentID: doc.id,
    sourceBounds: bounds ?? docBounds(doc)
  })

  try {
    const data = await result.imageData.getData()
    return {
      data,
      width: result.imageData.width,
      height: result.imageData.height,
      sourceBounds: result.sourceBounds
    }
  } finally {
    result.imageData.dispose()
  }
}
```

### 获取画板范围内图片

Photoshop 文档暴露 `app.activeDocument.artboards`。画板在 DOM 里按图层处理，可以通过 `id` 做导出，也可以把画板 `boundsNoEffects` 作为读取合成图的范围。

```ts
export async function getArtboardCompositePreviewDataUrl(artboard: {
  boundsNoEffects: PixelBounds
}) {
  return getCompositePreviewDataUrl(normalizeBounds(artboard.boundsNoEffects))
}
```

导出所有画板时，Adobe sample 使用 `exportSelectionAsFileTypePressed`：

```ts
export async function exportArtboardsToFolder(tempFolder: { nativePath: string }) {
  const photoshop = globalThis.require('photoshop')
  const { action, app, core } = photoshop

  await core.executeAsModal(
    async () => {
      const artboards = app.activeDocument.artboards

      for (const artboard of artboards) {
        await action.batchPlay(
          [
            {
              _obj: 'exportSelectionAsFileTypePressed',
              _target: {
                _ref: 'layer',
                _id: artboard.id
              },
              fileType: 'png',
              quality: 32,
              metadata: 0,
              destFolder: tempFolder.nativePath,
              sRGB: true,
              openWindow: false,
              _options: {
                dialogOptions: 'dontDisplay'
              }
            }
          ],
          {}
        )
      }
    },
    { commandName: 'Export Artboards' }
  )
}
```

### 置入图片

从用户选择的本地文件置入图片时，先用 UXP 文件系统拿 `File`，再用 `createSessionToken()` 传给 Photoshop。`placeEvent` 会创建置入图层，通常是智能对象。

```ts
export async function placeImageFromFilePicker() {
  const photoshop = globalThis.require('photoshop')
  const uxp = globalThis.require('uxp')
  const { action, app, core } = photoshop
  const fs = uxp.storage.localFileSystem
  const file = await fs.getFileForOpening({
    types: ['png', 'jpg', 'jpeg', 'webp', 'psd']
  })

  if (!file) {
    return null
  }

  const token = fs.createSessionToken(file)

  await core.executeAsModal(
    async () => {
      await action.batchPlay(
        [
          {
            _obj: 'placeEvent',
            null: {
              _path: token,
              _kind: 'local'
            },
            freeTransformCenterState: {
              _enum: 'quadCenterState',
              _value: 'QCSAverage'
            },
            offset: {
              _obj: 'offset',
              horizontal: {
                _unit: 'pixelsUnit',
                _value: 0
              },
              vertical: {
                _unit: 'pixelsUnit',
                _value: 0
              }
            },
            _isCommand: false,
            _options: {
              dialogOptions: 'dontDisplay'
            }
          }
        ],
        {}
      )
    },
    { commandName: 'Place Image' }
  )

  return app.activeDocument.activeLayers[0]
}
```

置入后铺满文档：

```ts
export async function placeImageFullCanvas() {
  const photoshop = globalThis.require('photoshop')
  const { app, constants, core } = photoshop
  const layer = await placeImageFromFilePicker()

  if (!layer) {
    return null
  }

  await core.executeAsModal(
    async () => {
      const doc = app.activeDocument
      const target = normalizeBounds(docBounds(doc))
      const current = normalizeBounds(layer.boundsNoEffects)
      const currentWidth = current.right - current.left
      const currentHeight = current.bottom - current.top
      const scaleX = ((target.right - target.left) / currentWidth) * 100
      const scaleY = ((target.bottom - target.top) / currentHeight) * 100

      await layer.scale(scaleX, scaleY, constants.AnchorPosition.TOPLEFT)

      const next = normalizeBounds(layer.boundsNoEffects)
      await layer.translate(target.left - next.left, target.top - next.top)
    },
    { commandName: 'Fit Image To Canvas' }
  )

  return layer
}
```

置入到固定位置和尺寸：

```ts
export async function placeImageAtRect(rect: PixelBounds) {
  const photoshop = globalThis.require('photoshop')
  const { constants, core } = photoshop
  const layer = await placeImageFromFilePicker()

  if (!layer) {
    return null
  }

  await core.executeAsModal(
    async () => {
      const target = normalizeBounds(rect)
      const current = normalizeBounds(layer.boundsNoEffects)
      const currentWidth = current.right - current.left
      const currentHeight = current.bottom - current.top
      const scaleX = ((target.right - target.left) / currentWidth) * 100
      const scaleY = ((target.bottom - target.top) / currentHeight) * 100

      await layer.scale(scaleX, scaleY, constants.AnchorPosition.TOPLEFT)

      const next = normalizeBounds(layer.boundsNoEffects)
      await layer.translate(target.left - next.left, target.top - next.top)
    },
    { commandName: 'Place Image At Rect' }
  )

  return layer
}
```

### 写入像素到图层

已有 `Uint8Array` 像素数据时，先创建 `PhotoshopImageData`，再 `putPixels()` 到目标 pixel layer。目标图层必须是像素图层；智能对象、文字、组图层需要先走 DOM 或 `batchPlay` 转换。

```ts
export async function putRgbaPixelsIntoLayer(options: {
  layerID: number
  data: Uint8Array
  width: number
  height: number
  left: number
  top: number
}) {
  const photoshop = globalThis.require('photoshop')
  const { core, imaging } = photoshop
  const imageData = await imaging.createImageDataFromBuffer(options.data, {
    width: options.width,
    height: options.height,
    components: 4,
    colorProfile: 'sRGB IEC61966-2.1',
    colorSpace: 'RGB'
  })

  try {
    await core.executeAsModal(
      async () => {
        await imaging.putPixels({
          layerID: options.layerID,
          imageData,
          replace: false,
          targetBounds: {
            left: options.left,
            top: options.top
          },
          commandName: 'Put Pixels'
        })
      },
      { commandName: 'Put Pixels' }
    )
  } finally {
    imageData.dispose()
  }
}
```

## UXP UI 开发实践

UXP 面板运行环境不同于浏览器页面。HTML、CSS、JavaScript 的写法相似，但运行环境、文件权限、宿主 API、组件支持和调试方式都受 UXP 限制。UI 方案要先从 UXP 与 Photoshop 实际能力出发。

调研依据：

- Adobe Photoshop Code Samples 明确写到：复杂 UI 可以使用 React、Vue、Svelte，但 Adobe 不指定唯一推荐库，需要开发者按项目选择。
- Adobe UXP Toolchain 文档把原生 HTML/CSS/JS 作为简单插件路径，把 React 和 Node/npm 工具链作为非平凡 UI 的常见路径。
- Adobe Spectrum UXP Widgets 文档说明内置 `sp-*` 组件可直接使用，无需 React 或 Vue。
- Adobe SWC 文档说明 UXP v7.0 起支持 Spectrum Web Components，使用时需要 `featureFlags.enableSWCSupport`、安装组件并 import。
- Adobe 跨 UXP 平台 UI 文档把 SWC 列为面向后续的推荐组件方向，复杂应用可使用 React、Vue、Svelte。
- Adobe Photoshop samples 同时提供 `hello-world-panel-js-sample`、`vanilla-js-sample`、`ui-react-starter`、`ui-vue-3-starter`、`ui-svelte-starter`、`swc-uxp-starter`、`swc-uxp-react-starter`。
- Bolt UXP 是社区生产实践，提供 React、Vue、Svelte + Vite + TypeScript 路线，并在 2026 年加入 WebView UI 以解决复杂界面限制。

当前项目建议：

- 继续使用 Vue 3 + Vite + TypeScript。这个仓库已经验证了 Vue 3 静态 bundle、manifest v5、UDT 加载、面板挂载和 Photoshop command。
- Vue 只负责面板 UI 和状态组织，Photoshop 能力封装放在 `src/uxp/photoshopHost.ts`，状态和副作用放在 `src/composables/`。
- 使用 Composition API 与 `<script setup lang="ts">`，保持 props down / events up，复杂状态抽到 composable。
- 面板内优先使用内置 Spectrum UXP widgets 和 host CSS 变量。需要更多 Spectrum 能力时，再引入 SWC。
- 当前仓库暂不迁移 React。React 的 Adobe sample 更多，SWC React starter 更完整，但迁移成本高于收益。
- 当前仓库暂不使用 WebView UI。只有当 UXP 原生 UI 无法满足复杂布局、动画、浏览器兼容能力时，再评估 Bolt UXP WebView UI。

### UI 技术选型

| 方案 | 适合场景 | 主要成本 | 本项目结论 |
| --- | --- | --- | --- |
| 原生 HTML/CSS/JS | 命令型插件、简单 panel、少量表单、验证 UXP API | 手写状态管理，复杂界面容易散 | 用于最小样例和 API 回归 |
| Vue 3 | 中等复杂面板、表单、预览、状态清晰的小团队开发 | Adobe 官方样例少于 React；需要处理 UXP 构建约束 | 当前主线 |
| React | 大型面板、团队已有 React 经验、需要 React wrappers for SWC | 依赖、bundle、JSX 类型声明和 UXP 调试成本更高 | 新大型项目可选 |
| Svelte | 追求小 bundle、编译后运行时代码更少 | 团队经验和生态要单独评估 | 可作为轻量替代 |
| Spectrum UXP Widgets | Photoshop 风格按钮、输入框、选择器、滑块 | 能力有限，调试黑盒 | 默认控件层 |
| Spectrum Web Components | 更多 Spectrum 组件、后续 Adobe 方向、跨框架组件 | manifest flag、组件依赖、版本锁定、import 管理 | 按需引入 |
| Bolt UXP WebView UI | 复杂布局、动画、需要更完整浏览器能力、迁移 Web app | UXP backend 与 WebView UI 通信、架构复杂度 | 暂不使用 |

选择规则：

- 简单表单和布局可以用普通 HTML + 本地 CSS。
- 常规 Photoshop 风格控件优先用内置 Spectrum UXP widgets，例如 `sp-button`、`sp-textfield`、`sp-checkbox`、`sp-slider`、`sp-picker`。
- 需要更多 Spectrum 组件时评估 SWC。SWC 需要 `featureFlags.enableSWCSupport`、单个组件安装和 import，并用 `<sp-theme>` 提供设计 token。
- 同一个面板内可以混用 HTML、Spectrum UXP widgets、SWC，但要记录每个组件来源，避免同名 `sp-*` 标签混淆。
- 已经选择 Vue 的项目不因为 Adobe sample 里有 React 就切换。只有组件生态、团队经验、SWC React wrapper 或大型状态管理确实需要 React 时才迁移。
- 新项目先判断 UI 复杂度。命令和简单 panel 用原生 JS；中等复杂面板用 Vue 或 React；复杂浏览器级界面评估 Bolt UXP WebView UI。

### UXP 与网页前端的差异

| 维度 | 网页前端 | UXP 插件 UI |
| --- | --- | --- |
| 运行环境 | 浏览器页面 | 宿主应用里的 panel、dialog、command |
| API 边界 | Web API、后端 API | `require("uxp")` 与 `require("photoshop")` |
| 文件权限 | 浏览器沙箱、上传下载、File API | 插件目录、data、temp 可直接访问；其他位置需用户授权或 token |
| UI 组件 | 任意 Web UI 库 | HTML 子集、Spectrum UXP widgets、SWC |
| CSS 能力 | 浏览器完整能力 | UXP 支持子集，需查 UXP CSS/HTML 参考 |
| 开发服务 | dev server、HMR 常规可用 | 最终运行在静态插件包，UDT Load/Reload 是主循环 |
| 状态修改 | DOM / App state / 后端 state | 修改 Photoshop 文档要 `executeAsModal()` |
| 调试 | 浏览器 DevTools | UXP Developer Tools、Photoshop UXP log、宿主内实测 |
| 发布产物 | Web bundle 部署到服务器 | manifest、icons、HTML、JS、CSS 打包为 UXP/CCX |

开发时要按 UXP 思路拆层：

- UI 层负责输入、展示、进度和错误状态。
- Host 层负责 `require("photoshop")`、`require("uxp")`、`batchPlay`、`imaging`、`executeAsModal()`。
- 文件层负责 `localFileSystem`、session token、persistent token、临时目录。
- 大图像数据不要进入深层 reactive state，读取后尽快 `dispose()`。

### Vue 面板基线

当前项目基线：

- 使用 Vue 3 + Composition API + `<script setup lang="ts">`。
- Vue 只作为静态 bundle 运行在 UXP 面板里。
- UXP 入口继续使用 `globalThis.require("uxp")` 和 `globalThis.require("photoshop")`。
- 避免 dev server、HMR、动态 import、`eval`、`new Function`。
- 复杂 Photoshop 状态和副作用放进 composable，例如 `usePhotoshopProbe()`，组件只负责渲染和事件分发。
- 面板 state 使用最小 reactive 数据；图像二进制、Photoshop layer/document handle 用局部变量或 `shallowRef`，不要深度代理。

面板与对话框：

- 用户需要边看画布边操作时用 panel。
- 只执行一次动作，且动作期间不需要继续操作画布时用 dialog。
- 面板允许用户调整宽高，避免设置大于 `240px` 的最小固定宽度。
- 长时间任务显示明确进度，`executeAsModal()` 内使用 `executionContext.reportProgress()`。

Photoshop 主题和图标：

- manifest 内保留 light/dark 图标配置。
- UI 色彩尽量使用 Spectrum 组件或 CSS 变量，减少硬编码浅色或深色。
- 面板在 light、lightest、dark、darkest 下都要看一遍。
- 图标文件名和尺寸要和 manifest 的 `scale`、`theme` 配置一致。

Vue 面板结构：

```text
src/uxp/photoshopHost.ts
src/composables/usePhotoshopProbe.ts
src/components/<feature>/*.vue
src/App.vue
```

职责边界：

- `photoshopHost.ts`：只封装 Photoshop/UXP 运行时 API。
- `composables/`：封装状态、异步调用、错误归一化和取消逻辑。
- `components/`：展示控件、表单和预览，不直接拼 `batchPlay` descriptor。
- `App.vue`：组合 feature，不承载大量业务逻辑。

调试与验证：

- UI 预览先用浏览器验证 Vue 基础渲染。
- Photoshop API 必须在 UXP runtime 中验证。
- manifest、entrypoint、icon、权限变化后执行 `Unload` / `Load`。
- Vue、TS、CSS 变化后执行构建，再在 UDT 里 `Reload`。
- 涉及图像数据的功能要验证小图、超大图、透明图层、空选区、无文档、无选中图层。
- 涉及置入文件的功能要验证取消文件选择、无权限文件、PSD/PNG/JPEG、置入后图层 bounds。

## 常见问题

`Plugin rejected ... due to invalid object`：

先确认 UDT 模板插件也能否加载。如果模板也失败，重启 Photoshop 和 UXP Developer Tools。之前本机遇到过宿主状态卡住，重启后恢复。

`Could not find command createLayer in manifest`：

manifest 缓存旧了。对插件执行 `Unload`，再点 `Load`。

面板窗口看起来是黑的：

先看 Photoshop UXP log。当前项目会输出 `script loaded`、`panel create`、`Vue panel mounted`、`panel text ...`。只要 `panel text` 里有 UI 文案，说明 Vue DOM 已生成。本机的屏幕捕获对 Photoshop/UDT 浮动窗口不稳定，命令入口验证更可靠。

菜单里没有新 command：

确认加载的是 `dist/ps-uxp/manifest.json`，并执行完整 `Unload` / `Load`。

构建后的 HTML 还有 `type="module"`：

检查 `vite.uxp.config.ts` 的 post-build 插件有没有执行。`npm run verify:uxp` 会直接失败。

## 本机验证记录

环境：

```text
Adobe Photoshop 2026 27.3.0
Adobe UXP Developer Tools 2.2.1
```

静态构建：

```text
npm run verify:uxp
UXP build verified: dist/ps-uxp
```

UDT：

```text
com.tanshow.lightyearbanana
Plugin Load Successful
State: Loaded
```

Photoshop 菜单命令：

```text
执行前：1|Lightyear Banana Test|1|背景
执行后：1|Lightyear Banana Test|2|Lightyear Banana
```

UXP log：

```text
[Lightyear Banana] script loaded true
[Lightyear Banana] panel create
[Lightyear Banana] Vue panel mounted
[Lightyear Banana] panel text Photoshop UXP...
[Lightyear Banana] command createLayer
[Lightyear Banana] command createLayer done
```

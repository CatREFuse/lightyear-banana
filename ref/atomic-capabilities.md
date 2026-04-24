# 原子能力参考

## UXP entrypoint

源码入口是 `src/uxp/main.ts`。

当前 manifest 注册两个 entrypoint：

- `commands.createLayer`
- `panels.panel`

`entrypoints.setup()` 中的 key 必须和 `plugin/manifest.json` 里的 `id` 完全一致。修改 command、panel、id、权限、图标后，需要重新构建并在 UXP Developer Tools 里 `Unload` / `Load`。

## Vue panel 挂载

Vue 只在 panel `create()` 或 `show()` 中挂载。当前入口会先补齐 UXP 中缺失的 `SVGElement`：

```ts
if (typeof uxpGlobal.SVGElement === 'undefined' && typeof uxpGlobal.Element !== 'undefined') {
  uxpGlobal.SVGElement = uxpGlobal.Element as typeof SVGElement
}
```

这是 Vue 3 在 UXP 中运行的关键兼容处理。

## Photoshop runtime

Photoshop API 通过 `globalThis.require("photoshop")` 获取。不要把 `photoshop` 当作普通 ESM 包 import。

当前 runtime 封装在 `src/uxp/photoshopHost.ts`：

- `getHostRequire()`
- `readActiveDocumentLabel()`
- `createNamedLayer()`

浏览器预览中 `getHostRequire()` 返回 `null`。

## Modal execution

修改 Photoshop 文档状态时使用：

```ts
await photoshop.core.executeAsModal(async () => {
  // Photoshop document mutation
}, { commandName: '...' })
```

当前写入图层、创建图层、读取交互验证中的关键 Photoshop 动作都走 modal scope。长任务后续需要用 `executionContext.reportProgress()` 做进度反馈。

## BatchPlay

DOM API 覆盖不到时使用 `photoshop.action.batchPlay()`。当前 `createNamedLayer()` 和 `createPixelLayer()` 用 batchPlay 创建 layer。

复杂 descriptor 不凭空手写，优先通过：

- Adobe 官方文档
- Photoshop Actions 面板 `Copy As JavaScript`
- 实际运行日志

## Imaging

当前核心 imaging 能力：

- `imaging.getPixels()`：读取可见合成图或指定 layer 像素。
- `imaging.getSelection()`：读取选区 mask。
- `imaging.createImageDataFromBuffer()`：把 RGBA/RGB buffer 转成 Photoshop image data。
- `imaging.encodeImageData()`：生成 panel 预览 data URL。
- `imaging.putPixels()`：写入像素到 pixel layer。

资源释放规则：

- `getPixels()`、`getSelection()`、`createImageDataFromBuffer()` 返回的 image data 用完必须 `dispose()`。
- 大图像不要长期留在 Vue 深层响应式对象里。

## 选区能力

选区读取流程：

1. `imaging.getSelection()` 取得 selection image data。
2. 转为 mask。
3. 计算 mask 有效边界。
4. 使用边界抓取 composite pixels。
5. 用 mask 合成透明 RGBA。

无有效选区时抛出 `当前没有可读取的选区`。

## 图层能力

图层抓取读取 `activeDocument.activeLayers[0]`。图层边界优先使用 `boundsNoEffects`，再回退到 `bounds`，最后与文档边界取交集。

没有选中图层时抛出 `当前没有选中图层`。

## 插图能力

插图流程：

1. 根据目标宽高 resize RGBA。
2. 创建 pixel layer。
3. 用 `createImageDataFromBuffer()` 创建 image data。
4. 用 `putPixels()` 写入目标位置。
5. dispose image data。

当前返回值是实际写入的 `{ left, top, width, height }`。

## 文件访问能力

当前实现还没有外部文件置入。后续从用户选择文件导入图片时，使用 UXP 文件系统能力：

- `localFileSystem.getFileForOpening()`
- `localFileSystem.getFileForSaving()`
- `localFileSystem.createSessionToken(file)`

Photoshop 需要访问 UXP file entry 时用 session token，不直接传 native path。


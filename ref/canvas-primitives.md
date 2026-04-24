# 交互原语参考

## 分层原则

画布交互能力分为两层：

- `src/uxp/canvasPrimitiveService.ts` 面向业务调用。
- `src/uxp/canvasPrimitives.ts` 面向 Photoshop API 细节。

业务代码默认调用 `canvasPrimitiveService`。只有新增 Photoshop 底层能力时，才进入 `canvasPrimitives.ts`。

## 类型约定

```ts
type CanvasInsertTarget = {
  left: number
  top: number
  width: number
  height: number
}

type CanvasSize = {
  width: number
  height: number
}

type CapturedCanvasImage = {
  id: string
  label: string
  width: number
  height: number
  sourceBounds: {
    left: number
    top: number
    right: number
    bottom: number
  }
  previewUrl: string
  rgba: Uint8Array
}
```

坐标使用 Photoshop 文档坐标系，左上角是 `{ left: 0, top: 0 }`。`right` 和 `bottom` 作为开区间边界，宽度是 `right - left`，高度是 `bottom - top`。

## 当前服务层能力

| 能力 | 服务层方法 | 底层能力 |
| --- | --- | --- |
| 抓取可见图像 | `captureVisibleImage()` | `imaging.getPixels({ documentID })` |
| 抓取选区图像 | `captureSelectionImage()` | `imaging.getSelection()` + `imaging.getPixels()` |
| 抓取选中图层 | `captureSelectedLayerImage()` | `imaging.getPixels({ layerID })` |
| 创建 sample 图片 | `createSampleImage()` | 本地 RGBA buffer |
| 读取画布尺寸 | `readCanvasSize()` | `app.activeDocument.width/height` |
| 读取选区写入位置 | `readSelectionTarget()` | `imaging.getSelection()` |
| 插入图片到指定位置 | `insertImage(image, target)` | `imaging.putPixels()` |
| 插入图片铺满画布 | `insertImageToFullCanvas(image)` | `readCanvasSize()` + `insertImage()` |
| 插入图片到选区位置 | `insertImageToSelection(image)` | `readSelectionTarget()` + `insertImage()` |

## 常用组合

抓取当前选中图层并插入到选区：

```ts
const image = await canvasPrimitiveService.captureSelectedLayerImage()
await canvasPrimitiveService.insertImageToSelection(image)
```

抓取当前可见画面并铺满写回：

```ts
const image = await canvasPrimitiveService.captureVisibleImage()
await canvasPrimitiveService.insertImageToFullCanvas(image)
```

插入到固定坐标：

```ts
const image = canvasPrimitiveService.createSampleImage()

await canvasPrimitiveService.insertImage(image, {
  left: 80,
  top: 80,
  width: 320,
  height: 240
})
```

## 底层实现要点

- `getPixels()` 用于读取可见合成图或指定图层。
- `getSelection()` 用于读取选区 mask。
- `putPixels()` 用于写入像素。
- `encodeImageData()` 用于生成面板预览。
- 写入 Photoshop 文档时进入 `core.executeAsModal()`。
- 每个 `PhotoshopImageData` 都在 `finally` 中 `dispose()`。
- Vue 层用 `shallowRef` 保存图像数据，避免深层代理大 `Uint8Array`。

## 已知限制

- 当前只处理 8-bit 图像。
- 选区相关能力依赖当前文档存在有效选区。
- 选中图层相关能力读取 `activeDocument.activeLayers[0]`。
- `CapturedCanvasImage.rgba` 可能很大，不适合长期放在响应式状态里。

## 扩展路径

新增画布能力时按这个顺序改：

1. 在 `src/uxp/canvasPrimitives.ts` 增加最小原子函数。
2. 在 `src/uxp/canvasPrimitiveService.ts` 暴露稳定方法。
3. 在 `src/composables/useCanvasProbe.ts` 或后续业务 composable 中组织状态。
4. 在面板或业务 UI 中调用服务层。
5. 更新 `ref/canvas-primitives.md` 或对应参考文件。

## 待补能力

- 按任意坐标矩形抓取可见图像。
- 按任意坐标矩形抓取指定图层。
- 抓取指定画板范围。
- 导出画板到文件。
- 从用户选择的文件置入图片。


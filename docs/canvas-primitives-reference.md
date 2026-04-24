# Photoshop 画板交互原语参考

本文档记录当前已经验证过的 Photoshop 画板交互能力。后续业务功能优先依赖服务层入口，底层 Photoshop API 细节集中维护在原语实现里。

## 代码入口

服务层：

```ts
import { canvasPrimitiveService } from '../uxp/canvasPrimitiveService'
```

底层实现：

```text
src/uxp/canvasPrimitives.ts
```

业务代码默认使用 `canvasPrimitiveService`。需要扩展 Photoshop 细节时，再进入 `canvasPrimitives.ts` 增加原子函数。

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

坐标使用 Photoshop 文档坐标系，左上角为 `{ left: 0, top: 0 }`。`sourceBounds.right` 和 `sourceBounds.bottom` 表示开区间边界，宽度是 `right - left`，高度是 `bottom - top`。

## 能力索引

| 能力 | 服务层方法 | 底层 Photoshop 能力 | 返回 |
| --- | --- | --- | --- |
| 抓取可见图像 | `captureVisibleImage()` | `imaging.getPixels({ documentID })` | `CapturedCanvasImage` |
| 抓取选区图像 | `captureSelectionImage()` | `imaging.getSelection()` + `imaging.getPixels()` | `CapturedCanvasImage` |
| 抓取选中图层 | `captureSelectedLayerImage()` | `imaging.getPixels({ layerID })` | `CapturedCanvasImage` |
| 读取画布尺寸 | `readCanvasSize()` | `app.activeDocument.width/height` | `CanvasSize` |
| 读取选区写入位置 | `readSelectionTarget()` | `imaging.getSelection()` | `CanvasInsertTarget` |
| 插入图片到指定位置 | `insertImage(image, target)` | `imaging.putPixels()` | `CanvasInsertTarget` |
| 插入图片铺满画布 | `insertImageToFullCanvas(image)` | `readCanvasSize()` + `putPixels()` | `CanvasInsertTarget` |
| 插入图片到选区位置 | `insertImageToSelection(image)` | `readSelectionTarget()` + `putPixels()` | `CanvasInsertTarget` |
| 创建 sample 图片 | `createSampleImage()` | 本地 RGBA buffer | `CapturedCanvasImage` |

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

## 分层职责

`canvasPrimitiveService.ts` 面向业务使用：

- 提供稳定方法名。
- 组合多个底层原语。
- 统一插入目标类型。
- 让 Vue composable 和未来业务模块不直接依赖 Photoshop descriptor 细节。

`canvasPrimitives.ts` 面向 Photoshop 交互：

- 读取 `require('photoshop')`。
- 进入 `core.executeAsModal()`。
- 调用 `imaging.getPixels()`、`imaging.getSelection()`、`imaging.putPixels()`。
- 处理图层 bounds、选区 mask、RGBA 转换、预览 data URL。
- 释放 `PhotoshopImageData`。

## 使用约定

修改 Photoshop 文档状态的能力都要通过 modal scope 执行。当前写入路径已经在底层使用 `core.executeAsModal()`。

`CapturedCanvasImage.rgba` 可能很大。Vue 层使用 `shallowRef` 保存图像列表，避免深层响应式代理二进制数据。长期业务缓存建议保存缩略图、临时文件路径或业务 ID。

选区相关能力依赖当前文档存在有效选区。没有选区时，底层会抛出 `当前没有可读取的选区`。

选中图层相关能力读取 `activeDocument.activeLayers[0]`。没有选中图层时，底层会抛出 `当前没有选中图层`。

当前验证模型只处理 8-bit 图像。后续要支持 16-bit 或 32-bit，需要扩展 `requireUint8()` 和 RGBA 转换流程。

## 已验证行为

当前插件验证过以下路径：

- 抓取可见图像并在面板显示。
- 抓取选区图像并在面板显示。
- 抓取选中图层并在面板显示。
- 插入 sample 图片到全图。
- 插入 sample 图片到选区位置。
- 插入 sample 图片到指定坐标和尺寸。

最近一次 UXP 运行时验证中，`抓取选中图层` 成功生成预览图，当前图像显示为 `326 × 165`，图像列表显示 `选中图层：UXP 插入 Sample Image`。

## 扩展清单

后续新增业务能力时，优先按这个顺序扩展：

1. 在 `canvasPrimitives.ts` 增加最小 Photoshop 原子函数。
2. 在 `canvasPrimitiveService.ts` 暴露稳定业务方法。
3. 在验证 UI 或业务 composable 中调用服务层。
4. 在本文档补充方法、输入输出和验证结果。

待补能力：

- 按任意坐标矩形抓取可见图像。
- 按任意坐标矩形抓取指定图层。
- 抓取指定画板范围。
- 导出画板到文件。
- 从用户选择的文件置入图片。

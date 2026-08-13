# 原子能力参考

## CCX entrypoint

源码入口是 `plug-in/src/ccx/main.ts`。

当前 manifest 注册两个 entrypoint：

- `commands.createLayer`
- `panels.panel`

`entrypoints.setup()` 中的 key 必须和 `plug-in/manifest.json` 里的 `id` 完全一致。修改 command、panel、id、权限、图标后，需要重新构建并在 UXP Developer Tools 里 `Unload` / `Load`。

## CCX Host 壳与 WebView

`plug-in/src/ccx/main.ts` 在 panel `create()` 或 `show()` 时挂载 Host 壳，建立会话、命令注册和 WebView。工作台 Vue 应用来自 `https://mugen.catrefuse.com/webui/`，与普通浏览器使用同一云端部署页面。

Host 壳负责：

- 创建和销毁 WebView 会话。
- 校验 `inner-host` 消息信封、会话和命令白名单。
- 把 Photoshop、资产、Provider、存储与确认能力暴露给受信任云端 Origin 的 WebView。
- 在断连时释放会话与资产。

早期把 Vue 直接挂载到 UXP DOM 的方案已归档，不作为 vNext 工作台架构。

## Photoshop runtime

Photoshop API 通过 `globalThis.require("photoshop")` 获取。不要把 `photoshop` 当作普通 ESM 包 import。

低层 Adobe runtime 封装集中在 `plug-in/src/ccx/`。普通浏览器 WebUI 不加载这些模块，也不提供假的 `getHostRequire()` 或 Photoshop adapter。只有 CCX Host 可以访问 `globalThis.require("photoshop")`。

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
4. 创建只含可见图层合成结果的临时文档副本。
5. 使用边界从副本合并图层抓取 composite pixels。
6. 用 mask 合成透明 RGBA，并关闭临时副本且不保存。

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

当前本地参考图通过用户选择文件导入，使用 UXP 文件系统能力：

- `localFileSystem.getFileForOpening()`
- `localFileSystem.getFileForSaving()`
- `localFileSystem.createSessionToken(file)`

Photoshop 需要访问 UXP file entry 时直接传 File Entry 或使用 session token，不传 native path。上传缩略图由 `app.open(file)` 与 imaging 生成，原图字节保存在 Host AssetStore。

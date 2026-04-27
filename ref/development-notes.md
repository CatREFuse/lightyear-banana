# 开发注意事项

## 重要版本标记

### 2026-04-27 技术原型实现

- flag：技术原型实现
- git tag：`v0.1.0-tech-prototype`
- 用途：作为生图 API mock server、多 provider 配置、mock 模式、模型请求链路、消息 loading、参考图缓存、设置持久化和键盘发送交互的回溯点。
- 状态：浏览器预览链路已完成技术原型验证，UXP 构建校验通过；真实 Photoshop 运行时仍需按 UXP 验证顺序回归。
- 回溯建议：后续大改模型配置、mock server 协议、图片返回结构、消息区交互或设置持久化时，优先对比这个标记版本。

## 开发循环

改 Vue、TypeScript、CSS 后：

```bash
npm run build:uxp
```

然后在 UXP Developer Tools 点击 `Reload`。

改 manifest、entrypoint id、command、panel、icon、权限后：

```bash
npm run verify:uxp
```

然后在 UXP Developer Tools 先 `Unload`，再 `Load`。只点 `Reload` 容易继续使用旧 manifest。

## 验证顺序

推荐每次能力改动后按这个顺序验证：

1. `npm run verify:uxp`
2. UXP Developer Tools 加载 `dist/ps-uxp/manifest.json`
3. Photoshop 菜单 command 可执行
4. panel 可以打开并挂载 Vue
5. 目标 Photoshop 能力在真实文档里执行
6. Photoshop UXP log 没有 fatal error

## 浏览器预览边界

`npm run dev` 只验证 Vue UI 和 fallback 状态。所有 Photoshop 文档、选区、图层、像素、文件 token 能力都必须在 UXP runtime 中验证。

## 错误处理

面板用户可见状态放在 composable 中统一管理。当前 `useCanvasProbe()` 使用 `busy`、`status`、`documentLabel`、`lastInsert`、`capturedImages` 组织交互状态。

常见错误：

- 没有打开文档。
- 没有有效选区。
- 没有选中图层。
- 当前图像不是 8-bit。
- UXP runtime 不存在。

错误文案需要给普通使用者看得懂，避免把 API descriptor、内部模块名、构建细节直接暴露在面板正文里。

## Photoshop API 规则

- 修改文档状态必须进入 `core.executeAsModal()`。
- modal scope 内只做必要宿主操作。
- DOM API 能完成时优先使用 DOM API。
- DOM API 不覆盖时使用 batchPlay。
- batchPlay descriptor 要通过文档、Actions 面板或实测校准。
- image data 用完必须 `dispose()`。

## 图像数据规则

- `Uint8Array` 可能很大，避免深层 reactive。
- 预览图用 data URL 或后续临时文件路径。
- 写入前明确宽高和目标坐标。
- 选区和图层 bounds 要和文档 bounds 取交集。
- 后续支持 16-bit、32-bit 时需要扩展 RGBA 转换。

## UI 规则

- 面板优先适配停靠空间。
- 用户需要边看画布边操作时用 panel。
- 一次性确认、导入、导出可以用 dialog。
- 长任务需要进度反馈。
- light、lightest、dark、darkest 主题都要检查。
- 文案直接写面向用户的操作和状态，不写工程说明。

## 打包规则

生成 CCX：

```bash
npm run package:uxp
```

打包前会先执行 `verify:uxp`。产物写入 `dist/${npm_package_name}-${npm_package_version}.ccx`。

## 文档维护

新增或修改基础能力时同步更新：

- `ref/canvas-primitives.md`
- `ref/atomic-capabilities.md`
- `ref/development-notes.md`

如果只是保留研究过程和来源，放到 `docs/`。如果是后续开发要直接查的规则，放到 `ref/`。

# Lightyear Banana Standalone UXP Plugin

这个目录是独立 Photoshop UXP 插件原型。它不依赖 Vite 构建，直接在 UXP Developer Tools 中加载。

## 加载

在 UXP Developer Tools 中选择：

```text
standalone-uxp-plugin/manifest.json
```

## 当前能力

- 打开 Photoshop 面板。
- 读取当前文档名称和尺寸。
- 从当前文档添加可见图层、选区、当前图层作为参考图。
- 添加上传文件和剪贴板 Mock 参考图。
- 管理多张参考图，支持删除和清空。
- 选择模型、尺寸、质量、数量和比例。
- 生成一张本地 Mock 结果图。
- 查看生成耗时和会话记录。
- 把结果加入下一轮参考图。
- 把结果填入超分参数。
- 把结果置入全画布、当前选区或参考图位置。
- 通过菜单命令创建 `Lightyear Banana` 图层。

## 校验

```bash
node standalone-uxp-plugin/verify.mjs
node standalone-uxp-plugin/smoke-test.mjs
node standalone-uxp-plugin/package.mjs
```

## 约束

- 面板控件优先使用 Spectrum UXP Widgets。
- 文档写入必须进入 `core.executeAsModal()`。
- 图像写入使用 `imaging.putPixels()`。
- 当前只覆盖 8-bit 图像路径。

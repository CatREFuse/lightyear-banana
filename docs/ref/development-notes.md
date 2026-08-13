# 开发注意事项

## 2026-08-11 vNext 边界

- Electron 桌面端、Inner WebUI 0.1 与旧官网已归档；独立 UXP 产品代码已删除。
- WebUI vNext 从 Electron UI 源码平移，并在 Browser adapter 与 CCX Host adapter 中运行。
- 普通浏览器具备真实网络和配置能力，不显示 Photoshop 读取或置入入口。
- CCX Host 继续通过 Adobe 插件 API 提供画布、置入和 SecureStorage。
- APIMart 冒烟固定返回同一张小猫；浏览器验证网络与配置，CCX 在真实 Photoshop 验证抓取到置入的完整闭环。

## 重要版本标记

### 2026-04-27 技术原型实现（归档）

- flag：技术原型实现
- git tag：`v0.1.0-tech-prototype`
- 用途：作为生图 API mock server、多 provider 配置、mock 模式、模型请求链路、消息 loading、参考图缓存、设置持久化和键盘发送交互的回溯点。
- 状态：旧浏览器预览链路曾完成技术原型验证；这些结果不计入 vNext 双运行时验收。
- 回溯建议：后续大改模型配置、mock server 协议、图片返回结构、消息区交互或设置持久化时，优先对比这个标记版本。

## 开发循环

改 Vue、TypeScript、CSS 后：

```bash
npm run build:ccx
```

然后在 UXP Developer Tools 点击 `Reload`。

改 manifest、entrypoint id、command、panel、icon、权限后：

```bash
npm run verify:ccx
```

然后在 UXP Developer Tools 先 `Unload`，再 `Load`。只点 `Reload` 容易继续使用旧 manifest。

## 验证顺序

推荐每次能力改动后按这个顺序验证：

1. `npm run verify:ccx`
2. Adobe UXP Developer Tools 加载 `dist/ccx-host/manifest.json`
3. Photoshop 菜单 command 可执行
4. panel 可以打开 Host 壳并加载 `https://mugen.catrefuse.com/webui/`
5. Host 握手与 runtime capability 正确
6. 目标 Photoshop 能力在真实文档里执行
7. Photoshop UXP log 没有 fatal error

## 双运行时边界

`npm run dev:inner-webui` 启动普通浏览器运行时。它需要验证 Provider 配置、真实网络、持久化和结果流程；不得注入 Mock Host 或返回 Mock 画布。所有 Photoshop 文档、选区、图层、像素、文件 token 与置入能力只在 CCX 中出现，并必须在真实 Photoshop 验证。

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

构建并校验 CCX Host：

```bash
npm run verify:ccx
```

在干净工作树中运行发布脚本：

```powershell
npm run package:ccx:local
```

发布脚本从不可变 staging 快照生成 UDT 格式兼容归档，回读校验文件集、Manifest 和逐文件内容，随后生成 `dist/mugen-<version>.ccx`、`.sha256` 与 `dist/ccx-release.json`。ZIP 特征和允许的 Manifest 末尾换行差异见 `docs/ref/framework-build.md`。

## Windows Codex 插件索引修复

如果 Codex 官方插件或官方 marketplace 突然不可见，先检查：

```powershell
Test-Path "$env:USERPROFILE\.codex\.tmp\bundled-marketplaces\openai-bundled\.agents\plugins\marketplace.json"
```

如果返回 `False`，运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File utils/rebuild-codex-windows.ps1 -Apply
```

脚本会从当前安装的 Codex Windows app 中恢复 `openai-bundled` marketplace，并把派生缓存移动到 `.codex\.repair-backups\`。完成后重启 Codex，让插件目录重新索引。

如果安装过的插件 bundle 缓存也需要重建，再运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File utils/rebuild-codex-windows.ps1 -Apply -Full
```

`-Full` 会同时备份清空 `.codex\plugins\cache`，重启后由 Codex 重新生成。

## 文档维护

新增或修改基础能力时同步更新：

- `docs/ref/canvas-primitives.md`
- `docs/ref/atomic-capabilities.md`
- `docs/ref/development-notes.md`

如果只是保留研究过程和来源，放到 `docs/`。如果是后续开发要直接查的规则，放到 `ref/`。

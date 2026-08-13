# CCX + Inner WebUI 开发 Cookbook

日期：2026-08-13

本手册面向 Mugen 的 Photoshop CCX Host 与 Inner WebUI 开发。它记录当前仓库已经验证的分层方式、原子能力配方、调试路径和发布门禁，涉及实现时仍需同时核对 `docs/spec.md`、`docs/mugen-prototype-requirements.md` 与对应 Adobe UXP 官方文档。

## 1. 与普通 Web 开发的差异

普通 Web 应用通常只有浏览器页面、服务端 API 和持久化层。Mugen 在 CCX 中有三个独立执行环境：

```text
Vue Inner WebUI
  └─ HostClient + inner-protocol
       └─ CCX Host
            ├─ Photoshop UXP API
            ├─ 文件系统与 SecureStorage
            └─ Provider 网络请求
```

| 维度 | 普通 Web | CCX + Inner WebUI |
| --- | --- | --- |
| 页面运行环境 | 浏览器 | 浏览器或 CCX 远程 WebView |
| 宿主能力 | Web API | Photoshop UXP，只能由 CCX Host 调用 |
| 通信 | HTTP、WebSocket | 受信任云端 Origin 的 message bridge + 版本化协议 |
| 文件访问 | `<input>`、File API | WebView File API 或 UXP `localFileSystem` |
| 剪贴板 | Clipboard API、paste 事件 | WebView paste 事件更稳定；Host API 受 Photoshop/UXP 版本影响 |
| 文档写入 | 无宿主文档 | 必须进入 `core.executeAsModal()` |
| 图片预览 | URL、Blob URL、data URL | UXP DOM 解码能力有限；Host 侧优先走 Photoshop imaging |
| 存储 | localStorage、IndexedDB | WebUI 设置状态 + Host 文件存储 + SecureStorage |
| 调试 | 单个 DevTools | UDT、Host DevTools、WebView DevTools、Photoshop 日志 |
| 发布 | 构建静态站点 | WebUI 与 CCX 独立构建发布，通过协议兼容信息协作 |

关键原则：Vue 组件只表达界面和用户动作；WebUI adapter 只表达 Host 合同；CCX Host 管理会话、存储和 Photoshop 能力；Photoshop descriptor 与像素操作留在 `plug-in/src/ccx/`。

## 2. 仓库分层与修改位置

| 要改的能力 | 主要位置 | 需要同步检查 |
| --- | --- | --- |
| UI、交互、响应式布局 | `webui/src/components/mugen/` | composable、E2E、light/dark |
| WebUI 业务状态 | `webui/src/composables/`、`webui/src/stores/` | Browser/CCX 两种 adapter |
| WebUI ↔ Host 合同 | `packages/inner-protocol/src/index.ts` | payload/result 校验、兼容版本、协议测试 |
| 共享 Provider/图片业务 | `packages/mugen-core/` | capability 测试、两种运行时调用方 |
| Host 命令编排 | `plug-in/src/ccx/inner/` | command registry、资产生命周期、诊断日志 |
| Photoshop 原子能力 | `plug-in/src/ccx/canvasPrimitives.ts` | modal、dispose、真实 Photoshop |
| Photoshop 业务服务 | `plug-in/src/ccx/canvasPrimitiveService.ts` | 原子函数的组合与用户错误 |
| Manifest/入口/权限 | `plug-in/manifest.json`、`plug-in/src/ccx/main.ts` | Unload/Load、`verify:ccx` |
| 版本与发布 | `docs/build-todo-list.md`、`homesite/`、部署文档 | CCX 下载链接、哈希、生产回读 |

跨层修改应沿着“协议 → Host → WebUI adapter → store/composable → component”闭环推进。只改组件通常会在真实 CCX 中暴露缺失的 Host 能力，只改 Host 则无法证明用户路径可用。

## 3. 推荐开发流程

### 3.1 确定行为和运行时

明确功能在 Browser、CCX 或两者中出现，并写出用户动作、成功状态、错误状态和数据上限。涉及已有需求时更新 `docs/spec.md`；交互变化还要核对三份产品/交互规格。

### 3.2 定义协议

新增 Host 能力时，在 `packages/inner-protocol/src/index.ts` 同时完成：

- 命令的 payload/result 类型。
- `HostClient` 方法。
- 命令白名单。
- payload 和 result 的运行时校验。
- 大小、数量、枚举和 MIME 边界。
- 正常与非法输入测试。

协议校验应在消息进入 Host 前拒绝错误数据。不要把 Photoshop 对象、File Entry 或大块 RGBA 放进桥协议。

### 3.3 实现 Host 原子能力

Photoshop 细节放进 `canvasPrimitives.ts`，文件、资产、历史、诊断等职责放进 `plug-in/src/ccx/inner/` 对应服务。命令注册层只做 payload 到服务方法的映射，不在 registry 拼业务逻辑。

### 3.4 接入 WebUI

`webviewHost.ts` 实现真实 HostClient；Browser adapter 只实现浏览器能完成的路径。store 负责持久状态，composable 负责操作状态和用户错误，Vue 组件只发出动作并渲染结果。

### 3.5 分层验证

```text
协议单测
  → core/Host 单测
  → WebUI 组件与 adapter 测试
  → Playwright 双视口 E2E
  → verify:ccx
  → UDT Reload 或 Unload/Load
  → 真实 Photoshop 用户路径
  → 正式打包与生产回读
```

单测通过只能证明函数和合同。涉及文件选择、粘贴、拖入、剪贴板、WebView、Photoshop 文档、下载或安装的功能，必须经过真实界面验收。

## 4. Host 会话与命令 Cookbook

### 4.1 WebView 启动与握手

1. CCX panel 创建 WebView，入口固定为 `https://mugen.catrefuse.com/webui/`。
2. WebUI 发送 `host.handshake`，携带协议版本、WebUI 版本和 nonce。
3. Host 校验来源、消息信封、协议兼容和会话 ID。
4. 握手完成后才开放普通命令。
5. WebView 销毁或重载时释放会话和临时资产。

排查启动失败时按顺序查看：Manifest entrypoint、Host bundle、WebView URL、bridge 权限、握手日志、协议版本。启动诊断文件应覆盖 Photoshop、CCX Host、message bridge 与 WebUI 的同一次会话。

### 4.2 交互命令的等待时间

普通命令可使用短超时；文件选择、保存、原图分片读取等等待用户操作的命令使用交互超时。文件选择器打开后长时间停留属于正常用户操作，不能被 12 秒通用超时截断。

### 4.3 大图片分片传输

WebView 主动粘贴或拖入图片时：

1. 在 WebView 读取原文件并生成小于 16 KB 的 JPEG 缩略图。
2. 原图 data URL 去掉头部，只传 Base64 数据。
3. 每片不超过协议上限，第一片携带 MIME、文件名、来源和缩略图。
4. Host 按 `importId` 聚合，校验元数据一致、索引、总片数和累计大小。
5. 全部分片到齐后组装原图并写入 AssetStore。
6. 完成或失败后删除聚合状态。

桥内不要传整张原图单消息。当前原图上限为 128 MB，缩略图限制应同时在 WebView、协议和 Host 三层执行。

## 5. 图片参考能力 Cookbook

### 5.1 从 Photoshop 可见画布、选区和图层抓图

可见画布使用 `imaging.getPixels()`；选区先读 mask、计算有效边界，再与合成像素相乘；图层读取 active layer 并用 `boundsNoEffects` 或 `bounds` 与文档边界求交。返回的 image data 用完立即 `dispose()`。

成功结果进入 AssetStore，桥上只返回资产指针和受控缩略图。Provider 需要参考图时由 Host 从资产读取原图，避免 WebUI 长期持有 RGBA。

### 5.2 上传本地图片

CCX 的“上传文件”走 UXP `localFileSystem.getFileForOpening()`：

1. 文件选择使用交互超时。
2. `file.read({ format: binary })` 读取原始字节并解析尺寸。
3. 在 `executeAsModal()` 中用 `app.open(file)` 临时打开文件。
4. 用 `imaging.getPixels()` 按缩略图目标尺寸取像素并编码 JPEG。
5. 只关闭本次临时打开的文档，用户原本已打开的同一文档必须保留。
6. AssetStore 保存原图和缩略图，WebUI 显示真实预览。

UXP DOM 的 `<img>` 对 File Entry URL 和 Blob URL 的解码在部分 Photoshop 版本中会停住。Host 缩略图使用 Photoshop imaging 链路更可靠。

### 5.3 主动粘贴图片

在 `.composer` 或提示词输入区监听 `paste`，从 `event.clipboardData.items` 读取第一个 `image/*` File，并立即 `preventDefault()`。WebView 生成缩略图后，通过 `reference.importImageChunk` 导入 Host。

主动粘贴要求用户执行粘贴动作，权限模型清楚，也能避开部分 UXP Host 剪贴板 API 的立即失败。非图片剪贴板继续交给文本输入处理。

### 5.4 拖入图片

`dragover` 阶段只检查 DataTransferItem 的 kind 和 MIME，不依赖 `getAsFile()`；文件对象在 `drop` 阶段从 items 或 files 读取。拖入目标显示“松开添加参考图”，离开整个 composer 后清理悬停状态。

拖入和主动粘贴复用同一个 WebView 预处理与分片导入函数，来源字段用于标签和诊断。

### 5.5 缩略图与原图

缩略图用于消息流和参考区；原图用于大图预览、下载、置入和 Provider 上传。两者必须有独立状态：

- 缩略图失败时显示明确异常状态，不返回装饰性占位图。
- 原图仍可用时，点击结果继续通过 `asset.readOriginal` 分片加载原图。
- 下载由 Host 的文件保存器完成，WebView 不使用会触发退出的临时 Blob 链接。
- 历史记录只保存资产指针和必要元数据，不把大 data URL 写进对话 JSON。

## 6. Photoshop 原子能力 Cookbook

### 6.1 修改文档

所有文档写操作进入：

```ts
await photoshop.core.executeAsModal(async () => {
  // 最小 Photoshop 写操作
}, { commandName: '用户可理解的动作名' })
```

modal 内避免网络等待、Vue 状态更新和无关计算。读取能否脱离 modal 要以当前 Photoshop API 的官方要求与实测为准；打开、关闭文档和置入等动作统一按 modal 管理。

### 6.2 置入生成结果

1. 从 AssetStore 取原图。
2. 根据“全画布、选区或新文档”等目标计算尺寸与坐标。
3. 创建 pixel layer 或文档。
4. `createImageDataFromBuffer()` 创建 image data。
5. `putPixels()` 写入目标位置。
6. 立即 dispose。

用户点击“置入”就是执行意图，不再弹出重复确认。错误直接返回工作台状态，并记录 command、documentId、目标和耗时。

### 6.3 保存与下载

调用 UXP `getFileForSaving()` 获取目标 File Entry，再写入原图字节。用户取消保存返回 `{ saved: false }`，不显示失败。文件名先清理非法字符，并依据真实 MIME 选择扩展名。

### 6.4 Provider 与凭据

API Key 写入 UXP SecureStorage，`key.env` 只保存部署参数。协议、日志、历史、错误对象和发布产物中不得出现明文 Key。Provider adapter 负责不同模型请求格式，Host command 只接收标准 generation snapshot。

## 7. 状态、历史与诊断 Cookbook

### 7.1 并发任务和正计时

任务以稳定 taskId 存在于独立集合，加载行由任务状态派生，不能用单一 `busy` 替换整个消息流。计时基于 `startedAt` 与当前时间计算，组件重渲染和 CCX WebView 重载后仍能恢复。

任务完成、失败或取消后把最终状态写入历史。UI 删除加载行必须按 taskId 精确处理，避免一个任务完成时误删其他并发任务。

### 7.2 最近 30 条历史

Host 保存最近 30 条生成记录。每条记录持久化 prompt、snapshot、状态、耗时、资产指针和必要日志；资产恢复失败时保留记录并显示原图缺失状态。写入第 31 条时按更新时间淘汰最旧记录，同时释放对应资产所有权。

### 7.3 启动与通信日志

同一启动 trace 至少包含：

- Photoshop/CCX 版本与插件版本。
- Host 壳创建、WebView 地址和加载结果。
- 握手与协议版本。
- WebUI → Host 请求、Host → WebUI 响应和事件。
- command 名、requestId、耗时、成功/失败和清理后的错误。
- Photoshop 原子操作的开始、完成与失败。

日志下载在 CCX UI 启动错误状态中保持可用。敏感头、API Key、完整 Base64 和图片二进制只记录长度、哈希或类型。

## 8. 调试方法

### 8.1 UDT 加载

Vue、TypeScript 或 CSS 改动后构建 CCX 并 Reload。Manifest、entrypoint、icon、权限或 WebView 配置改动后执行 `verify:ccx`，再 Unload/Load `dist/ccx-host/manifest.json`。

Reload 可能保留旧 Manifest 和旧 WebView 状态，遇到入口、权限或版本异常时直接 Unload/Load，并确认实际加载路径位于当前仓库的 `dist/ccx-host/`。

### 8.2 两套 DevTools

Host DevTools 检查 CCX 壳、Photoshop API、command registry 与 bridge；WebView DevTools 检查 Vue、paste/drop、网络和 HostClient。日志里的同一 requestId 用来串起两边事件。

WebView DOM 在 Photoshop 外层辅助功能树中可能不可见。真实验收应在 Photoshop 面板中用用户动作点击、粘贴、拖入和下载，并用界面状态与 Host 日志双重确认。

### 8.3 常见症状定位

| 症状 | 优先检查 |
| --- | --- |
| “宿主无响应”立即出现 | 握手、command 白名单、payload 校验、Host 是否同步抛错 |
| 文件选择长时间卡住 | 是否使用交互超时、选择器是否仍打开、Host trace 是否进入 picker |
| 已上传但“预览不可用” | 缩略图生成链路、bridge 字节上限、AssetStore previewStatus |
| 粘贴无反应 | focus、paste 是否冒泡、clipboardData 是否含 `image/*`、是否误走 Host clipboard |
| 拖入无提示 | dragover 是否调用 preventDefault、是否只在 drop 读取 File |
| 预览只显示小图 | 是否调用 `asset.readOriginal`、资产原图是否仍受历史持有 |
| 下载导致 WebView 退出 | 是否在 WebView 生成大 Blob；CCX 应交给 Host save command |
| 一个任务完成后其他任务消失 | 是否按 taskId 更新、是否覆盖 turns 或共享 loading 状态 |
| 重启后历史为空 | Host 历史文件、schema 迁移、资产 retain/restore |
| Reload 后行为仍旧 | UDT 加载路径、云端 WebUI 缓存、是否需要 Unload/Load |

## 9. 已验证的坑

### 9.1 UXP DOM 与浏览器 DOM 能力不等价

在 Photoshop 27.3 实测中，UXP DOM 用 File Entry URL 或 Blob URL 加载本地图片都可能不触发 load/error。涉及本地图片解码时，Host 侧优先使用 `app.open()` + imaging；WebView 内由真实浏览器引擎处理 paste/drop File。

### 9.2 桥接大小必须显式设计

大 data URL 单消息会触发宿主消息限制、序列化耗时或 WebView 退出。原图分片、缩略图限长、历史只存指针是同一套设计，缺少任何一层都可能在大图上失败。

### 9.3 UXP 不提供全部浏览器编码全局

共享 `mugen-core` 会同时在浏览器和 CCX Host 执行。Photoshop UXP JavaScript 环境不保证提供 `TextEncoder`；直接使用它构造 APIMart multipart header 会在参考图上传时抛出 `TextEncoder is not defined`，错误最终由 Inner WebUI 显示。

共享 Provider 中的 UTF-8 编码应使用不依赖宿主全局的字节实现。回归测试需显式移除 `globalThis.TextEncoder`，再构造完整 multipart 正文；同时运行 Core Provider 测试、CCX Host 集成测试和 `verify:ccx`，确认最终 Host bundle 已使用兼容编码路径。

### 9.3 稀疏数组会跳过空位

分片聚合使用 `new Array(total)` 时，`some()`、`every()` 等方法跳过空槽，不能据此判断是否收齐。使用 `filter((chunk) => typeof chunk === 'string').length === total` 或显式计数。

### 9.4 Host 剪贴板支持随版本变化

UXP Host 剪贴板 API 可能存在但读取立即失败，也可能无法返回图片。面向用户的稳定路径采用 WebView `paste` 事件；Host 剪贴板命令仅保留兼容能力，不作为主要入口。

### 9.5 文档生命周期要区分用户文档和临时文档

用 `app.open()` 生成缩略图前记录已有 documentId，结束时只关闭本次新增文档。按文件名判断会误关同名文档，也不能在失败路径遗漏关闭。

### 9.6 错误要跨层到达用户

组件中的异步预处理、HostClient、协议、Host 服务和 Photoshop 原子操作都可能失败。每层补上下文后继续抛出，最终由 composable/store 转为用户状态；禁止空 catch、只写 console 或用占位图遮盖错误。

## 10. 测试矩阵

| 层级 | 重点 |
| --- | --- |
| inner-protocol | 合法/非法 payload、结果 shape、大小和枚举边界 |
| mugen-core | Provider capability、图片尺寸、请求格式与重试语义 |
| CCX Host 单测 | command、文件/资产/历史/诊断、失败清理、敏感信息 |
| WebUI 单测 | adapter 分片、store 状态、错误和持久化 |
| Playwright E2E | 双视口、上传、paste、drop、并发、计时、预览、下载、置入 |
| verify:ccx | 构建、Manifest、协议、WebUI hash、生产 bundle 纯度 |
| 真实 Photoshop | picker、paste、drop、画布抓取、原图预览、保存、置入、重启恢复 |
| Windows 安装 | CCX 双击安装、Creative Cloud 提示、Photoshop 打开、官网下载安装 |
| 生产回读 | WebUI release、CCX hash、官网最新版链接、关键响应头 |

真实验证要保存界面截图和对应 Host trace。自动化构造 ClipboardEvent 可覆盖代码路径，仍需真实系统剪贴板与键盘粘贴通过后才能宣布用户问题已修复。

## 11. 本轮开发过程 Review

这轮故障表面集中在“宿主无响应”和“预览不可用”，实际跨越了 WebView 事件、Host 文件 API、消息大小、UXP 图片解码和资产生命周期。有效的推进方式是保留每次实验的输入、界面结果和 Host trace，并根据证据缩小边界。

初版缩略图尝试使用 UXP DOM 的 File Entry URL，真实 Photoshop 中没有完成解码；改用 Blob URL 后仍然停住。最终链路改为 Photoshop `app.open()`、`imaging.getPixels()` 和 `encodeImageData()`，10.2 MB PNG 能返回真实 JPEG 缩略图和正确的 2480 × 3312 尺寸。

剪贴板按钮通过 Host API 读取，在目标版本会直接报错，因此交互调整为用户在 WebView 主动粘贴。拖入沿用同一预处理和分片协议，减少了两条数据链的差异。协议增加 MIME、分片数量、单片、缩略图和累计大小校验；Host 聚合完成后立即清理。

审查阶段补上了浏览器侧 128 MB 快速失败、异步预处理错误状态、拖拽悬停的兼容读取和协议 MIME 校验。发布前仍需完成真实 Photoshop 主动粘贴与拖入验收、全量回归、干净提交、CCX 打包和生产回读。

## 12. 发布检查表

- 版本号同时更新 `plug-in/package.json`、`plug-in/manifest.json` 和 lockfile。
- 阅读并执行 `docs/build-todo-list.md` 的活动发布门禁。
- 运行 protocol、core、CCX Host、WebUI 和 E2E 测试。
- 运行 `npm run verify:ccx`，在真实 Photoshop 验证受影响路径。
- 提交源码，确保正式 `package:ccx` 从干净工作树运行。
- 生成 `dist/mugen-<version>.ccx`、SHA-256 和 `dist/ccx-release.json`。
- 构建官网，确认最新版 CCX 已进入 `download/` 且下载链接、大小、哈希一致。
- 部署 Inner WebUI 与官网，回读生产 release、页面链接和 CCX 文件哈希。
- 任何门禁失败都停止发布，修正后重新从对应门禁执行。

## 13. 官方参考

- [UXP Manifest v5](https://developer.adobe.com/photoshop/uxp/2022/guides/uxp-guide/uxp-misc/manifest-v5/)
- [UXP File Entry 与文件系统](https://developer.adobe.com/photoshop/uxp/2022/uxp-api/reference-js/modules/uxp/persistent-file-storage/storage/)
- [Photoshop UXP Changelog](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/changelog/)
- [UXP Clipboard](https://developer.adobe.com/indesign/uxp/uxp/reference-js/Global%20Members/Data%20Transfers/Clipboard/)

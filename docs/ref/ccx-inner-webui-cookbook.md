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

1. CCX panel 创建 WebView，入口固定为 `https://imini-test.catrefuse.com/`。
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

可见画布使用 `imaging.getPixels()`；优先绑定当前活动 `historyStateID`，Camera Raw 等文档状态拒绝该读取时，省略历史状态参数并按当前文档状态重试一次。回退仍读取当前文档合成，不复制或合并文档，避免重新触发临时来源智能对象的更新错误。选区先读 mask、计算有效边界，再与合成像素相乘；图层读取 active layer 并用 `boundsNoEffects` 或 `bounds` 与文档边界求交。返回的 image data 用完立即 `dispose()`。

成功结果进入 AssetStore，桥上只返回资产指针和受控缩略图。Provider 需要参考图时由 Host 从资产读取原图，避免 WebUI 长期持有 RGBA。

### 5.2 上传本地图片

CCX 使用 UXP 文件选择器读取原始字节，交给内部 WebView 的 Canvas 解码、缩放、编码 JPEG，再保存原图与缩略图。不得通过 Photoshop `app.open()` 或 imaging 编码生成预览。大图片通过受信任会话的 `image.process` 事件及分片命令传输，不把原图塞进单条桥消息。旧历史记录没有缩略图时也采用此 JS 链路，新记录保存缩略图供后续恢复。

### 5.3 主动粘贴图片

在 `.composer` 或提示词输入区监听 `paste`，从 `event.clipboardData.items` 读取第一个 `image/*` File，并立即 `preventDefault()`。WebView 生成缩略图后，通过 `reference.importImageChunk` 导入 Host。

主动粘贴要求用户执行粘贴动作，权限模型清楚，也能避开部分 UXP Host 剪贴板 API 的立即失败。非图片剪贴板继续交给文本输入处理。

### 5.4 拖入图片

`dragover` 阶段只检查 DataTransferItem 的 kind 和 MIME，不依赖 `getAsFile()`；文件对象在 `drop` 阶段从 items 或 files 读取。拖入目标显示“松开添加参考图”，离开整个 composer 后清理悬停状态。

拖入和主动粘贴复用同一个 WebView 预处理与分片导入函数，来源字段用于标签和诊断。

### 5.5 缩略图与原图

缩略图用于消息流和参考区；原图用于下载、置入和 Provider 上传。两者必须有独立状态：

- Host 缩略图缺失、标记不可用或在 `<img>` 中加载失败时，WebUI 自动通过 `asset.readOriginal` 分片读取并直接显示原图；原图也不可用或读取失败时才显示明确异常状态。
- 生成结果缩略图不绑定左键预览；横向及方形结果高度最多 160px，竖向结果宽度最多 160px。
- 生成完成摘要不能只复用请求快照的 `summary`，因为 CCX 快照通常只保存 `1K` 等请求档位，实际输出宽高位于 `HostAssetRef.width/height`。消息组件应从生成资产追加 `宽x高`，对已有尺寸做去重，并在拼接前清除空字段留下的末尾分隔符。图片元素的 `naturalWidth/naturalHeight` 只用于缩略图画幅与清晰度判断，不得回写 `GeneratedImage.width/height` 或 `sourceBounds`，否则低清预览会把原图元数据错误改成缩略图尺寸。完成态按 Figma `2077:29040` 在耗时文字前放置 12px `timer-2-line`，图文间距 4px、垂直中心对齐；修改请求与追加继续复用原 turn 事件，但要排在结果图片区之后，不能插入摘要与图片之间。E2E 应生成一张带明确 Host 宽高的图片，断言摘要完整显示请求档位与实际尺寸且不以 `·` 结尾，同时测量耗时图标尺寸、图文间距和结果操作顺序。
- 原图仍可用时，结果菜单下载、置入和 Provider 上传继续使用原始资产。
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

在 Photoshop 27.3 实测中，UXP DOM 用 File Entry URL 或 Blob URL 加载本地图片都可能不触发 load/error。本地图片解码统一交给 WebView 浏览器引擎；Host 读取文件字节后通过分片桥传输，paste/drop File 直接在 WebView 内处理。

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

旧实现用 app.open 生成缩略图时必须区分用户文档和临时文档；当前实现已移除此链路，缩略图全程使用内部 JS，禁止打开或关闭 PS 文档。

### 9.6 错误要跨层到达用户

组件中的异步预处理、HostClient、协议、Host 服务和 Photoshop 原子操作都可能失败。每层补上下文后继续抛出，最终由 composable/store 转为用户状态；禁止空 catch、只写 console 或用占位图遮盖错误。

### 9.10 异步 Provider 不应各自维护轮询节奏

APIMart、iMini、Kling、FLUX 与 ComfyUI 的任务状态和失败结构各不相同，查询时机属于共享运行时能力。各 Provider 在提交后把任务查询与状态解析交给共享轮询器，任务开始后的前 180 秒每 5 秒查询一次，180 秒后每 10 秒查询一次；Provider 仅保留任务超时、终态映射和错误详情。ComfyUI 的旧 `pollIntervalMs` 字段继续用于协议和存储兼容，WebUI 不再展示无效的轮询间隔输入。回归测试需覆盖 180 秒边界、超时末段等待裁剪、Provider 冒烟、双视口 WebUI 和取消路径。

### 9.11 WebView 浮层需要在最窄面板中校验

生成参数等浮层使用视口定位时，宽度必须同时受左右安全间距约束，并在 260 px 面板宽度下检查 `scrollWidth`。固定宽度应用卡片还要在宽视口检查命中区域：浮层即使 DOM 可见，只要定位越出卡片的 `overflow` 裁剪边界，浏览器命中测试仍会落到页面背景，导致菜单项无法点击。靠左工具的菜单应向右展开，靠右工具的菜单应向左展开；靠左菜单使用负 `left` 会扩大水平滚动区域，焦点滚动随后把整个 composer 推出容器，因此还要断言 `.mugen-shell.scrollLeft === 0`。边界验证使用 `elementFromPoint`、真实点击和最终矩形。图标仍会受到壳层视觉主题类控制，换品牌后应同时检查填充和描边两套路径；本轮以独立的滑杆图标区分外观与设置入口，并验证浅色、深色、402 px 和 260 px 视口。

固定宽度主容器中的底栏浮层不要依赖 `position: fixed` 与路由动画的 `transform` 恰好形成定位上下文：宿主缩放、裁剪或动画上下文变化后，面板会重新按页面视口定位并越出应用卡片。生成设置面板也不能相对 32px 工具按钮计算百分比宽度，否则菜单会被压成按钮宽度。面板以参数状态条为绝对定位基准并向右侧内对齐，宽度使用 `min(288px, calc(100% + 1px))`，使完整模型名与内联质量控件有足够空间，同时在窄屏按状态条宽度收缩。Playwright 在 280px 和 960px 视口分别确认面板变宽且四边位于主容器内，宽视口实际宽度为 288px，并在路由动画稳定后保存截图供视觉回查。

生成设置主层的可点击行与次级菜单选项必须共用一个 item 组件，在默认状态就预留 4px 四向内边距，hover 与 `:focus-visible` 只切换底色。不要让两个菜单层级各自维护按钮模板和内边距，也不要只在 hover 时增加内边距，否则图标、文字和值会在指针进入时跳动。两行选项的图标使用 `align-self: start` 与 16px 标题行垂直中心对齐，单行主层图标仍保持整行居中。推荐徽标属于标题行，紧跟选项标题；选中勾选属于尾部状态，保持在最右侧。stepper、分段选择和分辨率行不复用整行按钮组件，避免破坏 Figma `2175:9411` 中这些内联控件的左右对齐。回归测试应分别悬停主层“比例”行和次级比例选项，检查四个方向计算内边距均为 4px、图标与第一行文字中心差不超过 0.5px，确认推荐徽标位于标题容器内，并保存菜单截图。

设置页两行 item 的 16px 图标不能按整个标题加说明内容块垂直居中；它需要和第一行 16px 正文行盒对齐。把标题显式设为 16px 行高，再分别测量图标盒与标题行盒的垂直中心，差值应不超过 0.5px。常用提示词入口可直接从行首对齐；生成记录行同时受 32px stepper 最小高度影响，需要只对该行图标做 2px 纵向校正。E2E 应覆盖两行，避免只修一个入口或回到按 top 差猜测对齐。

设置次级页的进入方向应按页面层级计算：列表深度为 0，预设提示词和自定义 API 深度为 1，配置详情深度为 2；目标深度增加时使用前进动画，减少时使用返回动画。仅用“是否配置详情”判断会让列表进入预设页时误用返回方向。预设提示词页还要复用设置体系的 16px 卡片、8px 控件和主题 token，并给自身空状态使用专属类名；全局 `.empty-state` 属于消息区，会以更高选择器权重移除卡片背景、描边和圆角。定向 E2E 在 280px 与宽视口同时观察进入/返回 transition class，创建一条预设后检查列表卡片并保存截图。

iMini API 快捷入口删除 Key 获取位置说明时，应同时删除模板节点和只服务于该节点的 `.imini-quick-card p` 样式，让 `.imini-quick-body` 的 grid 自动把标题、输入框和订阅入口按既有 4px gap 收拢。不要保留空节点、隐藏元素或额外 margin 填补旧位置。内容列不得继续使用旧版 `304px` 上限，应在 `16px + 12px + minmax(0, 1fr)` 网格中填满图标右侧的剩余宽度，使密码输入框随设置容器同步伸缩。E2E 应在 280px 与宽视口确认说明文本不存在、标题到表单间距为 4px、内容列右边缘与快捷卡片右边缘重合，且表单与输入框等于内容列宽度，再保存浅色截图排查空行或右侧残留空白。

同一生成设置弹窗内切换主层和次级路由时，横向位移与外框高度必须同步变化。Vue `<Transition mode="out-in">` 会等旧路由完整离场后才挂载新路由，使高度补间天然延迟一个 180ms 周期；移除串行 mode，并让进入、离场路由使用相同 `grid-area: 1 / 1` 叠放，才能让两张视图和高度在同一周期内过渡。离场前读取并锁定面板当前外框高度，新路由进入布局时用其内容高度加面板 padding、边框得到目标外框高度，再由 Web Animations API 用相同的 180ms 缓动直接补间。高度动画结束时不能立即清除锁定值，因为旧路由可能尚未触发 `after-leave`，共享 Grid 会短暂按旧路由高度重排并在下一帧回到目标值；应先把目标高度固化，等高度动画与旧路由离场都完成后再恢复内容自适应。路由作为 Grid 直接子项还必须使用 `align-self: start` 保持自身内容高度；默认 stretch 会在目标较矮时把它拉到锁定外框高度，导致清除锁定值时瞬间缩短。这样不会写死选项数量，也不会改变 controller 数据流。`prefers-reduced-motion: reduce` 下等待离场完成后直接释放。E2E 应逐帧采样进入、返回过程，确认轨迹位于各自起点与终点之间、包含中间值、在路由变化后的 80ms 内开始，且全程保持单调变化以拦截结束帧反弹。

### 9.12 UI 快捷入口不得复制配置业务

设置页可以为既有配置流程增加更短的视觉入口，但不应另写一套保存逻辑。直接从快捷入口创建并启用 Provider 配置，会绕过原有的新建、编辑、测试、保存与选中语义，还可能重写用户已有的模型和 Base URL。正确做法是让设置组件只提交输入，由组合层打开既有配置详情并更新草稿，最终继续调用原 controller 的保存方法。验证时同时检查浏览器和 CCX 两个运行时：进入详情前配置列表与当前选中项不得变化，iMini 草稿使用官方 `https://openapi.imini.ai/imini/router`，浏览器发请求时仍通过既有 `/webui-api/imini/` 同源转发。

### 9.13 生成状态应由任务快照驱动并避免重复反馈

Figma 的生成中状态同时需要模型、Provider、尺寸、质量、比例和结果数量，仅从全局当前配置读取会在并发、追加或重试时显示错误信息。`GenerationLoadingState` 应保存请求发起时已有的展示字段，Browser 与 CCX 分别从同一轮请求快照派生；这只扩充视图状态，不改变 Provider 请求与轮询语义。

加载占位图使用 Figma 导出的原始点阵纹理，固定单项 160 × 209 px、8 px 圆角，并按请求数量渲染。主题层的通用 `.assistant-message` 规则可能覆盖组件内状态间距，Playwright 需要读取最终计算样式而不只检查源码。失败信息已在消息流展示时，不再保留工作区全局状态条，避免同一错误在消息流和输入框上方重复出现。验证同时覆盖 280 px 与宽视口、加载尺寸、透明背景、零描边、日志展开、取消和重试入口。

### 9.14 历史条数必须由 Host 设置驱动完整生命周期

生成记录上限同时影响 WebUI 当前消息、Host 历史索引和持久化生成资产，不能只在设置页保存一个数字。`SettingsSnapshot.historyLimit` 使用 1–50 的协议边界并保持旧配置默认 30；WebUI 初始化时按该值请求和裁剪历史，CCX `HistoryStore` 在设置降低后立即写回裁剪后的索引、释放被淘汰记录的 owner，并删除没有其他记录引用的持久资产。设置读取和保存命令都要把当前上限同步给 HistoryStore，避免插件重启后短暂恢复固定 30 条行为。

Figma stepper 的外框为 72 × 32 px，两个箭头按钮各 24 × 24 px，中间数值为 18 × 24 px，控件间距 3 px。组件只通过 typed emit 提交新值，Browser composable 与 CCX store 分别负责各自的持久化和裁剪；验证需覆盖协议非法边界、旧设置迁移、Host 实际淘汰资产，以及 WebUI 计算尺寸和 `settings.save` 的最终 payload。

### 9.15 完成图片的内容宽度不能由消息列宽反向撑开

完成结果只限制图片的最大边时，如果结果列表仍使用 `minmax(0, 1fr)` 单列、结果项按网格轨道拉伸，或缩略图外层设置 `width: 100%`，小图仍会出现占满消息列的底色容器。结果列表应使用可换行的 `inline-flex` 内容宽度布局，并在消息网格内设置 `justify-self: start` 阻止默认拉伸；结果项和缩略图外层使用 `width: fit-content` 与 `max-width: 100%`，并保持透明背景。操作区只在该结果项内部使用 `width: 100%`，使操作区跟随图片宽度而不撑开消息列。

回归测试除横图高度和竖图宽度上限外，还要读取最终计算样式和布局矩形，确认结果项与缩略图背景透明、结果项宽度和图片一致、单张结果列表紧贴结果项且明显小于消息列宽，并在窄面板截图中检查多余底色已经消失。

### 9.16 窄面板的次级选择应在同一弹窗内切换

生成设置的供应商、模型、比例和分辨率如果各自打开绝对定位下拉框，会形成弹窗叠弹窗，窄面板中容易越出固定容器，视觉层级、返回路径和键盘焦点也与 Figma 不一致。Figma `2175:9411` 已明确标注插件宽度有限时在弹窗内部通过路由动画进入次级菜单，因此生成设置应由一个组件持有当前菜单层级：主层显示 32px 参数行，次级层显示返回按钮、标题和单选行，选中后回到主层并把焦点恢复到原入口；按 Escape 时先从次级层返回主层，再关闭外层弹窗。次级层应让返回栏位于滚动容器之外，只把小标题和选项列表放进同一个纵向滚动区；滚动轨道保持透明，4px thumb 不加 border，避免系统原生槽轨侵入菜单。菜单路由容器、页面 `.route-shell` 和固定宽度 `.mugen-shell` 使用 `overflow: clip` 裁切横向过渡；`overflow: hidden` 会形成可由焦点自动滚动的隐藏滚动容器，页面路由的 `translateX(22px)` 可能变成 `route-shell.scrollLeft = 22`，把整个工作区连带推离原位。

底栏参数摘要不能使用“配置”“模型”这类展示兜底拼出看似完整的状态。展示条件必须复用组件已经解析出的当前配置：activeConfigId 命中时使用对应配置，浏览器模式保存首个配置但 activeConfigId 仍为空时沿用首个启用配置；只有解析不到配置或模型值为空时才显示“待配置”。满足条件后按模型图标、去掉命名空间前缀的模型名、Provider、分辨率、质量、比例、数量和展开图标排列，模型名与 Provider 之间使用斜杠。摘要使用 12px 字号；固定宽度不足时让模型名优先省略，保留后续参数，400px 及以下隐藏摘要，402px 设计容器继续显示。生成设置入口的层叠图标使用 16px，按钮命中区域仍保持 32px，不缩小可点击范围。E2E 需分别覆盖空配置、activeConfigId 为空但已有首个启用配置，以及 iMini GPT Image 配置的字段顺序、最终计算尺寸、400/402px 断点，并保存固定宽度截图。

参数值仍通过 typed emit 交给既有 controller，内部路由只管理呈现状态。数量直接使用能力列表驱动的 stepper，质量使用能力列表驱动的分段选择，不能复制 Provider 或生成状态。回归应在 280px 与宽视口同时验证进入、选中、返回、外部关闭、选中勾选、无 `.select-menu`/`.ratio-menu` 叠层，并读取 `.parameter-panel` 四边确认未越出 `.mugen-shell`。

### 9.17 图片预览必须以工作区尺寸为边界

宽屏页面中的 iMini PS 主容器固定为 402px，但 `100vw` 和 `100vh` 仍指向整个浏览器。预览弹层若按 viewport 与图片比例计算宽度，横图会生成最高 900px 的弹层并越出固定容器；超高图还会生成超过工作区高度的媒体区域，居中后把标题栏和关闭按钮一起裁出可见范围。图片元数据与缩略图实际比例不一致时，这种计算会进一步放大偏差。

预览层应继续绝对定位在 `.workspace-route` 内，弹层宽高使用父工作区的 `100%`，扣除安全间距后以 `grid-template-rows: auto minmax(0, 1fr)` 给媒体区分配剩余空间；媒体区设置 `min-width: 0`、`min-height: 0`，图片使用 `object-fit: contain` 填满可用区域。不要再用图片元数据、`100vw` 或 `100vh` 推导弹层尺寸。Playwright 需要在 280px 面板和 960px 页面中的 402px 固定容器分别打开真实参考图预览，断言弹层四边位于主容器内、图片与标题栏可见，并在过渡结束后保存截图。

### 9.18 分辨率 slider 必须由模型能力列表驱动

生成分辨率的可选档位随 Provider 与模型变化，把 0.5K、1K、2K、4K 直接写进组件会复制能力判断，并在模型缺少某一档或增加新档时让显示值、请求值和可操作刻度失去一致性。`ComposerDock` 只把模型能力中的预设尺寸传给 `GenerationSettingsMenu`，不追加宽高输入项；泛化的 `DiscreteSlider` 使用原生 `input[type="range"]` 的索引作为离散位置，通过 `v-model` 返回真实 option value，继续沿用原 controller 的 `updateSize` 数据流。

Figma `2077:29247` 的轨道以 221 × 26 px、8px 圆角为设计基准；组件高度固定 26px，宽度使用父级可用内容区的 `100%`，不得用固定宽度让轨道在 288px 面板中留下空白。首档填充保留 16px 可见起点，每个能力项按轨道百分比渲染刻度，因此面板伸缩后填充、刻度和 handler 必须一起重排。handler 所在刻度保持隐藏，索引小于当前值的已通过刻度使用 90% 白点，索引大于当前值的未通过刻度使用灰点，handler 使用纯白。填充宽度、颜色和 handler 使用短促缓动；最大档填满轨道并切换为紫色，通过填充内部的低透明度移动渐变形成轻微充电流光。透明的原生 range 覆盖整个控件，确保方向键、Home、End、点击和真实拖动都使用浏览器既有可访问交互；聚焦只强化 handler，不给 slider 增加外框描边。旧版保存的自定义尺寸仍可由 controller 读取历史快照，但生成设置菜单不再展示宽高输入按钮或数字输入框；用户操作 slider 后回到预设模式。`prefers-reduced-motion` 下停止充电动画和切档过渡。回归需要在 280px 与宽视口分别断言轨道等于分辨率内容块宽度、宽面板轨道大于 221px、窄面板轨道小于 221px，并继续验证档位数量、`aria-valuetext`、当前刻度隐藏、白灰刻度分层、键盘两端、真实拖动、过渡属性、最大档颜色与动画，确认宽高输入控件不存在后再保存截图。

### 9.19 输入表面与参数状态条必须分层实现

Figma `2218:3179` 把参数状态条放在输入表面之后，并让 47px 状态条与 138px 输入表面重叠 17px。如果继续把参数摘要作为底栏中间列，输入区会保留旧版卡片高度、32px 命中区和悬浮阴影，无法还原 24px 圆形操作按钮。`ComposerDock` 应保持既有 props、typed emits、参考图、生成菜单和发送逻辑，只在模板中分成 `.composer-status` 与 `.composer-surface`；状态条使用 `bg/base`，输入表面保留组件自身 surface，按钮使用 `bg/filter`。`bg/body` 映射到主页面、工作区顶栏、消息区和固定应用容器；设置页整体改用 `bg/base`，只修改 `.composer-surface` 会让主体背景完全不变。

完成配置后的 Provider 放在状态条左侧并配 7px 状态点，模型图标、模型名、斜杠、分辨率、质量、比例、数量和展开图标放在右侧；无配置时仍只显示“待配置”。窄面板不能再直接隐藏整个摘要，应让模型名缩略并保留状态条结构。E2E 需要在 280px 与 402px 固定容器分别读取 47px 状态条、138px 输入表面、16px 圆角、0.5px divider 声明、12px/16px 提示词和 24px 操作按钮；Chromium 在 DPR=1 时会把 0.5px 边框量化为 1 个设备像素，因此最终计算值应按不超过 1px 校验。hairline 会占用窄屏底栏两侧各 1 个设备像素，参数弹窗的 `100%` 限制需补偿 1px，同时仍要逐边确认弹窗位于固定容器内。浅色与深色模式要分别检查主页面、工作区顶栏、消息区和固定容器命中 `bg/body`，设置页顶栏、活动路由、面板和各级设置页命中 `bg/base`，并确认输入表面没有新增阴影，再保存双主题截图。

### 9.20 WebUI 生图偏好与 Host 配置分层持久化

Provider、模型、凭据和配置启用状态属于配置数据，浏览器模式继续写入 `mugen.settings.v1`，CCX 模式继续通过 `settings.get/settings.save` 交给 Host；尺寸、质量、比例和数量属于界面生图偏好，由两个 controller 共用 `mugen.generation-preferences.v1`，按配置 ID 保存。这样不需要扩大 Host 协议，也不会把凭据复制进 WebUI 偏好。初始化和切换配置时必须用当前模型能力列表校正存量值，已移除的尺寸、质量、比例或数量回到能力默认值。存储 shape 暂时保留旧版分辨率模式与自定义宽高字段以兼容历史数据，但菜单不再提供编辑入口。E2E 应从真实菜单修改可见参数、读取本地偏好、刷新页面，再确认显示值和控件状态全部恢复。

状态条使用固定宽度时不能用不相等的左右 margin 模拟 Figma 坐标，否则 351px 状态条在 380px 输入面上会产生 1.5px 中心线偏移。状态条应由 grid 自身居中，宽屏显式使用 `calc(100% - 29px)`，窄屏使用 `calc(100% - 24px)`；E2E 直接比较两层 `getBoundingClientRect()` 的水平中心线，允许的像素误差不超过 0.5px。

Figma `2075:28404` 已绑定完整的 Light/Dark Semantic Colors，不能只根据浅色截图挑一组近似 Zinc 色。实现时应解析变量别名的最终模式值，并集中映射主题 token：Light 使用 `bg/body #ffffff`、`bg/base/bg/filter #f4f4f5`、`text/main #18181b`、`text/tertiary #a1a1aa`、`line/divider #0000001a`；Dark 使用 `bg/body #3f3f46`、`bg/base #27272a`、`bg/filter #52525b`、`text/main #ffffff`、`text/tertiary #ffffff80`、`line/divider #ffffff33`；accent、success 和 on-accent 两种模式分别固定为 `#0ea5e9`、`#22c55e`、`#ffffff`。组件已有的 main、secondary/muted、surface、field、hover、divider 和 success 引用应统一落到这些 token，用户提示气泡同时使用 filter 背景与 divider hairline。Playwright 需要切换两种主题读取工作区、输入面、状态条、按钮、主文字、三级文字、成功点与边线的最终计算色，并保存双主题截图。

生成设置的真实触发控件是参数状态条，因此弹窗必须成为状态条定位包装层的子元素，按状态条右边缘向上展开并保留 8px 纵向间距。把弹窗留在 footer 或层叠图标包装层中，即使通过固定偏移看起来接近触发控件，状态条随断点改变宽度后仍会产生明显错位。定位包装层只能提供 `position: relative`，不能设置高于输入表面的 `z-index`；否则整个状态条会盖住 Figma 规定由输入表面遮挡的 17px 重叠区。弹窗自身保留高层级，因此不会被输入表面裁住。左下角层叠图标只负责预设提示词，并把预设菜单放进自身的相对定位根节点，确保菜单跟随按钮移动。双视口 E2E 需分别点击参数状态条和层叠图标，验证两个弹窗的水平锚点、8px 纵向间距、互斥状态和工作区边界，并用重叠区命中测试确认顶层元素属于输入表面。

设置页返回按钮的 `AppIcon size="18"` 会生成 18px SVG，但主题层若再用 `.header-back svg` 强制 24px，会让图标撑满 24px hover 背景。返回按钮保留 24×24px 命中与 hover 盒，SVG 沿用组件声明的 18px；E2E 在 hover 状态分别读取按钮与 SVG 的计算尺寸，避免只校验图标键名。

### 9.20 完成消息应直接由请求快照驱动

Figma `2077:29040` 把“复制提示词”和“重新填入请求”放在用户消息下方，把完成态拆成计时行、模型参数行、结果图片和图片操作栏。继续解析 `responseText` 会把生成数量、实际像素和英文质量混入模型参数行，也会让 Browser 与 CCX 的显示顺序随 Provider 文案变化。`MessageThread` 应直接读取 `repeatRequest` 中的模型、Provider、请求分辨率、质量和比例，模型名只移除命名空间前缀，质量与原图比例只做显示层中文映射；请求、轮询、历史和置入数据保持原值。

用户消息操作通过 typed emit 交给 controller：复制只写入本轮提示词，重新填入继续调用已有的请求快照恢复逻辑。浏览器历史可选保存 `createdAt`，CCX 使用 Host turn 的 `startedAt`；旧记录没有时间字段时只隐藏时间文字，复制和回填仍可用。复制与回填按钮必须共用同一套 20×20px、4px 圆角和非透明 hover / focus 背景；不要用 `:last-child` 把回填按钮缩回 12px 图标尺寸，否则两个相邻操作的命中区会分叉。图片与操作栏的 4px 间距、12px 图片圆角和透明操作栏必须同时写入高优先级主题规则，因为全局 `.mugen-shell.mugen-shell` 选择器会覆盖 scoped component CSS。双运行时 E2E 应读取最终计算样式，确认时间/复制/回填图标、12px 元信息图标、图片圆角、透明操作栏、4px 间距，以及回填后提示词和参数仍来自原请求快照。

### 9.21 自定义 API 管理使用独立设置路由

自定义 API 配置列表直接在生图 API 卡片内展开，会让设置首页同时承担快捷 Key、配置列表和新增入口，配置较多时还会把首页长度与卡片尺寸一起撑开。设置首页只保留带数量摘要的入口，点击后把 `settingsView` 切换到 `apis`，由独立 `CustomApiSettings` 负责列表与添加操作；单个配置仍交给既有 `ConfigEditorForm`，Provider 校验、测试、保存和凭据通道不变。

配置详情需要记住进入来源：从自定义 API 页新建或编辑时，返回、保存和删除都回到 `apis`；从设置首页的 iMini 快捷入口或工作区管理入口进入时仍回到 `list`。顶部返回按钮根据 `list → apis → detail` 的层级逐级返回，页面横向过渡根据前后层级决定方向。E2E 应确认设置首页不存在配置行、进入次级页后配置可见、返回首页后再次隐藏，并覆盖浏览器与 CCX 两种 controller 的保存回路。

### 9.22 官网发行校验必须复用 CCX 实际品牌文件名

CCX 打包器把正式文件命名为 `imini-ps-<version>-<build>.ccx` 后，官网构建校验和部署快照过滤也必须使用同一规则。若官网仍硬编码旧 `mugen-` 前缀，本地 CCX 的版本、build、SHA256 和来源提交即使全部有效，`build:site` 仍会在复制产物前失败。正确做法是让打包元数据、官网入口、LLM 文本、发行校验器和 `download/` 唯一文件规则全部对齐 `dist/ccx-release.json` 的 iMini PS 文件名，并用站点构建测试覆盖品牌前缀、语义版本和十位 build 号。验证时从干净提交重新执行 `build:site`、dry-run、正式部署和公网完整字节回读，不能沿用旧品牌文件名规避门禁。

dev CCX 的 `webviewOrigin` 可以指向 `imini-test.catrefuse.com`，但官网及 CCX 下载固定由 `mugen.catrefuse.com` 提供；这两个 origin 属于不同职责，官网构建不能再从 CCX WebView origin 推导下载地址。生产 WebUI 入口是官网的 `/webui/`，测试入口是 `imini-test` 根路径，两者部署到同一份 WebUI 不可变资源后需要分别做公网回读。

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

初版缩略图尝试使用 UXP DOM 的 File Entry URL，真实 Photoshop 中没有完成解码；改用 Blob URL 后仍然停住。当时改用 Photoshop app.open、getPixels 和 encodeImageData 后，10.2 MB PNG 能返回预览；该历史方案会干扰文档 tab，现已由 WebView Canvas 替代。

剪贴板按钮通过 Host API 读取，在目标版本会直接报错，因此交互调整为用户在 WebView 主动粘贴。拖入沿用同一预处理和分片协议，减少了两条数据链的差异。协议增加 MIME、分片数量、单片、缩略图和累计大小校验；Host 聚合完成后立即清理。

审查阶段补上了浏览器侧 128 MB 快速失败、异步预处理错误状态、拖拽悬停的兼容读取和协议 MIME 校验。发布前仍需完成真实 Photoshop 主动粘贴与拖入验收、全量回归、干净提交、CCX 打包和生产回读。

## 12. 发布检查表

- 版本号同时更新 `plug-in/package.json`、`plug-in/manifest.json` 和 lockfile。
- 阅读并执行 `docs/build-todo-list.md` 的活动发布门禁。
- 运行 protocol、core、CCX Host、WebUI 和 E2E 测试。
- 运行 `npm run verify:ccx`，在真实 Photoshop 验证受影响路径。
- 提交源码，确保正式 `package:ccx` 从干净工作树运行。
- 生成 `dist/imini-ps-<version>-<build>.ccx`、SHA-256 和 `dist/ccx-release.json`。
- 构建官网，确认最新版 CCX 已进入 `download/` 且下载链接、大小、哈希一致。
- 部署 Inner WebUI 与官网，回读生产 release、页面链接和 CCX 文件哈希。
- 任何门禁失败都停止发布，修正后重新从对应门禁执行。

## 13. 官方参考

- [UXP Manifest v5](https://developer.adobe.com/photoshop/uxp/2022/guides/uxp-guide/uxp-misc/manifest-v5/)
- [UXP File Entry 与文件系统](https://developer.adobe.com/photoshop/uxp/2022/uxp-api/reference-js/modules/uxp/persistent-file-storage/storage/)
- [Photoshop UXP Changelog](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/changelog/)
- [UXP Clipboard](https://developer.adobe.com/indesign/uxp/uxp/reference-js/Global%20Members/Data%20Transfers/Clipboard/)

### 9.12 缩略图处理与 Photoshop 文档隔离

已复现的代码链路为缩略图创建时临时 `app.open()`，完成后关闭文档；选区读取则复制并关闭文档副本。这两条链路均已移除。PS 读取端只取得原文档 sRGB 像素、选区 mask 与坐标，后续蒙版计算和图片编码使用 JS；输出端保留置入、目标校验、图层缩放与定位。

新增 Host 测试使源图读取中的文档复制、PS 编码与编辑调用立即失败，并校验选区 alpha；浏览器 E2E 使用实际 Canvas 编解码，通过真实 WebViewHostClient 与 Host 图片处理服务分片往返，覆盖 RGBA、文件图片、损坏图片、双视口与输出尺寸。会话重连拒绝旧图片任务，历史保存缩略图避免重复生成。正式构建检查已从要求独立创建图层命令改为禁止独立 PS 编辑命令。

本次真实 PS UI 验证因电脑控制截图失败尚未完成，不能把浏览器与模拟宿主测试当作实机 tab 不闪动的证明。


### 9.23 Photoshop Imaging 读取仍要求 modal scope

2026-09-09 在 Photoshop 27.3.0 / UXP 9.0.2 上用线上 1.2.1 包复现：普通 RGB/8 JPG 的文档属性与图层 ID 读取成功，`imaging.getPixels()` 在 modal 外抛出 `code=1000`，原始错误为 `The requested functionality is only allowed from inside a modal scope`。9 月 8 日图片交互边界改动将读取端的 `executeAsModal` 一并移除，造成所有格式的图像读取回归，与 Sony RAW 解码无关。

读取可见图像、选中图层、选区像素和选区位置时，短时进入 `executeAsModal`，完成 Imaging 读取、取得字节并释放 PhotoshopImageData 后退出。JS 蒙版计算、WebView 编码和桥接传输留在 modal 外；不恢复临时文档、PS 编码、后台事件监听或生成阶段的 PS 调用。诊断必须保留脱敏后的原始错误信息和 number，不能只记录通用错误码。

真实 Photoshop 测试使用实际修复后的读取模块，分别在 32×24 的 RGB/8 与 RGB/16 文档验证：画布和图层均返回 3072 字节 RGBA，白色像素一致；选区返回 16×12、768 字节，边界为 (8,4)-(24,16)，选区位置相同。此项实机像素测试替换了 WebView 编码回调，仅证明 PS 读取与坐标；实际 WebView 编码由完整浏览器 E2E 另行验证。测试自建文档关闭后原文档 ID 不变。单测同时检查 modal 内读取、modal 外编码、历史状态回退以及错误原样向上传递。


## 9.24 恢复并冻结 1.2.0 读写方案（2026-09-10）

用户再次报告读取失败，诊断中 `canvas.captureVisible` 两次返回 `RangeError: Invalid array length`。用户明确要求恢复两次更新前的方案，本次不继续修补新编码链路，原样恢复提交 `7294ba2` 的 `canvasPrimitives.ts`。此决定覆盖 9.23 的后续实现建议以及此前禁用 Imaging 编码、临时文档的改造要求。

复核核心文件与基线零差异；宿主 105 项测试和 regression smoke 通过。Photoshop 27.3.0 实机使用实际恢复模块，未替换编码回调：RGB/8 64×48 与 RGB/16 6000×4000 均完成画布、选中图层读取及 JPEG 编码、缩略图；16 位文档每次读取返回 96000000 字节 RGBA，预览 533039 字符、缩略图 10679 字符。两种文档均完成 (8,4)-(24,16) 选区读取并通过 `insertPreviewImage` 增加一个图层。仅自建测试文档被关闭，原文档 ID 保持一致。用户原始 RAW 与 Windows 双击安装未实测。

未经用户明确要求，不再改造这套读写代码；后续模型或 WebUI 功能更新不得顺带修改它。


### 9.24 补充：中间图片处理不得触碰 Photoshop

用户确认恢复后读取成功，但报告缩略图压缩导致画布闪动。旧版 `createBridgeThumbnailFromFile` 调用 `app.open`，并在 finally 关闭文档，确实会切换画布；此路径已移除。缩略图与参考图压缩统一将已读取的 `previewUrl` 交给内部图片处理服务，本地附件只读取文件字节。无需再次访问源图层，也不序列化完整高分辨率 RGBA。读取端的 Imaging 内存编码与置入端保持稳定。

测试对 Photoshop 模块访问和 RGBA getter 均设为抛错，验证三种压缩入口仍然成功；附件入口只允许 UXP 文件读取。此补充取代上一段对缩略图和参考图压缩使用旧方案的决定。

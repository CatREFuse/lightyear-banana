# Electron Web App + UXP Bridge 开发手册

## 目标

Lightyear Banana 后续采用桌面应用主导的架构：

```text
Electron App
  Renderer: 生图工作台、消息流、模型设置、结果管理
  Main: 本地 Bridge、模型 API、文件缓存、应用配置
  Preload: 安全暴露少量 IPC 方法
  UXP Plugin: Photoshop 画板交互中转
```

Photoshop 相关能力仍由 UXP 插件执行。Electron 负责完整 Web App 体验、模型请求、本地服务和状态调度。

## 架构图

```text
┌──────────────────────────────────────────────┐
│ Electron Renderer                             │
│ - 聊天式生图界面                              │
│ - 参考图、结果、历史、模型配置                 │
│ - 只访问 window.lightyearBridge               │
└──────────────────────┬───────────────────────┘
                       │ IPC
┌──────────────────────▼───────────────────────┐
│ Electron Main                                 │
│ - HTTP Bridge + 本地 Web App 静态服务          │
│ - 生图 API Adapter                            │
│ - API Key 与本地配置                           │
│ - 图片缓存、任务队列、日志                     │
└───────────────┬──────────────────────┬───────┘
                │ HTTP long-poll         │ HTTP
┌───────────────▼──────────────────────┐ │
│ Photoshop UXP Plugin                  │ │
│ - 主动连接 Electron Bridge            │ │
│ - capture visible / selection / layer │ │
│ - place image / write pixels          │ │
│ - executeAsModal 包裹文档修改          │ │
└───────────────┬──────────────────────┘ │
                │ Photoshop API           │
┌───────────────▼────────────────────────▼──────┐
│ Photoshop Canvas / Layers / Selection          │
└────────────────────────────────────────────────┘
```

## 组件职责

### Electron Renderer

负责用户交互：

- 消息流和输入区
- 参考图列表
- 生图结果网格
- 模型和 API 配置界面
- Photoshop 连接状态展示
- 结果置入、选区抓取、图层抓取等按钮入口

Renderer 不直接访问：

- `fs`
- `net`
- `child_process`
- API Key 明文持久化
- Photoshop UXP API
- 任意 Node 全局对象

Renderer 只通过 `window.lightyearBridge` 调用 Main 暴露的安全 API。

### Electron Preload

负责安全 IPC 包装：

```ts
window.lightyearBridge = {
  invoke(command, payload),
  onEvent(callback),
  getBridgeStatus()
}
```

Preload 必须使用 `contextBridge.exposeInMainWorld()`，不要把完整 `ipcRenderer` 暴露给页面。

### Electron Main

负责本地系统能力：

- 启动本地 Bridge
- 管理 UXP long-poll 连接
- 管理 UXP 插件在线状态
- 转发 Renderer 命令到 UXP
- 接收 UXP 返回结果并推送给 Renderer
- 调用模型 API
- 管理 API Key、Base URL、模型配置
- 管理本地图片缓存和临时文件
- 记录日志和错误

Main 是 Renderer 和 UXP 的唯一消息枢纽。

### UXP Plugin

负责 Photoshop 交互：

- 插件加载后主动连接 Electron Bridge
- 上报 Photoshop 文档状态
- 抓取可见画布
- 抓取选区
- 抓取选中图层
- 读取当前选区位置
- 创建图层
- 写入像素
- 置入图片

UXP 插件不负责：

- 大型 UI
- 模型 API Key 管理
- 云端模型请求
- 长历史记录
- 复杂结果管理

## Bridge 形态

当前已验证实现使用 Electron Main 内置 HTTP server：

```text
HTTP long-poll: UXP 命令投递和响应
HTTP: Web App 静态资源、健康检查、调试接口
```

### HTTP long-poll

用途：

- UXP 注册连接
- Renderer 发起 Photoshop 操作
- UXP 返回进度和结果
- 连接状态广播
- 错误事件

实机验证记录：

- Photoshop UXP 运行时对 `ws://127.0.0.1:38321` 报过 manifest permission denied。
- 在 `plugin/manifest.json` 使用 `"requiredPermissions": { "network": { "domains": "all" } }` 后，本地 HTTP long-poll 可以连接。
- 改 manifest 后只 `Reload` 不够，需要在 UXP Developer Tools 中执行 `Unload` / `Load`。

### HTTP

用途：

- `/app/`
- `/health`
- `/debug/state`
- `/uxp/hello`
- `/uxp/poll`
- `/uxp/respond`
- 后续大图数据临时下载

如果图片很大，Bridge 消息里只传 `assetId`、`width`、`height`、`sourceBounds`，实际图像通过 HTTP 或本地缓存读取。

## 协议草案

### 通用消息结构

```ts
type BridgeMessage<T = unknown> = {
  id: string
  type: string
  role: 'renderer' | 'uxp' | 'main'
  payload: T
  createdAt: number
}
```

### 成功响应

```ts
type BridgeOk<T = unknown> = {
  id: string
  ok: true
  payload: T
}
```

### 错误响应

```ts
type BridgeError = {
  id: string
  ok: false
  error: {
    code: string
    message: string
    recoverable: boolean
  }
}
```

错误文案进入 UI 前必须转换成普通用户能理解的状态，不暴露 descriptor、manifest、bundle 等工程细节。

## Photoshop 命令

### 获取状态

```ts
type PhotoshopStatusRequest = {
  type: 'photoshop.status'
}

type PhotoshopStatusResult = {
  connected: boolean
  document?: {
    id: number
    title: string
    width: number
    height: number
  }
}
```

### 抓取可见画布

```ts
type CaptureVisibleRequest = {
  type: 'canvas.captureVisible'
}

type CapturedImageResult = {
  imageId: string
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
}
```

### 抓取选区

```ts
type CaptureSelectionRequest = {
  type: 'canvas.captureSelection'
}
```

无有效选区时返回：

```ts
{
  "code": "NO_SELECTION",
  "message": "当前没有可读取的选区",
  "recoverable": true
}
```

### 抓取选中图层

```ts
type CaptureLayerRequest = {
  type: 'canvas.captureLayer'
}
```

无选中图层时返回：

```ts
{
  "code": "NO_ACTIVE_LAYER",
  "message": "当前没有选中图层",
  "recoverable": true
}
```

### 写入结果

```ts
type PlaceImageRequest = {
  type: 'canvas.placeImage'
  imageId: string
  target:
    | { type: 'fullCanvas' }
    | { type: 'currentSelection' }
    | {
        type: 'bounds'
        bounds: {
          left: number
          top: number
          width: number
          height: number
        }
      }
}
```

UXP 执行写入时必须：

- 读取目标文档
- resize RGBA
- 创建目标 pixel layer
- `core.executeAsModal()`
- `imaging.putPixels()`
- dispose image data

## 连接流程

### Electron 启动

1. Main 读取配置。
2. Main 启动本地 Bridge。
3. Main 创建 BrowserWindow。
4. Renderer 通过 Preload 获取 bridge 状态。
5. Renderer 显示 Photoshop 未连接状态。

### UXP 启动

1. UXP 插件面板加载。
2. UXP 主动向 `http://127.0.0.1:38321/uxp/hello?token=...` 注册。
3. UXP 发送 `uxp.hello`，包含文档状态。
4. Main 标记 UXP 在线。
5. Main 推送 `photoshop.connected` 给 Renderer。
6. UXP 进入 `/uxp/poll` 长轮询循环，等待 Main 下发命令。

### 命令执行

1. Renderer 调用 `window.lightyearBridge.invoke('canvas.captureVisible')`。
2. Main 生成 request id。
3. Main 把命令放入 UXP 队列。
4. UXP 执行 Photoshop API。
5. UXP 通过 `/uxp/respond` 返回 result 或 error。
6. Main 写入缓存并返回 Renderer。
7. Renderer 更新消息流或参考图列表。

## 端口策略

开发期默认端口：

```text
Electron Bridge / Web App: 38321
Mock Image API: 38322
```

生产期推荐：

- 启动时优先尝试固定端口。
- 端口占用时选择可用端口。
- 把当前端口写入 Electron app config。
- UXP 插件先读固定端口。
- 连接失败时显示面板状态，提示打开 Electron App。

后续可以增加端口发现文件：

```text
~/Library/Application Support/Lightyear Banana/bridge.json
```

示例：

```json
{
  "port": 38321,
  "token": "random-session-token",
  "startedAt": 1777350000000
}
```

## 安全规则

### Electron

- Renderer 禁用 Node integration。
- 开启 context isolation。
- 通过 preload 暴露最小 API。
- 不把完整 `ipcRenderer` 暴露给 Renderer。
- Main 校验所有 IPC channel 和 payload。
- BrowserWindow 不加载不可信远程页面。
- 不关闭 `webSecurity`。
- 生产环境启用 CSP。
- API Key 存在 Main 控制的安全存储或本地加密配置中。

### Bridge

- 只监听 `127.0.0.1`。
- 连接需要 session token。
- `/uxp/*` 请求必须鉴权。
- 拒绝未知 command type。
- 拒绝超大 payload。
- 图片大文件走 assetId，不把大 RGBA 长期放在内存消息里。
- 日志不写 API Key。

### UXP

- manifest 必须声明本地网络权限。
- 连接本地 Bridge 时优先验证 `127.0.0.1`。
- 修改文档状态必须进入 `executeAsModal()`。
- 文件访问走 UXP `localFileSystem`。
- image data 用完必须 `dispose()`。

## Manifest 变化

UXP 插件需要保留本地 Bridge 权限：

```json
{
  "requiredPermissions": {
    "network": {
      "domains": "all"
    }
  }
}
```

改 manifest 后必须：

```bash
npm run verify:uxp
```

然后在 UXP Developer Tools 中执行 `Unload` / `Load`。

## 推荐目录结构

```text
lightyear-banana/
  apps/
    desktop/
      electron/
        main/
          bridgeServer.ts
          ipc.ts
          modelApi.ts
          assetStore.ts
          configStore.ts
        preload/
          index.ts
        renderer/
          App.vue
          components/
          composables/
  packages/
    protocol/
      bridgeTypes.ts
      validators.ts
    canvas/
      imageTypes.ts
      bounds.ts
  uxp/
    plugin/
      manifest.json
      src/
        main.ts
        bridgeClient.ts
        photoshopAdapter.ts
        canvasPrimitives.ts
```

当前仓库可以先不大迁移，先做 PoC：

```text
src/                 继续作为 Renderer 原型
electron/            新增 Electron main/preload
src/uxp/             保留 UXP Photoshop adapter
packages/protocol/   新增共享协议类型
```

## PoC 阶段

### P0：通信打通

目标：

```text
Electron Renderer 点击按钮
Main 转发命令
UXP 收到命令
UXP 返回 pong
Renderer 显示 Photoshop 已连接
```

验收：

- Electron App 启动。
- Bridge 监听本地端口。
- UXP 插件连接成功。
- Renderer 可看到 UXP 在线状态。
- 断开 Photoshop 或关闭 Electron 后状态更新。

### P1：抓取画布

目标：

```text
Renderer 点击“可见图层”
UXP 调用 imaging.getPixels()
Renderer 显示预览图
```

验收：

- 可见图层抓取成功。
- 返回 `previewUrl`、`width`、`height`、`sourceBounds`。
- 无文档时显示普通用户可读错误。
- UXP log 没有 fatal error。

### P2：写入 Photoshop

目标：

```text
Renderer 选择结果图
Main 找到图片缓存
UXP 写入 Photoshop
```

验收：

- 全画布写入成功。
- 当前选区写入成功。
- 指定 bounds 写入成功。
- 所有写入进入 `executeAsModal()`。

### P3：替换当前 UXP 面板主 UI

目标：

- UXP 面板只显示连接状态和基础调试按钮。
- 主工作台迁移到 Electron Renderer。
- 原 Web 原型能力在 Electron 中保留。

验收：

- Photoshop 内 UXP 面板不再承载复杂工作台。
- Electron 工作台可完成生图和 Photoshop 置入。
- 关闭 Electron 后 UXP 清楚显示未连接。

## 首批命令清单

```text
app.status
uxp.hello
uxp.goodbye
photoshop.status
canvas.captureVisible
canvas.captureSelection
canvas.captureLayer
canvas.readSelectionBounds
canvas.placeImage
canvas.createLayer
asset.put
asset.get
asset.delete
generation.create
generation.cancel
```

## 数据边界

### 小数据

可以直接走 IPC 或 Bridge 消息：

- 命令 type
- request id
- 文档标题
- bounds
- 状态文本
- 错误 code

### 中等数据

可以走 Bridge 消息，但要设置大小上限：

- 小尺寸 preview data URL
- 缩略图

### 大数据

走 asset store：

- 原始 RGBA
- 生成结果大图
- Photoshop full canvas

Main 负责 asset 生命周期：

- 写入临时目录
- 返回 assetId
- 定期清理
- 用户保存时转正式文件

## 和现有代码的对应关系

| 新架构模块 | 当前代码来源 |
| --- | --- |
| UXP Photoshop adapter | `src/uxp/canvasPrimitives.ts` |
| UXP service layer | `src/uxp/canvasPrimitiveService.ts` |
| Renderer 工作台 | `src/components/lightyear/` |
| 生图 API adapter | `src/services/imageApiClient.ts` |
| 模型能力配置 | `src/data/providerCapabilities.ts` |
| 类型定义 | `src/types/lightyear.ts` |
| Mock Server 参考 | `scripts/mock-image-api-server.mjs` |

## 技术选型建议

### Electron 打包

优先评估：

- Electron Forge
- electron-builder

当前项目已经使用 Vite，后续可以评估 `electron-vite`。先做 PoC 时不急于引入完整打包链，先让 `electron .` 跑通。

### Bridge 实现

开发期可以直接使用 Node 内置 HTTP server：

```text
node:http
```

如果后续需要更完整路由，再引入 Fastify 或 Hono。PoC 阶段不需要复杂框架。

### 协议校验

推荐使用 Zod 或轻量自写 validator。命令入口必须校验：

- `type`
- `id`
- `payload`
- `token`
- payload 大小

## 验证清单

每次改 Bridge：

- Electron Main 可启动。
- Renderer 可加载。
- UXP 可连接。
- 断线重连可用。
- 未打开 Photoshop 文档时错误可读。
- 大图不会卡死 Renderer。
- 日志不包含 API Key。

每次改 UXP：

- `npm run verify:uxp`
- UDT `Reload`
- 改 manifest 后 UDT `Unload` / `Load`
- Photoshop 中真实文档回归抓图和写入
- Photoshop UXP log 无 fatal error

每次改 Renderer：

- Web/Electron UI 都能打开。
- 主流程按钮状态正确。
- 长任务有进度。
- 错误状态可恢复。

## 不做的事

- UXP 插件不监听 HTTP 端口。
- Renderer 不直接访问 Node API。
- Renderer 不保存 API Key 明文。
- Bridge 不监听 `0.0.0.0`。
- Bridge 不接受无 token 连接。
- Photoshop 文档修改不绕过 `executeAsModal()`。

## 参考资料

- Electron Security: https://www.electronjs.org/docs/latest/tutorial/security
- Electron IPC: https://www.electronjs.org/docs/latest/tutorial/ipc
- Electron contextBridge: https://www.electronjs.org/docs/latest/api/context-bridge
- Electron ipcMain: https://www.electronjs.org/docs/latest/api/ipc-main
- Adobe UXP Manifest v5: https://developer.adobe.com/photoshop/uxp/2022/guides/uxp_guide/uxp-misc/manifest-v5/
- Adobe UXP Network Operations: https://developer.adobe.com/premiere-pro/uxp/resources/recipes/network/
- 项目 UXP 原子能力：`ref/atomic-capabilities.md`
- 项目画布原语：`ref/canvas-primitives.md`
- 项目开发注意事项：`ref/development-notes.md`

# Lightyear Banana

在 Photoshop 里用 AI 生成图片。

把 Photoshop 画布、选区和图层当作参考图，连接多个 AI 生图模型，生成结果直接置入文档。

## 安装

### 方式一：完整桌面版（macOS）

下载 `Lightyear-Banana-0.1.0-mac.zip`，解压后把 `Lightyear Banana.app` 拖到 `应用程序` 文件夹。

双击启动后，Electron 工作台会自动打开。按照界面指引在 Photoshop 中加载 UXP 插件即可连通。

### 方式二：仅 UXP 插件

如果只需要 Photoshop 面板，下载 `lightyear-banana-0.1.0.ccx`。

打开 Adobe Creative Cloud 桌面端，把 `.ccx` 文件拖入窗口即可安装。或者通过 UXP Developer Tools 加载。

## 使用

1. 在 Photoshop 中打开或新建一个文档。
2. 打开 Lightyear Banana 面板（菜单 > 增效工具 > Lightyear Banana）。
3. 从画布添加参考图 —— 可见图层、当前选区或选中图层。
4. 输入提示词，选择模型和参数。
5. 点击发送，等待 AI 生成。
6. 生成结果可以直接置入 Photoshop 文档，也可以作为下一轮的参考图。

## 支持的模型

- OpenAI（GPT Image）
- Google Gemini
- 字节跳动 Seedream
- 阿里通义 Qwen
- 快手 Kling
- 兼容 OpenAI 接口的自定义模型

## 配置 API Key

在面板中切换到设置页，新建模型配置，填入对应服务的 API Key 即可使用。

## 系统要求

- macOS 14 及以上
- Photoshop 2026（27.3.0 及以上）
- 部分功能在非 Photoshop 环境下不可用（置入图片、抓取画布等）



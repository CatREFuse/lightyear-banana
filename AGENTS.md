# AGENTS.md instructions for /Users/tanshow/Developer/lightyear-banana


## 部署参数

请在 `key.env` 环境变量中获取部署参数（参数以 `key.env.example` 为准）：
- server_ip
- password（官网部署脚本明确拒绝密码，仅支持 SSH 公钥，详见 `docs/site-deployment.md`）
- domain
- secondary_domain


## Release Build Gate

- 修改或提交版本号前，必须先读取 `docs/build-todo-list.md`。
- 发布门禁按三条线执行：CCX 以 `docs/build-todo-list.md` 为准；WebUI 部署见 `docs/inner-webui-deployment.md`；官网部署见 `docs/site-deployment.md`。
- Electron 桌面端已移除，不再有 macOS/Windows 桌面打包门禁（历史发行记录见 `docs/build-todo-list.md`）。
- 官网发布前必须确认 CCX 发行物与 `dist/ccx-release.json` 一致，否则只记录待办，不更新线上 `latest.json`。

## 拒绝 Comment 内容直接出现在最终产物文案中

在执行文案写作任务（包含前端 coding 中的文案写作和文章写作任务时），需要时时刻刻主要你写的东西是面向**普通用户或者读者的**，因此的你的产物中不得包含任何包括工程性的文本（comment）。

例子 1 前端：
<h1>热门榜单</h1>
<p>这部分是过去 24 小时的浏览量最高的文章<p> ❌ 这种文案是 comment，用户看了只会觉得奇怪
<p>24 小时最热</p> ✅ 正常 UX writting

例子 2 PPT：
本 PPT 的演讲主题是集中于... ❌ 这种也是 comment 演讲稿，不应该出现最终面向被演讲者正文里！
<主题样式>...</主题样式> ✅ 正常的主题样式表明主题即可

例子 3 给了改写来源的写作任务：
以原文中的...举例  ❌ 读者不需要原文的存在
以..举例✅

## 拒绝以下句式表达

- 不是..., 而是...
- 一句话总结：...（尤其是冒号）
- 真相是：...
- 残酷的真相

## 创意写作的逻辑

- 同一主题请直击重点，不要翻来覆去介绍
- 创意写作时严禁使用 markdown 列表（有序无序）
- 所有的句子、过渡词和连接词替换为最基础、最常用的词语。尽量使用简单、直接的表达方式，避免使用复杂或生僻的词汇，确保句子之间的逻辑关系清晰，删掉文末总结的部分。
- 有参考的情况下，请通过重构句子和段落的逻辑，确保思想的流畅性并且与原文有所区别

## Mugen 开发参考路由

开发本项目时优先查阅 `docs/ref/`。`docs/` 保留研究过程和更完整背景，`docs/ref/` 是后续开发的直接参考。

| 任务 | 查阅文件 |
| --- | --- |
| 当前功能规格、Nothing 主题、Provider 注册层、预设提示词 | `docs/spec.md` |
| 项目定位、当前验证状态、运行命令、源码入口 | `docs/ref/project-baseline.md` |
| Photoshop 画布抓图、选区、图层、插图等交互原语 | `docs/ref/canvas-primitives.md` |
| CCX entrypoint、Photoshop host、imaging、modal、batchPlay、文件访问等原子能力 | `docs/ref/atomic-capabilities.md` |
| Vue 3、Vite、TypeScript、Manifest v5、CCX 构建和校验 | `docs/ref/framework-build.md` |
| UDT 加载、Reload/Unload、真实 Photoshop 验证、错误处理、UI 文案注意事项 | `docs/ref/development-notes.md` |
| 主流生图模型 API 格式、spec、参考图上限、Provider Adapter 设计 | `docs/ref/image-model-api-specs.md` |
| 参考文件总入口 | `docs/ref/README.md` |

## 开发约定

- 所有功能改动必须符合需求文档；动手前先核对 `docs/mugen-prototype-requirements.md` 和相关交互文档，改完后自查本次变更是否违背需求文档。
- 如果实现和需求文档不一致，先更新或确认需求文档，再继续改代码；不得把临时实现默认为新需求。
- 新增 Photoshop 画布能力时，先在 `plug-in/src/ccx/canvasPrimitives.ts` 增加最小原子函数，再由 `plug-in/src/ccx/canvasPrimitiveService.ts` 暴露服务层方法。
- Vue 组件和 composable 不直接拼复杂 batchPlay descriptor。
- 修改 Photoshop 文档状态的操作必须进入 `core.executeAsModal()`。
- 改 Vue、TypeScript、CSS 后运行 `npm run build:ccx`，再在 Adobe UXP Developer Tools 中 `Reload`。
- 改 manifest、entrypoint、icon、权限后运行 `npm run verify:ccx`，再在 Adobe UXP Developer Tools 中 `Unload` / `Load`。
- 完成 CCX 相关改动后至少运行 `npm run verify:ccx`。

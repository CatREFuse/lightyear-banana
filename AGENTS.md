# AGENTS.md instructions for /Users/tanshow/Developer/lightyear-banana


## 仓库结构

Mugen 是 monorepo,按功能模块组织,npm 配置内聚在各模块目录,根目录只保留 workspace 聚合与编排:

| 目录 | 职责 | npm workspace | 关键入口 |
| --- | --- | --- | --- |
| `plug-in/` | Photoshop CCX 插件(宿主、画布原语、打包链) | `@mugen/plug-in` | `src/ccx/main.ts`、`manifest.json`、`vite.ccx.config.ts`、`scripts/` |
| `webui/` | Inner WebUI(浏览器与 CCX 内嵌共用工作台) | `@mugen/inner-webui` | `src/main.ts`、`src/components/mugen/`、`src/host/`、`public/mock-images/` |
| `homesite/` | 单屏官网(站点源码 + 构建/部署脚本) | `@mugen/homesite` | `site/index.html`、`scripts/build-site.mjs`、`scripts/deploy-site.mjs` |
| `packages/mugen-core/` | 共享生图业务核心(Provider、请求、能力、类型) | `@mugen/core` | `src/index.ts`(export * 全部符号) |
| `packages/inner-protocol/` | WebUI ↔ CCX 通信协议 | `@mugen/inner-protocol` | `src/index.ts` |
| `utils/` | 跨模块脚手架(测试服务、smoke、nginx 策略、部署夹具) | 无(平铺脚本) | `mock-image-api-server.mjs`、`regression-smoke.mjs`、`deploy/nginx/` |
| `docs/` | 文档(11 篇)与开发参考(`docs/ref/` 8 篇) | — | `docs/build-todo-list.md` 为发布门禁索引 |

模块间依赖方向:`plug-in` → `@mugen/core` + `@mugen/inner-protocol`;`webui` → `@mugen/core` + `@mugen/inner-protocol`;`homesite` 只读 `plug-in` 的构建产物(`dist/`)。共享业务必须进 `packages/mugen-core`,不要在模块间复制代码或跨模块相对引用(例外:`mugen-core` 内部对 `inner-protocol` 用相对路径,因为 regression-smoke 以 node10 模式编译)。

构建产物统一输出到根 `dist/`(`dist/ccx-host/`、`dist/site/`、`dist/mugen-<v>.ccx`、`dist/ccx-release.json`)。

## 常用命令

根 `package.json` 只做编排,模块命令在各自 `package.json`:

| 命令 | 作用 |
| --- | --- |
| `npm run dev` / `build:inner-webui` | WebUI 开发/构建(转发到 webui workspace) |
| `npm run test:protocol` / `test:capabilities` / `test:ccx-host` / `test:inner-webui` | 各模块测试(转发到对应 workspace) |
| `npm run verify:ccx` | WebUI 构建 → plug-in typecheck + CCX 构建 → 产物校验 |
| `npm run package:ccx` / `package:ccx:local` | 完整发布门禁链 / 本地打包(`dist/mugen-<v>.ccx` + sha256 + `ccx-release.json`) |
| `npm run deploy:inner-webui` | WebUI 云端部署(`--verify-only` 只校验公网) |
| `npm run build:site` / `deploy:site` | 官网构建 / 部署(转发到 homesite) |
| `npm run mock:image-api` / `mock:apimart` / `smoke:apimart-server` | 本地 Mock 生图服务 |
| `npm run test:release-policy` / `test:site-optics` / `test:site-deploy` | 发布策略 / 官网 / 部署测试 |
| `npm run test:regressions` / `test:prompt-presets` / `test:imini-provider` | 跨模块回归冒烟(从仓库根运行) |

## 部署参数

请在 `key.env` 环境变量中获取部署参数(参数以 `key.env.example` 为准,双 schema 并存):

官网部署:
- server_ip(SSH 主机;与 `DEPLOY_SSH_HOST` 同时出现必须一致)
- password(官网部署脚本明确拒绝密码,仅支持 SSH 公钥,详见 `docs/site-deployment.md`)
- domain(官网公网域名)
- secondary_domain(备用域名,仅记录)

WebUI 部署:
- INNER_WEBUI_URL / INNER_RELEASE_URL(正式 HTTPS 地址,写入 CCX)
- DEPLOY_SSH_HOST / DEPLOY_SSH_USER / DEPLOY_SSH_PORT / DEPLOY_SSH_IDENTITY_FILE
- DEPLOY_WEB_ROOT / DEPLOY_RELEASES_ROOT(服务器绝对路径)

`key.env` 被 Git 忽略,只存部署参数,不存用户模型 API Key。

## 发布与部署门禁

- 修改或提交版本号前，必须先读取 `docs/build-todo-list.md`。
- 发布门禁按三条线执行：CCX 以 `docs/build-todo-list.md` 为准；WebUI 部署见 `docs/inner-webui-deployment.md`；官网部署见 `docs/site-deployment.md`。
- Electron 桌面端已移除，不再有 macOS/Windows 桌面打包门禁（历史发行记录见 `docs/build-todo-list.md`）。
- 正式 `package:ccx` 只接受干净工作树；官网发布前必须确认 CCX 发行物与 `dist/ccx-release.json` 一致，构建把版本化 CCX 放入 `download/` 并纳入全站哈希；`releases/latest.json` 已废弃。
- Nginx 安全策略切换与回滚按 `docs/nginx-security-policy-rollout.md` 执行；WebUI 部署模板在 `utils/deploy/nginx/inner-webui.conf.template`。

## 文档路由

开发时优先查阅 `docs/ref/`。`docs/` 保留研究过程和更完整背景，`docs/ref/` 是后续开发的直接参考。

| 任务 | 查阅文件 |
| --- | --- |
| 当前功能规格、Nothing 主题、Provider 注册层、预设提示词 | `docs/spec.md` |
| 项目定位、当前验证状态、运行命令、源码入口 | `docs/ref/project-baseline.md` |
| Photoshop 画布抓图、选区、图层、插图等交互原语 | `docs/ref/canvas-primitives.md` |
| CCX entrypoint、Photoshop host、imaging、modal、batchPlay、文件访问等原子能力 | `docs/ref/atomic-capabilities.md` |
| Vue 3、Vite、TypeScript、Manifest v5、CCX 构建和校验 | `docs/ref/framework-build.md` |
| CCX + Inner WebUI 开发流程、原子功能 Cookbook、调试和常见坑 | `docs/ref/ccx-inner-webui-cookbook.md` |
| UDT 加载、Reload/Unload、真实 Photoshop 验证、错误处理、UI 文案注意事项 | `docs/ref/development-notes.md` |
| 主流生图模型 API 格式、spec、参考图上限、Provider Adapter 设计 | `docs/ref/image-model-api-specs.md` |
| 参考文件总入口 | `docs/ref/README.md` |

| 任务(部署/运维) | 查阅文件 |
| --- | --- |
| 版本号、CCX、WebUI、官网发布的强制检查清单 | `docs/build-todo-list.md` |
| WebUI 与 CCX 的构建、部署、回滚流程 | `docs/inner-webui-deployment.md` |
| 官网单屏站点的部署、验收、回滚流程 | `docs/site-deployment.md` |
| Nginx 安全策略切换操作手册 | `docs/nginx-security-policy-rollout.md` |
| Mock 生图 API Server 使用手册 | `docs/mock-image-api-server.md` |
| WebUI 产品需求与双运行时规格 | `docs/inner-webui-prd.md`、`docs/mugen-interaction-spec.md`、`docs/mugen-prototype-requirements.md` |

## 开发约定

- 所有功能改动必须符合需求文档；动手前先核对 `docs/mugen-prototype-requirements.md` 和相关交互文档，改完后自查本次变更是否违背需求文档。
- 如果实现和需求文档不一致，先更新或确认需求文档，再继续改代码；不得把临时实现默认为新需求。
- 新增 Photoshop 画布能力时，先在 `plug-in/src/ccx/canvasPrimitives.ts` 增加最小原子函数，再由 `plug-in/src/ccx/canvasPrimitiveService.ts` 暴露服务层方法。
- Vue 组件和 composable 不直接拼复杂 batchPlay descriptor。
- 修改 Photoshop 文档状态的操作必须进入 `core.executeAsModal()`。
- 改 Vue、TypeScript、CSS 后运行 `npm run build:ccx`，再在 Adobe UXP Developer Tools 中 `Reload`。
- 改 manifest、entrypoint、icon、权限后运行 `npm run verify:ccx`，再在 Adobe UXP Developer Tools 中 `Unload` / `Load`。
- 完成 CCX 相关改动后至少运行 `npm run verify:ccx`。
- 共享业务改动进 `packages/mugen-core`，改完运行 `npm run test:capabilities`；不要在 webui/plug-in 之间互相引用对方源码。

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

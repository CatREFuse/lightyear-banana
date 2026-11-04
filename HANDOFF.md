# Mugen 生产交接 · 2026-11-04

## 接收入口

仓库：https://github.com/CatREFuse/lightyear-banana

交接分支：`codex/handoff-mugen-20261104`。它从最终发行分支 `codex/startup-release-20261103` 的 `b65b4f6ef055ac59e1e6a90dab1c7c13318eea23` 创建，额外追加交接文档。接收方通过 GitHub 获取代码，不依赖源机器的工作树或临时目录。

```sh
git clone --branch codex/handoff-mugen-20261104 https://github.com/CatREFuse/lightyear-banana.git mugen
cd mugen
git status --short
git log -5 --oneline
npm ci
```

阅读顺序：`AGENTS.md`、本文件、`docs/spec.md`、`docs/build-todo-list.md`、`docs/startup-diagnostics-release.md`、`docs/release-sop.md`。接收时以交接分支为生产源码基线；GitHub main 和源机器 main 不代表此次生产版本。交接文档提交本身没有部署到服务器。

## 生产版本与完整提交

| 对象 | 版本/标识 | 来源提交 |
| --- | --- | --- |
| CCX 安装包 | 1.2.6+2611030002 | `14d0a3ead14e99c5bb56a8fbdb296f7894bf308b` |
| 官网发行元数据 | site-7b860b0dfc23 | `59e1a7feb6ad507aadde9823d860bfb82dd844d1` |
| 最终发行记录 | 0002 正式地址确认 | `b65b4f6ef055ac59e1e6a90dab1c7c13318eea23` |
| WebUI | 0.2.6-1be424d45523 | `94935baf733b7a6ce9b64956272c41863b3371f5` |
| 启动补丁 | 重试隔离与分阶段日志 | `34469f9108b7364f208973f8dbdc1629b45c9de0` |
| 历史下载继承修复 | filename 通过同对象 url 定位 | `4af8d57f15f8be3ef0d68782a028d96bf9ce0a45` |

正式安装包：https://mugen.catrefuse.com/download/imini-ps-1.2.6-2611030002.ccx

- 文件大小：63084 字节。
- SHA256：`b2e32212af8cea4beb87f008bc055fb54ca756a858f627aa80652148a974d54f`。
- 插件 ID：`com.tanshow.mugen`；Manifest 版本 `1.2.6`；build `2611030002`。
- 插件工作台：https://mugen.catrefuse.com/webui/ 。Manifest 仅授权 `https://mugen.catrefuse.com`；JS 不含 imini-test 域名。
- 官网：https://mugen.catrefuse.com/ 。当前快照标识：`20261103T154815Z-1372a5d53c70-c7ebab50`。
- WebUI 与 CCX 独立发行。此次只发布 CCX 与官网元数据，没有重新部署 WebUI。

2026-11-04 交接时重新从公网读取 site-release.json、webui/release.json 并完整下载 CCX；版本、提交、63084 字节与 SHA256 均一致。解包再次确认正式 URL 与 Manifest origin。不要使用已被更正的 `2611030001`：它曾错误保留测试站地址。部分历史发行记录仍保留该次过程，当前合同以 `2611030002` 为准。

## 架构与关键边界

- `plug-in/`：UXP/Photoshop CCX Host、WebView 壳、原生画布与文件能力、打包。
- `webui/`：Vue 3 工作台，浏览器及 CCX WebView 共用；不随 CCX 打包。
- `packages/mugen-core/`：共享 Provider、请求和业务类型。
- `packages/inner-protocol/`：`inner-host/v1` 消息合同；Host 与 WebUI 保留严格来源/对象/会话校验。
- `homesite/`：官网、CCX 下载元数据、不可变快照构建及部署。
- `utils/`：Mock、跨模块验证、部署与发行保留。

Photoshop 读写以生产稳定实现为基线，用户明确冻结读取与置入方案；中间缩略图和压缩使用内部字节逻辑，不调用 Photoshop 文档操作。不要把源 main 的较早版本或未提交实现覆盖到本交接基线。

## 启动修复与日志判读

`plug-in/src/ccx/inner/webviewShell.ts` 负责 WebView 生命周期。每次重试创建新实例并清除旧监听器及加载/握手计时器；来源同时检查规范化 origin 与当前实例。`plug-in/src/ccx/main.ts` 在异步命令返回后重新校验来源，丢弃旧实例握手结果。原始 20 秒加载与 15 秒握手超时保持不变。

`startup.begin` 含会话与插件/PS/UXP 版本；`attempt` 关联每轮启动。`webview.listeners.registered`、`webview.load.start`、`webview.load.navigation`、`webview.load.stop` 记录监听及导航；`webview.load.error` 含原生 code；`bridge.send`/`bridge.receive` 保留命令及校验元数据；拒绝原因为 origin-mismatch、source-mismatch、inactive-attempt。`webview.retry.cleanup` 与 `host.command.discarded` 确认旧实例隔离，`startup.ready` 表示握手完成。日志不记录完整业务 payload/result 或 nonce，URL 参数与常见凭证内容会脱敏。

没有 loadstop 的加载超时不能直接认定为网络故障；loadstop 后的握手超时仍需 WebView 控制台区分脚本异常、接收器时序及桥对象状态。日志中 origin 的末尾斜杠可能来自脱敏序列化，实际比较使用 `.origin`，已通过测试排除该假设。

现场旧日志 `mugen-startup-1.2.4+2609100002-2026-11-03T15-08-09-160Z.jsonl` 未取得，首次超时根因尚未定案。后续应收集新版首次失败及重试后的 JSONL、PS/UXP 版本、对应时段 WebView 运行异常与 uxpHost 状态。

## 环境、验证与发布

要求 Node >=22.12、npm >=11.6.2 且 <12（仓库 packageManager 为 npm 11.6.2），部署服务器需 GNU/Linux、Python 3.8+、flock 与 GNU coreutils。真实 PS/UXP 安装验证需要对应操作系统宿主，浏览器不能替代。

```sh
npm run dev
npm run test:protocol
npm run test:inner-webui
npm run test:ccx-host
npm run test:capabilities
npm run verify:ccx
node --test utils/deploy/release-retention.test.mjs
```

`test:ccx-host` 含本机 Mock 服务。WebUI 完整发布门禁为 `npm run verify:inner-webui:release`；本次交接不执行发布。

上一轮验证记录：Host 113、协议 19、WebUI 29 加 4 项策略检查、共享核心 73、Mock API 6、发行保留 18 均通过；完整 package:ccx 与 build:site 通过。macOS 上 8 项 GNU/Linux/Git-for-Windows 条件测试按既有规则跳过。0002 从干净提交重新运行完整 package:ccx，并通过公网解包校验；本次只新增交接文档，不重复声称进行了 PS 实测。

未来发布严格按 `docs/build-todo-list.md`、`docs/release-sop.md` 执行：改版本前读门禁，运行 `npm run bump:ccx-build` 并提交新 build；干净提交执行 `TMPDIR=/private/tmp npm run package:ccx`；使用实际发行文件更新首页及 llms.txt/LLM.TXT；提交后执行 `npm run build:site`、`npm run deploy:site -- --dry-run`、`npm run deploy:site`，最后公网逐字节回读。相同语义版本重打包也必须使用新 build，不复用 2611030002。

仅当 WebUI 源码发生变化才走其独立构建部署；CCX URL、Manifest origin 与打包检查必须统一为正式地址，不允许通过环境变量重新覆盖为测试站。`dist/` 是忽略的构建输出，不通过 Git 同步；现有正式 CCX 从公网下载并验证以上哈希，需要复现构建时使用指定源码提交与相同部署 URL 参数。

部署脚本只接受 SSH 公钥，参数名见 `key.env.example`。key.env 与密钥不进入仓库；接收方须在解密交接后按本机密钥路径配置。TLS 私钥、用户模型 API Key、全局 GitHub 登录凭据和整个 SSH 配置库均不属于本次普通代码交接范围。

回滚命令见 SOP：`npm run deploy:site -- --rollback`、`npm run deploy:inner-webui -- --rollback`。它们只适用于验收事务中有效 previous 尚存的情况。已成功验收后服务器按策略只保留 current，previous 被清除；需要恢复旧版时，从对应 Git 提交重新构建，生成新 build 并正常发布，不能假设历史副本仍在服务器。旧 releases/latest.json 已退出首页下载链，但其仍引用的版本目录文件须被完整保留，不能跳过真实缺失/穿越/软链接校验。

## 未提交工作与后续处理

源 main 为 `4acadab`，与生产发行分支存在差异。以下工作不属于生产包，也没有提交到交接分支。文件状态只表示修改/删除/未跟踪，不表示功能完成；不要整批 cherry-pick 或覆盖生产源码。

- 官网背景从 Three.js 向 WGSL/WebGPU 迁移的工作区改动与旧 vendor 删除。
- WebUI 设置、输入/比例、预览、交互审计、workspace 与配置测试等工作区改动。
- protocol、Host 存储、资产与 Provider 的工作区改动。
- 发布保留相关部分已在生产分支独立落地，源 main 仍可能有重复但不同的未提交版本，需逐项比对。
- `.agents/`、`output/` 与新增测试等未跟踪目录/文件未审定，不作为可发布代码上传。

完整路径清单：`docs/handoff/uncommitted-inventory-20261104.txt`。清单对应 2026-11-04 源端工作区；实际差异内容仍在源机器，尚未通过 GitHub 同步。后续若接收方需要这些 WIP，需要单独审查、排除秘密并保存为独立 WIP 分支，不能将其视为已经交接。

## 未完成事项

- Windows 双击 CCX 安装、真实 Photoshop 启动及抓图/请求/取图/置入完整闭环未完成。源端 Photoshop 应用启动调用超时；自动测试不替代实机验收。
- 现场最初启动超时的根因未确定，新日志用于下一轮定位。
- 源端上一轮 Nginx 检查曾有 sites-enabled 中备份文件重复加载的域名冲突警告；本次未修改该配置，也未据此认定是启动问题根因。处理前重新读取实际生效配置并独立验证。
- WebUI 服务器仍可能保留较多旧发行目录；此次仅官网执行成功验收后的 current 保留，未对 WebUI 目录做清理或部署。
- 未提交工作只交接清单，具体 WIP 内容待后续独立处理。
- 凭证尚未发送。接收方需要通过本聊天传入真实公钥/证书内容及可核对指纹，不能只给另一台机器的本地路径；源端不读取接收方私钥。凭证只在公钥校验后加密，密文通过双方可访问的授权通道传输，解密步骤与密文哈希另行交付。无需交接任何全局凭证库。

本交接不更改服务器、不重新部署、不合并或强推 main。

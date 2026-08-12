# Build TODO List

本清单用于修改版本号、准备 CCX、发布 WebUI 或切换正式官网前的强制检查。当前活动产品是 WebUI vNext、Photoshop CCX 和单屏官网。Electron、旧官网与 Inner WebUI 0.1 已归档；独立 UXP 产品代码已经删除。

当前阶段允许部署 WebUI vNext、单屏官网与不可变的 CCX 版本文件。完整 macOS、Windows、CCX 与 `SHA256SUMS.txt` 尚未齐备时，必须保留线上 `latest.json`，不得把局部产物声明为完整正式发行；缺失项继续记录 TODO。macOS 与 Windows 包属于历史兼容发行工件，不在官网展示且不属于活动产品。

## 生命周期与版本规则

- 根 `package.json` 的 Electron `0.3.x` 版本被冻结。正常 vNext 开发不得增加 Electron 版本、恢复桌面入口或生成新的桌面发行说明。
- Electron UI 源码可在迁移完成前保留，但只作为 WebUI vNext 的代码平移来源，不得作为活动 runtime 依赖。
- 修改 Inner WebUI 版本时，确认 `apps/inner-webui/package.json`、兼容信息、构建元数据和 CCX 内嵌版本一致。
- 本地 `verify:ccx` 接受干净或脏工作树，但 Inner WebUI `0.2.0` 的源码构建与 CCX 内嵌副本必须绑定当前 HEAD，且两份 `release.json` 的 `dirty` 必须与实际工作树状态一致；内容哈希和逐字节目录比较仍须通过。
- 正式 `package:ccx` 只接受干净工作树及两份 `dirty: false` 元数据。归档生成后必须逐文件回验归档与最终 staging 目录，`dist/ccx-release.json` 的 `sourceCommit` 必须与同一干净 WebUI 构建提交一致。
- Inner WebUI `0.1.x` 已废弃。vNext 正式发布不得继续声明为 `0.1.x`，也不得把旧 0.1 构建当作通过证据。
- 修改 CCX 版本时，确认 `plugin/manifest.json`、构建后的 `dist/ccx-host/manifest.json`、CCX 文件名、`.sha256` 与 `dist/ccx-release.json` 一致。
- 不得恢复 `standalone-uxp-plugin/`、`src/uxp/`、`vite.uxp.config.ts`、`uxp-panel.html` 或旧 `*:uxp` 产品命令。
- 插件 ID 必须保持 `com.tanshow.mugen`。

## Electron 历史重建门禁

Electron 已废弃，以下规则只在明确要求重建历史桌面版本或修改根 Electron 版本时启用：

- 修改或提交根 `package.json` 版本号前必须重新读取本文件。
- Windows 环境必须产出 `dist/mugen-$VERSION-win.zip`；macOS 环境必须产出 `dist/mugen-$VERSION-mac.zip`。
- 不允许使用跨平台临时包替代正式平台包。
- Windows 构建后检查 macOS 包；macOS 构建后检查 Windows 包。缺少另一平台正式包时必须派发对应原生环境任务。
- 派发任务写明版本、文件名、上传文件、SHA256 和是否重建 `SHA256SUMS.txt`。
- 当前平台产物缺失或版本不一致时，不得提交根版本号或创建该桌面版本 tag。

## WebUI vNext 迁移门禁

- 提供 Electron UI 旧模块到 vNext 模块的迁移映射，证明工作台、消息流、输入 Dock、设置、Provider、预设、结果卡片和主题来自源码平移。
- WebUI bundle 不得依赖 Electron preload、IPC、本地 Bridge、桌面窗口或自动更新模块。
- CCX 与浏览器从同一 WebUI 源码构建，运行时差异通过 adapter 或 capability contract 实现。
- 普通浏览器必须能完成配置、配置测试、真实网络生成、任务轮询、取消和结果查看。
- 普通浏览器的 DOM、焦点顺序、菜单和快捷键中不得存在 Photoshop 画布、选区、图层读取或置入入口。
- CCX 必须保留画布读取和结果置入；Photoshop 文档修改必须进入 `core.executeAsModal()`。
- 生产 bundle 不得自动启用 Mock Host 或 APIMart 测试配置。

## APIMart 双运行时测试门禁

- APIMart 本地夹具提供模型列表、参考图上传、生成提交、任务查询、图片获取、状态重置和请求记录。
- 所有成功图片响应固定返回同一张小猫 fixture；不得随机选择不同猫图。
- 浏览器冒烟验证配置新建、测试、保存、重载、网络生成、小猫结果、错误或取消路径，以及 Photoshop 入口完全不存在。
- CCX 冒烟在真实 Photoshop 中完成画布抓取、APIMart 请求、小猫图片获取、置入当前文档和新图层断言。
- 单元测试、浏览器 Mock、静态 `verify:ccx` 或只观察界面不能替代 Photoshop 完整闭环。

## 官方单屏站点门禁

- 旧官网结构和文案不得重新进入生产首页。
- 页面只有一屏，用户可见主体限于毛笔书法 `Mugen`、`下载 CCX`、`进入 WebUI` 和 CCX 标本号。
- 书法资源来自 ImageGen 并完成超分，保留母版和网站优化版本；加载失败时显示文字兜底。
- Three.js 背景显示一束白光进入三棱镜并折射为彩色光谱，棱镜可由指针或触摸旋转。
- WebGL 不可用和 `prefers-reduced-motion` 有稳定兜底。
- 两个按钮使用 CSS 液态玻璃材质，键盘焦点、触摸、对比度和不支持 `backdrop-filter` 的环境均可用。
- CCX 标本号、下载 URL、Manifest、文件大小和 SHA256 来自一致的发布元数据。
- `npm run build:site` 和站点自动化通过后才允许部署。
- 桌面与移动视口都完成视觉和交互检查，且主要操作不依赖滚动。

## 正式官网发布门禁

- 发布前确认 `dist/release-$VERSION/` 同时包含 macOS、Windows、CCX 和 `SHA256SUMS.txt`；任一文件缺失时只记录待办，不更新线上 `latest.json`。
- macOS 包必须由 macOS 环境打包，Windows 包必须由 Windows 环境打包；不接受跨平台临时包。
- 桌面端已废弃，因此新首页与用户可见 `latest.json` 下载项只提供 CCX。macOS 与 Windows 产物仅用于满足现行完整发行包门禁和保存历史，不恢复桌面端入口。
- `下载 CCX` 只指向已校验文件；`进入 WebUI` 只指向通过浏览器门禁的 vNext 地址。
- `site/releases/latest.json` 的地址使用 `key.env` 中的正式域名，仓库与生产产物不得恢复已废弃域名。
- 正式构建来自已提交的干净工作区，并记录提交、构建时间、版本、文件大小与 SHA256。
- 公网发布后逐字节验证入口 HTML、关键资源、CCX 文件和元数据，并检查 TLS、MIME、CSP、HSTS 与 `nosniff`。

## vNext 发布证据清单

- [ ] Electron UI 到 WebUI vNext 的源码迁移映射已评审。
- [ ] WebUI 单元、Provider、协议、浏览器 E2E 和生产构建通过。
- [ ] 浏览器 APIMart 冒烟通过，固定小猫与无 Photoshop 入口断言通过。
- [ ] `npm run verify:ccx` 通过。
- [ ] CCX 已在真实 Photoshop 完成抓取、请求、取图、置入完整闭环。
- [ ] 官网单屏视觉、交互、性能、可访问性与静态兜底通过。
- [ ] `dist/release-$VERSION/` 的 macOS、Windows、CCX 与 `SHA256SUMS.txt` 齐全且匹配。
- [ ] 公网读回和安全响应头检查通过，最后才更新 `latest.json`。

## 旧 Inner WebUI 0.1 / CCX 1.0 状态（归档）

- Inner WebUI `0.1.0` 曾通过 `inner-host/v1` 与旧 Host 接入，并使用本地打包 WebUI。
- 旧基线曾通过协议、WebUI、CCX Host 和部分发布校验，也曾生成 `dist/mugen-1.0.0.ccx`。
- 旧公网 WebUI 和官网曾返回 200，旧域名也曾配置跳转。
- 真实 Photoshop 的旧 Inner WebUI 完整业务回归未形成正式通过证据。
- 上述结果只能用于历史追溯，不计入 vNext 发布证据。

## Electron 历史发行记录

### Electron 0.3.19（归档）

- 本次修复将生图请求从“所有异常自动重试 99 次”收敛为只对网络中断、限流和服务端临时错误最多重试 2 次；参数、鉴权和权限错误立即结束。Electron 诊断导出同步增加脱敏后的生图请求状态、尝试次数和错误原因。
- 诊断日志测试 8/8、重试策略与既有回归、TypeScript 检查、Web 构建和当时的 CCX Host 构建均已通过。
- Windows 包由当前 Windows 环境构建，并完成应用版本、build number、内嵌 CCX 与 SHA256 校验：`lightyear-banana-0.3.19-win.zip`，build number：`202608090001`，SHA256：`c22c3d3d7153741fcd92906b0024f294f6b1133b14da4331e87ce2f5b15866ef`。
- CCX 已在 Windows 环境构建并验证根包与内嵌 manifest：`lightyear-banana-0.3.19.ccx`，SHA256：`42c1209d922f896af65e143bb5e37cb1a1620ff3f1bf8f558e6f5b7ee7541b37`。
- macOS 原生包尚未构建。完整发布前必须从包含本次改动的远端 ref 派发 `Package macOS`，取得 `lightyear-banana-0.3.19-mac.zip` 及 SHA256；当前不创建完整 `dist/release-0.3.19/`，不更新官网 `latest.json` 和静态下载链接。

### Electron 0.3.18（归档）

- 本次修复针对 Gemini 图生图偶发未跟随参考图比例：参考图比例匹配 Gemini 支持枚举时，Google Gemini 明确发送 `aspectRatio`，APIMart Gemini 明确发送 `size`；非常规比例继续使用原有自动跟随语义。
- 附件日志确认 `9504 × 6336` 的 3:2 参考图曾返回 `5504 × 3072` 的近 16:9 结果，同源后续结果恢复为近 3:2；客户端抓图宽高稳定，问题落在 Gemini 自动跟随的软约束。
- 3:2、2:3、尺寸量化容差、非常规比例回退和显式固定比例回归均已覆盖；诊断日志测试 8/8、比例与画布回归、TypeScript 检查、Web 构建和当时的 CCX Host 构建均已通过。
- Windows 包由当前 Windows 环境构建，并完成应用版本、build number、内嵌 CCX 与 SHA256 校验：`lightyear-banana-0.3.18-win.zip`，SHA256：`dd28168b23ab4869a959932da81e47582035d36c136917daa58f5b9e09dca0fe`。
- CCX 已在 Windows 环境构建并验证根包与内嵌 manifest：`lightyear-banana-0.3.18.ccx`，SHA256：`f5048c975870b51dc9a1e1ae945589f684ed0bd72f47da130376275f36c37a25`。
- Windows 成品已实际启动并创建 `Lightyear Banana` 窗口；包内版本为 `0.3.18`，Web 资源包含 build number `202607310001`。
- macOS 包由 GitHub Actions 原生 macOS runner 从提交 `82aa7f4a45114e92a58f9fc7d789709afc15e425` 构建，诊断测试、比例回归、版本校验、归档校验和 artifact 上传均已通过：`lightyear-banana-0.3.18-mac.zip`，SHA256：`8fc8a3428e814246c23fad15a30accc34236781ee324634d5e717a5613002d02`，Actions run：`30635533484`。
- `dist/release-0.3.18/` 已包含原生 macOS、原生 Windows、CCX 和只使用 basename 的 `SHA256SUMS.txt`，本地 release bundle 校验已通过；官网 `latest.json` 需在完整站点门禁、GitHub Release 和正式资产部署完成后最后切换。

### Electron 0.3.17（归档）

- 本次修复让可见合成图读取绑定 Photoshop 当前活动历史状态，避免直接打开的 Camera Raw／ARW 文档在图层操作后继续使用首次打开时的旧状态；诊断日志同步增加图层数量、历史状态 ID 和名称。
- 诊断日志测试 8/8、ARW／智能对象历史状态回归、TypeScript 构建和当时的 CCX Host 构建均已通过。
- Windows 包由当前 Windows 环境构建，并完成应用版本、build number、内嵌 CCX 与 SHA256 校验：`lightyear-banana-0.3.17-win.zip`，SHA256：`8ef033193f2d6edd9fb34b675b0ba195affa5c7f7ba6c40c1ec1be43c04a0c5e`。
- CCX 已在 Windows 环境构建并验证内嵌 manifest：`lightyear-banana-0.3.17.ccx`，SHA256：`87aa18b5894554ac1d3f18243cce2d0a2ceeebcd2ca10b08a4443db955f87866`。
- Windows 成品已使用电脑控制实际启动，并验证版本 `0.3.17` 与 build number `202607270001`。
- macOS 包由 GitHub Actions 原生 macOS runner 构建并完成包内版本、CCX、Info.plist、build number 与 SHA256 校验：`lightyear-banana-0.3.17-mac.zip`，SHA256：`bd01a491dae1bfe49559e23e62728461cf4207d132a89b992dc2047dd117960f`，Actions run：`30212510944`。
- `dist/release-0.3.17/` 已包含原生 macOS、原生 Windows、CCX 和只使用 basename 的 `SHA256SUMS.txt`；`scripts/verify-release-bundle.mjs` 与 `scripts/build-site.mjs` 已通过。
- PR `#3` 已合并，tag `v0.3.17` 与 GitHub Release 已发布；四个 GitHub 资产均返回 200，大小和服务端 SHA256 digest 与本地正式发行物一致。
- Photoshop 最终 ARW 实机回归被当前 Adobe 账户的“请求访问 Photoshop”授权页拦截。电脑控制已重启 Creative Cloud 并复查，账户仍显示 Photoshop 需要管理员授权，因此没有提交访问申请，也没有绕过授权。
- 官网 0.3.17 已发布：macOS、Windows、CCX 和 `SHA256SUMS.txt` 已部署至正式版本目录，公网完整下载的字节数与 SHA256 均和本地正式发行物一致；`latest.json` 已从 0.3.16 原子切换至 0.3.17，旧清单备份为 `.latest.json.0.3.16-backup-20260728`。主页、版本清单和三个下载地址均返回 200，Nginx 配置校验与重载通过，TLS 证书域名和有效期正常。部署使用已有交互式凭据，未在仓库或配置文件中保存凭据。

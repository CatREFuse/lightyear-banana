# Build TODO List

本清单用于修改版本号、准备 CCX、发布 WebUI 或切换正式官网前的强制检查。当前活动产品是 WebUI vNext、Photoshop CCX 和单屏官网。Electron 桌面端源码已彻底移除（2026-08-12）；旧官网与 Inner WebUI 0.1 已归档；独立 UXP 产品代码已经删除。

当前阶段允许部署 WebUI vNext、单屏官网与站点内的版本化 CCX 文件。官网从 `download/` 直接提供当前 CCX，文件必须来自干净提交的打包产物并进入全站哈希；`releases/latest.json` 已废弃。

统一执行顺序与完成标准见 `docs/release-sop.md`。本清单是强制门禁，SOP 是正式操作流程；两者都必须满足。

## 生命周期与版本规则

- Electron 桌面端源码已删除（2026-08-12），不得恢复桌面入口、electron 依赖或桌面发行脚本。
- 修改 Inner WebUI 版本时，确认 `webui/package.json`、兼容信息和构建元数据一致；兼容 `inner-host/v1` 的 WebUI 可以独立发布，无需重新打包 CCX。
- 本地 `verify:ccx` 接受干净或脏工作树，必须确认 Host 只注入 `https://mugen.catrefuse.com/webui/`、Manifest 只授权该 Origin，且 `dist/ccx-host/` 不包含 `webui/` 静态目录。
- 正式 `package:ccx` 只接受干净工作树。归档生成后必须逐文件回验归档与最终 staging 目录，`dist/ccx-release.json` 的 `sourceCommit` 绑定 CCX Host 的干净提交。
- Inner WebUI `0.1.x` 已废弃。vNext 正式发布不得继续声明为 `0.1.x`，也不得把旧 0.1 构建当作通过证据。
- 修改 CCX 版本时，确认 `plug-in/manifest.json`、构建后的 `dist/ccx-host/manifest.json`、CCX 文件名、`.sha256` 与 `dist/ccx-release.json` 一致。
- CCX 发布前确认 `https://mugen.catrefuse.com/webui/` 和 `compatibility.json` 可访问，并兼容 `inner-host/v1`；该检查不要求云端文件与当前 CCX 仓库提交一致。
- 每次 CCX 发布必须依次完成当前版本打包、官网首页与两份 LLM 文本的版本化下载信息更新、`npm run build:site` 和公网读回。官网 `下载 CCX` 必须指向本次 `dist/ccx-release.json` 的文件名；仍指向任一旧版本时停止站点构建和部署。
- `npm run package:ccx` 完成只代表本地发行物可用。`npm run deploy:site` 完成原子切换且公网版本化 CCX 的逐字节回读通过后，才允许记录为 CCX 正式发布。
- Windows CCX 由仓库打包脚本生成，归档格式必须对齐 Adobe UXP Developer Tools 的 `Package` 产物特征；不得使用 PowerShell `Compress-Archive` 或系统右键压缩直接充当发行包。资源管理器双击安装及 Photoshop 可用性由分发验收确认，命令行安装不能代替该结果。
- 代码生成的 CCX 必须在归档根目录直接包含 Manifest 与运行资源，使用 UDT 一致的文件条目、Manifest 首项、Deflate、数据描述符和 Unix `0644` 权限；`manifest.json` 只移除末尾单个换行，其他条目必须与 `dist/ccx-host/` 逐字节一致。完整特征见 `docs/ref/framework-build.md`。
- 不得恢复 `standalone-uxp-plugin/`、`src/uxp/`、`vite.uxp.config.ts`、`uxp-panel.html` 或旧 `*:uxp` 产品命令。
- 插件 ID 必须保持 `com.tanshow.mugen`。

## WebUI vNext 迁移门禁

- 工作台、消息流、输入 Dock、设置、Provider、预设、结果卡片和主题均为当前仓库直接实现（原 Electron UI 迁移已完成并删除桌面源码）。
- WebUI bundle 不得依赖 Electron preload、IPC、本地 Bridge、桌面窗口或自动更新模块。
- CCX 与浏览器从同一 WebUI 源码构建，运行时差异通过 adapter 或 capability contract 实现。
- CCX 通过云端地址加载当前 WebUI，WebUI 发布链不复制进入 CCX 发行物。
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
- 三棱镜使用四面体造型，默认色散偏移为 `2.5`、红光折射率为 `1.3`、转速为 `0.55`、入射角为 `8°` 并持续自转；连续点击棱镜 5 次后显示不含自转开关的光路参数面板。
- WebGL 不可用和 `prefers-reduced-motion` 有稳定兜底。
- 两个按钮使用 CSS 液态玻璃材质，键盘焦点、触摸、对比度和不支持 `backdrop-filter` 的环境均可用。
- CCX 标本号、下载 URL、Manifest、文件大小和 SHA256 来自一致的发布元数据。
- `npm run build:site` 和站点自动化通过后才允许部署。
- 桌面与移动视口都完成视觉和交互检查，且主要操作不依赖滚动。

## 正式官网发布门禁

- 发布前确认 CCX 发行物与 `dist/ccx-release.json` 一致；不一致时停止官网构建，不更新 `download/`。
- 桌面端已删除，新首页只从 `download/` 提供一个版本化 CCX。
- `下载 CCX` 只指向已校验文件；`进入 WebUI` 只指向通过浏览器门禁的 vNext 地址。
- 官网源文件中的 CCX 下载 URL、标本号、打包时间、文件大小和 SHA256 全部更新为本次发行元数据后才允许构建；不得沿用上一版本的任一字段。
- `homesite/site/`、`dist/site/` 和首页运行时不得包含或请求 `releases/latest.json`；仓库与生产产物不得恢复已废弃域名。
- 正式构建来自已提交的干净工作区，并记录提交、构建时间、版本、文件大小与 SHA256。
- 公网发布后逐字节验证入口 HTML、关键资源、CCX 文件和元数据，并检查 TLS、MIME、CSP、HSTS 与 `nosniff`。

## vNext 发布证据清单

- [ ] 生产 WebUI 不含 Electron runtime 依赖（bundlePolicy 回归防线通过）。
- [ ] WebUI 单元、Provider、协议、浏览器 E2E 和生产构建通过。
- [ ] 浏览器 APIMart 冒烟通过，固定小猫与无 Photoshop 入口断言通过。
- [ ] Windows Photoshop 从提示词输入状态切出再返回后可以继续键盘输入，其他焦点状态不会被提示词输入框抢占。
- [ ] `npm run verify:ccx` 通过。
- [ ] CCX 产物只包含 Host 资源，WebView URL、Manifest Origin 和远程消息桥权限校验通过，归档中没有 `webui/` 目录。
- [ ] UDT 格式兼容的 CCX 已在 Windows 资源管理器完成双击安装验收，并在 Photoshop 中可用。
- [ ] CCX 已在真实 Photoshop 完成抓取、请求、取图、置入完整闭环。
- [ ] 官网单屏视觉、交互、性能、可访问性与静态兜底通过。
- [ ] `dist/` 的 CCX 与 `SHA256SUMS.txt` 匹配。
- [ ] 官网 `下载 CCX` 指向本次最新版 CCX，标本号、文件大小与 SHA256 均和 `dist/ccx-release.json` 一致。
- [ ] 公网逐字节读回 `download/` CCX 和安全响应头检查通过。
- [ ] `docs/release-sop.md` 的 WebUI、CCX、官网和公网验收状态已分别记录，没有用本地打包结果代替正式发布。

## 旧 Inner WebUI 0.1 / CCX 1.0 状态（归档）

- Inner WebUI `0.1.0` 曾通过 `inner-host/v1` 与旧 Host 接入，并使用本地打包 WebUI。
- 旧基线曾通过协议、WebUI、CCX Host 和部分发布校验，也曾生成 `dist/mugen-1.0.0.ccx`。
- 旧公网 WebUI 和官网曾返回 200，旧域名也曾配置跳转。
- 真实 Photoshop 的旧 Inner WebUI 完整业务回归未形成正式通过证据。
- 上述结果只能用于历史追溯，不计入 vNext 发布证据。

## Electron 历史发行记录（Electron 已删除，仅存档）

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
- `dist/release-0.3.17/` 已包含原生 macOS、原生 Windows、CCX 和只使用 basename 的 `SHA256SUMS.txt`；`homesite/scripts/verify-release-bundle.mjs` 与 `homesite/scripts/build-site.mjs` 已通过。
- PR `#3` 已合并，tag `v0.3.17` 与 GitHub Release 已发布；四个 GitHub 资产均返回 200，大小和服务端 SHA256 digest 与本地正式发行物一致。
- Photoshop 最终 ARW 实机回归被当前 Adobe 账户的“请求访问 Photoshop”授权页拦截。电脑控制已重启 Creative Cloud 并复查，账户仍显示 Photoshop 需要管理员授权，因此没有提交访问申请，也没有绕过授权。
- 官网 0.3.17 已发布：macOS、Windows、CCX 和 `SHA256SUMS.txt` 已部署至正式版本目录，公网完整下载的字节数与 SHA256 均和本地正式发行物一致；`latest.json` 已从 0.3.16 原子切换至 0.3.17，旧清单备份为 `.latest.json.0.3.16-backup-20260728`。主页、版本清单和三个下载地址均返回 200，Nginx 配置校验与重载通过，TLS 证书域名和有效期正常。部署使用已有交互式凭据，未在仓库或配置文件中保存凭据。

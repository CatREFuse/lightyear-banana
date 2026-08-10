# Build TODO List

本清单用于每次修改版本号、准备 GitHub Release 或准备官网发布前的构建检查。Electron 桌面端、CCX Host 和 Inner WebUI 从 1.0 架构开始独立版本化。

## 版本提交前必做

- 修改根 `package.json` 的 Electron 版本时，确认 `package.json`、`package-lock.json`、`electron/main.js`、`README.md`、`site/releases/latest.json`、`site/index.html` 的桌面端版本一致。
- 修改 CCX 版本时，确认 `plugin/manifest.json`、`standalone-uxp-plugin/manifest.json` 与构建后的 `dist/ps-uxp/manifest.json` 一致；CCX 产物名从构建后的 Manifest 读取版本。
- 修改 Inner WebUI 版本时，确认 `apps/inner-webui/package.json`、`compatibility.json` 和构建元数据一致。
- 提交根 `package.json` 的 Electron 版本号前，必须先打包当前运行平台的桌面端产物；只修改独立 CCX 或 Inner WebUI 版本时，执行下方对应门禁。
- 在 Windows 上提交 Electron 版本时，必须产出并验证 `dist/lightyear-banana-$VERSION-win.zip`。
- 在 macOS 上提交 Electron 版本时，必须产出并验证 `dist/lightyear-banana-$VERSION-mac.zip`。
- 不允许用 Windows 交叉生成的 macOS 包或 macOS 交叉生成的 Windows 包作为正式官网发行物。
- Electron 当前平台产物缺失或版本不一致时，不得提交 Electron 版本号、不得打 tag、不得更新桌面端官网发行信息。

## 跨平台派发判断

- Windows 打包完成后，检查 `dist/release-$VERSION/lightyear-banana-$VERSION-mac.zip` 是否存在且版本正确。
- 如果 macOS 包缺失、版本不一致或 SHA256 不在 `SHA256SUMS.txt` 中，必须派发 macOS 打包任务。
- macOS 打包完成后，检查 `dist/release-$VERSION/lightyear-banana-$VERSION-win.zip` 是否存在且版本正确。
- 如果 Windows 包缺失、版本不一致或 SHA256 不在 `SHA256SUMS.txt` 中，必须派发 Windows 打包任务。
- 派发任务必须写明版本号、目标文件名、需要上传回来的文件、SHA256 校验要求和是否需要重新生成 `SHA256SUMS.txt`。

## 官网发布门禁

- 官网发布必须等 `dist/release-$VERSION/` 同时包含：
  - `lightyear-banana-$VERSION-mac.zip`
  - `lightyear-banana-$VERSION-win.zip`
  - `lightyear-banana-$CCX_VERSION.ccx`
  - `SHA256SUMS.txt`
- `SHA256SUMS.txt` 必须覆盖上述三个安装包。
- `site/releases/latest.json` 的下载地址必须全部指向 `key.env` 配置的新正式 Origin；仓库和正式产物不得包含已废弃域名。
- `site/index.html` 的静态兜底链接必须和 `latest.json` 同步。
- `npm run build:site` 通过后才允许部署官网。
- 缺少任一平台包时，只能发布当前平台 GitHub 资产或记录待办，不得把官网 `latest.json` 切到该版本。

## Inner WebUI 0.1 / CCX 1.0 发布门禁

- `apps/inner-webui/package.json` 必须为 `0.1.0`，两个 UXP Manifest 必须为 `1.0.0`，根 Electron 版本保持独立。
- `npm run verify:inner-webui:release`、`npm run verify:uxp` 和 `npm run package:uxp` 必须全部通过。
- 正式构建前必须在忽略提交的 `key.env` 中提供 `INNER_WEBUI_URL`；该地址必须是新域名上的 HTTPS URL，并以 `/` 结尾。
- 先部署 WebUI 并从公网校验 `compatibility.json` 的 `webVersion`，再打包嵌入同一 Origin 的 CCX。
- CCX 包名必须为 `dist/lightyear-banana-1.0.0.ccx`，包内 Manifest、Host 协议和 WebView Origin 必须通过静态检查。
- 发布前必须在真实 Photoshop 中完成握手、画布抓取、参考图、BYOK、生成、取消、落图、保存、历史和诊断导出的回归。
- 真实 Photoshop 回归通过前，Electron 只进入维护状态，不删除旧实现和既有安装包。

## 当前 Inner WebUI 0.1 / CCX 1.0 状态

- Vue 3、TypeScript、Tailwind CSS WebUI 与 UXP Host 已按 `inner-host/v1` 接入，BYOK 明文仅保存在 UXP SecureStorage。
- 构建、自动化测试、CCX 打包、公网部署和真实 Photoshop 回归必须以本次实际执行结果更新，未执行的门禁不得标记完成。
- 当前工作区缺少 `key.env`，正式 Origin、SSH 目标、服务器发布和生产 CCX 仍处于阻断状态。

## 当前 0.3.19 状态

- 本次修复将生图请求从“所有异常自动重试 99 次”收敛为只对网络中断、限流和服务端临时错误最多重试 2 次；参数、鉴权和权限错误立即结束。Electron 诊断导出同步增加脱敏后的生图请求状态、尝试次数和错误原因。
- 诊断日志测试 8/8、重试策略与既有回归、TypeScript 检查、Web 构建、UXP 构建和 `verify:uxp` 均已通过。
- Windows 包由当前 Windows 环境构建，并完成应用版本、build number、内嵌 CCX 与 SHA256 校验：`lightyear-banana-0.3.19-win.zip`，build number：`202608090001`，SHA256：`c22c3d3d7153741fcd92906b0024f294f6b1133b14da4331e87ce2f5b15866ef`。
- CCX 已在 Windows 环境构建并验证根包与内嵌 manifest：`lightyear-banana-0.3.19.ccx`，SHA256：`42c1209d922f896af65e143bb5e37cb1a1620ff3f1bf8f558e6f5b7ee7541b37`。
- macOS 原生包尚未构建。完整发布前必须从包含本次改动的远端 ref 派发 `Package macOS`，取得 `lightyear-banana-0.3.19-mac.zip` 及 SHA256；当前不创建完整 `dist/release-0.3.19/`，不更新官网 `latest.json` 和静态下载链接。

## 当前 0.3.18 状态

- 本次修复针对 Gemini 图生图偶发未跟随参考图比例：参考图比例匹配 Gemini 支持枚举时，Google Gemini 明确发送 `aspectRatio`，APIMart Gemini 明确发送 `size`；非常规比例继续使用原有自动跟随语义。
- 附件日志确认 `9504 × 6336` 的 3:2 参考图曾返回 `5504 × 3072` 的近 16:9 结果，同源后续结果恢复为近 3:2；客户端抓图宽高稳定，问题落在 Gemini 自动跟随的软约束。
- 3:2、2:3、尺寸量化容差、非常规比例回退和显式固定比例回归均已覆盖；诊断日志测试 8/8、比例与画布回归、TypeScript 检查、Web 构建、UXP 构建和 `verify:uxp` 均已通过。
- Windows 包由当前 Windows 环境构建，并完成应用版本、build number、内嵌 CCX 与 SHA256 校验：`lightyear-banana-0.3.18-win.zip`，SHA256：`dd28168b23ab4869a959932da81e47582035d36c136917daa58f5b9e09dca0fe`。
- CCX 已在 Windows 环境构建并验证根包与内嵌 manifest：`lightyear-banana-0.3.18.ccx`，SHA256：`f5048c975870b51dc9a1e1ae945589f684ed0bd72f47da130376275f36c37a25`。
- Windows 成品已实际启动并创建 `Lightyear Banana` 窗口；包内版本为 `0.3.18`，Web 资源包含 build number `202607310001`。
- macOS 包由 GitHub Actions 原生 macOS runner 从提交 `82aa7f4a45114e92a58f9fc7d789709afc15e425` 构建，诊断测试、比例回归、版本校验、归档校验和 artifact 上传均已通过：`lightyear-banana-0.3.18-mac.zip`，SHA256：`8fc8a3428e814246c23fad15a30accc34236781ee324634d5e717a5613002d02`，Actions run：`30635533484`。
- `dist/release-0.3.18/` 已包含原生 macOS、原生 Windows、CCX 和只使用 basename 的 `SHA256SUMS.txt`，本地 release bundle 校验已通过；官网 `latest.json` 需在完整站点门禁、GitHub Release 和正式资产部署完成后最后切换。

## 当前 0.3.17 状态

- 本次修复让可见合成图读取绑定 Photoshop 当前活动历史状态，避免直接打开的 Camera Raw／ARW 文档在图层操作后继续使用首次打开时的旧状态；诊断日志同步增加图层数量、历史状态 ID 和名称。
- 诊断日志测试 8/8、ARW／智能对象历史状态回归、TypeScript 构建、UXP 构建和 `verify:uxp` 均已通过。
- Windows 包由当前 Windows 环境构建，并完成应用版本、build number、内嵌 CCX 与 SHA256 校验：`lightyear-banana-0.3.17-win.zip`，SHA256：`8ef033193f2d6edd9fb34b675b0ba195affa5c7f7ba6c40c1ec1be43c04a0c5e`。
- CCX 已在 Windows 环境构建并验证内嵌 manifest：`lightyear-banana-0.3.17.ccx`，SHA256：`87aa18b5894554ac1d3f18243cce2d0a2ceeebcd2ca10b08a4443db955f87866`。
- Windows 成品已使用电脑控制实际启动，并验证版本 `0.3.17` 与 build number `202607270001`。
- macOS 包由 GitHub Actions 原生 macOS runner 构建并完成包内版本、CCX、Info.plist、build number 与 SHA256 校验：`lightyear-banana-0.3.17-mac.zip`，SHA256：`bd01a491dae1bfe49559e23e62728461cf4207d132a89b992dc2047dd117960f`，Actions run：`30212510944`。
- `dist/release-0.3.17/` 已包含原生 macOS、原生 Windows、CCX 和只使用 basename 的 `SHA256SUMS.txt`；`scripts/verify-release-bundle.mjs` 与 `scripts/build-site.mjs` 已通过。
- PR `#3` 已合并，tag `v0.3.17` 与 GitHub Release 已发布；四个 GitHub 资产均返回 200，大小和服务端 SHA256 digest 与本地正式发行物一致。
- Photoshop 最终 ARW 实机回归被当前 Adobe 账户的“请求访问 Photoshop”授权页拦截。电脑控制已重启 Creative Cloud 并复查，账户仍显示 Photoshop 需要管理员授权，因此没有提交访问申请，也没有绕过授权。
- 官网 0.3.17 已发布：macOS、Windows、CCX 和 `SHA256SUMS.txt` 已部署至正式版本目录，公网完整下载的字节数与 SHA256 均和本地正式发行物一致；`latest.json` 已从 0.3.16 原子切换至 0.3.17，旧清单备份为 `.latest.json.0.3.16-backup-20260728`。主页、版本清单和三个下载地址均返回 200，Nginx 配置校验与重载通过，TLS 证书域名和有效期正常。部署使用已有交互式凭据，未在仓库或配置文件中保存凭据。

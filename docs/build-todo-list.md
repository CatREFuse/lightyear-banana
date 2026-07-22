# Build TODO List

本清单用于每次修改 `package.json` 版本号、准备 GitHub Release 或准备官网发布前的构建检查。

## 版本提交前必做

- 确认 `package.json`、`package-lock.json`、`plugin/manifest.json`、`standalone-uxp-plugin/manifest.json`、`electron/main.js`、`README.md`、`site/releases/latest.json`、`site/index.html` 的版本和下载链接指向同一个目标版本。
- 提交版本号前，必须先打包当前运行平台的桌面端产物。
- 在 Windows 上提交版本时，必须产出并验证 `dist/lightyear-banana-$VERSION-win.zip`。
- 在 macOS 上提交版本时，必须产出并验证 `dist/lightyear-banana-$VERSION-mac.zip`。
- 不允许用 Windows 交叉生成的 macOS 包或 macOS 交叉生成的 Windows 包作为正式官网发行物。
- 当前平台产物缺失或版本不一致时，不得提交版本号、不得打 tag、不得更新官网。

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
  - `lightyear-banana-$VERSION.ccx`
  - `SHA256SUMS.txt`
- `SHA256SUMS.txt` 必须覆盖上述三个安装包。
- `site/releases/latest.json` 的下载地址必须全部指向 `https://cake.catrefuse.com/releases/$VERSION/`。
- `site/index.html` 的静态兜底链接必须和 `latest.json` 同步。
- `npm run build:site` 通过后才允许部署官网。
- 缺少任一平台包时，只能发布当前平台 GitHub 资产或记录待办，不得把官网 `latest.json` 切到该版本。

## 当前 0.3.15 状态

- macOS 包由 GitHub Actions 原生 macOS runner 构建并完成包内版本、CCX、Info.plist、build number 与 SHA256 校验：`lightyear-banana-0.3.15-mac.zip`，SHA256：`55e5a8a57f3d56970bfd338338a4e6af7759167dd5cab6f0f17e050a487873ec`，Actions run：`29858677678`。
- Windows 包由当前 Windows 环境构建并完成应用版本、build number、内嵌 CCX 与 SHA256 校验：`lightyear-banana-0.3.15-win.zip`，SHA256：`990a82d298e877992aa67f9f4e20334bf91653a3447997545b24d317edd31228`。
- CCX 已在 Windows 环境构建并验证内嵌 manifest：`lightyear-banana-0.3.15.ccx`，SHA256：`25bea376d5c6a47a04fc566b9cec0b1507638bb42853dd7f8fc54f26142c9016`。
- Windows 强制交叉打包已完成，临时产物 `lightyear-banana-0.3.15-mac-cross-win.zip` 带交叉构建标识，SHA256：`7b3c16642cd7ee2d2b60497d320373f363a910d0f2f68a64d2f0fba37aa947e9`；该包不进入正式发行目录。
- `dist/release-0.3.15/` 已包含原生 macOS、原生 Windows、CCX 和只使用 basename 的 `SHA256SUMS.txt`。
- `scripts/verify-release-bundle.mjs` 和 `scripts/build-site.mjs` 已通过，GitHub Release `v0.3.15` 已发布并核对四个资产。
- 官网源码和发行物已部署，线上 `latest.json` 为 0.3.15；首页、三个下载地址和 `SHA256SUMS.txt` 均返回 200，公网回下载后的文件大小与 SHA256 和本地正式发行物一致。

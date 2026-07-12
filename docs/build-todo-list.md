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

## 当前 0.3.13 状态

- macOS 包由 GitHub Actions 的原生 macOS runner 构建并完成包内版本、CCX、Info.plist、build number 与 SHA256 校验：`lightyear-banana-0.3.13-mac.zip`，SHA256：`8343212d60671b6d8715532b6584d132e681cbda745bf5f3ec17b03b27121c1e`。
- Windows 包由当前 Windows 环境构建并完成应用版本、build number、内嵌 CCX 与 SHA256 校验：`lightyear-banana-0.3.13-win.zip`，SHA256：`c8e45b744d73d9945825a9c013a0ea6712469463632b8cc900f28f24ed159fd8`。
- CCX 已在 Windows 环境构建并验证内嵌 manifest：`lightyear-banana-0.3.13.ccx`，SHA256：`dc1f8d7d8b26c80b9cc322974ec93ef7e634f10ac9764c32fc561136e5fdd754`。
- `dist/release-0.3.13/` 已包含 macOS、Windows、CCX 和只使用 basename 的 `SHA256SUMS.txt`，三项校验均通过。
- `scripts/verify-release-bundle.mjs` 和 `scripts/build-site.mjs` 已通过，官网源码已同步 0.3.13 的文件名、大小、SHA256 与下载地址。
- 当前 Windows 环境没有官网服务器的 SSH 别名和 `rsync`，线上 `latest.json` 保持原版本；取得部署凭据后按 `docs/ops-manual.md` 先上传并验证三个资源，最后更新 `latest.json`。

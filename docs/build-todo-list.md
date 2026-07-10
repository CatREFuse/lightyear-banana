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

## 当前 0.3.12 状态

- macOS 包已由 macOS 环境构建、签名并验证：`lightyear-banana-0.3.12-mac.zip`。
- Windows 原生打包任务将在版本提交推送后派发到 GitHub Actions `Package Windows`，目标文件为 `lightyear-banana-0.3.12-win.zip`，要求返回 SHA256 校验文件。
- CCX 已构建并验证：`lightyear-banana-0.3.12.ccx`。
- `dist/release-0.3.12/` 等待双平台包和 CCX 就绪后生成覆盖三个安装包的 `SHA256SUMS.txt`。
- 官网源码和 `build:site` 命令不在当前仓库，暂不更新线上 `latest.json`。

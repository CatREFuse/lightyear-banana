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

## 当前 0.3.16 状态

- Windows 包由当前 Windows 环境构建并完成应用版本、build number、内嵌 CCX 与 SHA256 校验：`lightyear-banana-0.3.16-win.zip`，SHA256：`f9aaf2ceb07076474f8fa41d6ca8bc87ec486d73e3ac7c0e4b8761d6a00b142c`。
- CCX 已在 Windows 环境构建并验证内嵌 manifest：`lightyear-banana-0.3.16.ccx`，SHA256：`a6ca3f93c044b34efa5116b46ad55f5f8f09cab3881dfe53424b631ad63342ff`。
- Windows 强制交叉打包已完成，临时产物 `lightyear-banana-0.3.16-mac-cross-win.zip` 带交叉构建标识，SHA256：`3a0b242b97d1e433636a6d25e3d8bc267b174c371f136b4723139b4c4b698ea9`；该包不进入正式发行目录。
- Windows 成品已使用电脑控制实际启动并验证版本号、build number、APIMart `gpt-image-2-official` 模型和原图比例能力；未发送付费请求，也未保存测试配置。
- macOS 包由 GitHub Actions 原生 macOS runner 构建并完成包内版本、CCX、Info.plist、build number 与 SHA256 校验：`lightyear-banana-0.3.16-mac.zip`，SHA256：`b879e5b559728c5265bbca497eee7e565113cc7d9f163030fff915260393aa66`，Actions run：`29939337523`。
- `dist/release-0.3.16/` 已包含原生 macOS、原生 Windows、CCX 和只使用 basename 的 `SHA256SUMS.txt`；强制交叉包未进入该目录。
- `scripts/verify-release-bundle.mjs` 和 `scripts/build-site.mjs` 已通过，官网元数据已按三个正式产物的实际字节数与 SHA256 更新；GitHub Release、tag 和官网部署待完成。

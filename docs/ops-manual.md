# Lightyear Banana 运维手册

## 发行流程

每次发布时，GitHub Release、官网首页下载入口和官网版本检测 JSON 需要同步更新。Electron 启动检测和设置页手动检测都会读取：

```text
https://cake.catrefuse.com/releases/latest.json
```

正式发行物包含 macOS、Windows 和 CCX。两个桌面包必须在对应系统原生构建。官网下载地址统一托管在 `https://cake.catrefuse.com/releases/$VERSION/`，GitHub Release 用于保留发布记录和备份资产。

### 1. 准备版本

修改或提交 `package.json` 版本前，先读取 `docs/build-todo-list.md`。确认版本号和 12 位构建号，然后同步版本文件：

```bash
VERSION=0.3.13
BUILD_NUMBER=202607120001
node scripts/stamp-release-version.mjs --version "$VERSION" --build-number "$BUILD_NUMBER"
node scripts/stamp-release-version.mjs --check --version "$VERSION" --build-number "$BUILD_NUMBER"
```

PowerShell：

```powershell
$Version = "0.3.13"
$BuildNumber = "202607120001"
node scripts/stamp-release-version.mjs --version $Version --build-number $BuildNumber
node scripts/stamp-release-version.mjs --check --version $Version --build-number $BuildNumber
```

同时检查 `README.md`、`site/index.html`、`site/releases/latest.json`、`site/llms.txt` 和 `site/LLM.TXT`。站点文件要等三个正式发行物齐备后再切换到新版本。

### 2. 在当前平台构建

构建前运行测试：

```bash
npm ci
npm run test:diagnostics
npm run test:regressions
npm run verify:uxp
```

Windows 使用 PowerShell 构建 Windows 桌面包和 CCX：

```powershell
$Version = node -p "require('./package.json').version"
npm run build:web
npm run verify:uxp

$Dist = (Resolve-Path "dist").Path
$CcxZip = Join-Path $Dist "lightyear-banana-$Version.zip"
$Ccx = Join-Path $Dist "lightyear-banana-$Version.ccx"
Remove-Item -LiteralPath $CcxZip -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $Ccx -Force -ErrorAction SilentlyContinue
Push-Location "dist/ps-uxp"
Compress-Archive -Path * -DestinationPath $CcxZip -CompressionLevel Optimal
Pop-Location
Move-Item -LiteralPath $CcxZip -Destination $Ccx

node scripts/package-electron-win.mjs
Get-Item "dist/lightyear-banana-$Version-win.zip", $Ccx | Select-Object Name, Length
Get-FileHash -Algorithm SHA256 "dist/lightyear-banana-$Version-win.zip", $Ccx
```

macOS 使用原生环境构建 macOS 桌面包和 CCX：

```bash
VERSION=$(node -p "require('./package.json').version")
npm run package:electron:mac
shasum -a 256 \
  "dist/lightyear-banana-$VERSION-mac.zip" \
  "dist/lightyear-banana-$VERSION.ccx"
```

Windows 只能提交 Windows 正式包，macOS 只能提交 macOS 正式包。构建完成后，检查归档中的 `package.json`、应用版本和内置 CCX 版本都等于 `$VERSION`。

### 3. 派发另一平台构建

Windows 构建完成后，通过 `Package macOS` 工作流取得 macOS 原生包。工作流会在 macOS runner 上写入目标版本、运行测试、打包并生成只含文件名的 SHA 文件：

```powershell
$Version = node -p "require('./package.json').version"
$BuildNumber = "202607120001"
gh workflow run package-macos.yml --ref main -f "version=$Version" -f "build_number=$BuildNumber"
$RunId = gh run list --workflow package-macos.yml --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $RunId --exit-status
gh run download $RunId --name "lightyear-banana-$Version-macos" --dir "dist/action-macos-$Version"
Get-FileHash -Algorithm SHA256 "dist/action-macos-$Version/lightyear-banana-$Version-mac.zip"
Get-Content "dist/action-macos-$Version/lightyear-banana-$Version-mac.zip.sha256"
```

macOS 构建完成后，通过 `Package Windows` 工作流取得 Windows 原生包：

```bash
VERSION=$(node -p "require('./package.json').version")
gh workflow run package-windows.yml --ref main -f version="$VERSION"
RUN_ID=$(gh run list --workflow package-windows.yml --event workflow_dispatch --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RUN_ID" --exit-status
gh run download "$RUN_ID" \
  --name "lightyear-banana-$VERSION-windows" \
  --dir "dist/action-windows-$VERSION"
shasum -a 256 "dist/action-windows-$VERSION/lightyear-banana-$VERSION-win.zip"
cat "dist/action-windows-$VERSION/lightyear-banana-$VERSION-win.zip.sha256"
```

`Package Windows` 会核对所选 Git ref 中的 `package.json` 版本。派发前要先确认该 ref 已包含目标版本。CI 下载完成后仍需在本地重新计算 SHA256，不直接信任日志中的摘要。

### 4. 汇总发行物

最终目录必须包含：

- `lightyear-banana-$VERSION-mac.zip`
- `lightyear-banana-$VERSION-win.zip`
- `lightyear-banana-$VERSION.ccx`
- `SHA256SUMS.txt`

PowerShell：

```powershell
$Version = node -p "require('./package.json').version"
$ReleaseDir = Join-Path (Resolve-Path "dist").Path "release-$Version"
New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null
Copy-Item "dist/action-macos-$Version/lightyear-banana-$Version-mac.zip" $ReleaseDir
Copy-Item "dist/lightyear-banana-$Version-win.zip" $ReleaseDir
Copy-Item "dist/lightyear-banana-$Version.ccx" $ReleaseDir

Push-Location $ReleaseDir
$Files = @(
  "lightyear-banana-$Version-mac.zip",
  "lightyear-banana-$Version-win.zip",
  "lightyear-banana-$Version.ccx"
)
[string[]] $Lines = $Files | ForEach-Object {
  $Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $_).Hash.ToLowerInvariant()
  "$Hash  $_"
}
[IO.File]::WriteAllLines((Join-Path (Get-Location) "SHA256SUMS.txt"), $Lines, [Text.Encoding]::ASCII)
Pop-Location
```

macOS 或 Linux：

```bash
VERSION=$(node -p "require('./package.json').version")
RELEASE_DIR="dist/release-$VERSION"
mkdir -p "$RELEASE_DIR"
cp "dist/lightyear-banana-$VERSION-mac.zip" "$RELEASE_DIR/"
cp "dist/action-windows-$VERSION/lightyear-banana-$VERSION-win.zip" "$RELEASE_DIR/"
cp "dist/lightyear-banana-$VERSION.ccx" "$RELEASE_DIR/"
(
  cd "$RELEASE_DIR"
  shasum -a 256 \
    "lightyear-banana-$VERSION-mac.zip" \
    "lightyear-banana-$VERSION-win.zip" \
    "lightyear-banana-$VERSION.ccx" > SHA256SUMS.txt
)
```

生成 `SHA256SUMS.txt` 时必须先进入发行目录。清单每行只写文件名，不能写工作站、runner 或临时目录的绝对路径。

### 5. 更新并检查官网数据

三个包齐备后，使用实际文件信息更新 `site/releases/latest.json`：

- `version` 和 `tag`
- `publishedAt` 和 `releaseUrl`
- macOS、Windows、CCX 的 `filename`
- macOS、Windows、CCX 的 `url`
- macOS、Windows、CCX 的 `sha256`
- macOS、Windows、CCX 的 `size`

下载地址固定为：

```text
https://cake.catrefuse.com/releases/$VERSION/lightyear-banana-$VERSION-mac.zip
https://cake.catrefuse.com/releases/$VERSION/lightyear-banana-$VERSION-win.zip
https://cake.catrefuse.com/releases/$VERSION/lightyear-banana-$VERSION.ccx
https://cake.catrefuse.com/releases/$VERSION/SHA256SUMS.txt
```

同步更新 `site/index.html` 的三个静态下载链接、文件名、文件大小和 `SHA256SUMS.txt` 链接。`site/llms.txt` 与 `site/LLM.TXT` 内容必须完全相同，其中版本、下载 URL、SHA256 和字节数都要来自本次发行物。

运行完整门禁：

```bash
node scripts/verify-release-bundle.mjs
npm run build:site
```

`build:site` 会在复制站点前执行同一套检查，覆盖以下内容：

- 三个包存在且非空
- `SHA256SUMS.txt` 只有三个文件名，且每个 SHA256 与文件一致
- `latest.json` 的版本、tag、URL、文件名、SHA256 和字节数与本地文件一致
- 首页静态下载信息与 `latest.json` 一致
- 两份 llms 文件完全同步，版本、URL、SHA256 和字节数与本地文件一致

任一检查失败时，保留线上 `latest.json` 的旧版本。

### 6. 发布 GitHub Release

推送代码和 tag 后创建 Release：

```bash
VERSION=$(node -p "require('./package.json').version")
git tag "v$VERSION"
git push origin HEAD
git push origin "v$VERSION"
gh release create "v$VERSION" "dist/release-$VERSION"/* \
  --title "v$VERSION" \
  --notes "Lightyear Banana v$VERSION"
```

替换已有 Release 资产：

```bash
VERSION=$(node -p "require('./package.json').version")
gh release upload "v$VERSION" "dist/release-$VERSION"/* --clobber
```

确认 GitHub 备份资产可访问：

```bash
VERSION=$(node -p "require('./package.json').version")
gh release view "v$VERSION" --json tagName,assets
curl -fsSI -L "https://github.com/CatREFuse/lightyear-banana/releases/download/v$VERSION/lightyear-banana-$VERSION-mac.zip"
curl -fsSI -L "https://github.com/CatREFuse/lightyear-banana/releases/download/v$VERSION/lightyear-banana-$VERSION-win.zip"
curl -fsSI -L "https://github.com/CatREFuse/lightyear-banana/releases/download/v$VERSION/lightyear-banana-$VERSION.ccx"
```

PowerShell 中使用 `curl.exe`，避免调用 `Invoke-WebRequest` 的 `curl` 别名。

### 7. 部署官网

官网静态目录：

```text
/etc/nginx/static/lightyear-banana-site
```

Nginx 配置模板：

```text
deploy/nginx/cake.catrefuse.com.conf
```

先上传带版本的发行物，再从公网下载一遍并核对 SHA256 和文件大小。远端资源全部通过后才允许上传新的 `latest.json`：

```bash
set -euo pipefail
VERSION=$(node -p "require('./package.json').version")
RELEASE_DIR="dist/release-$VERSION"
REMOTE_BASE="https://cake.catrefuse.com/releases/$VERSION"
VERIFY_DIR=$(mktemp -d)
trap 'rm -rf "$VERIFY_DIR"' EXIT

ssh codex-47-97-root "mkdir -p /etc/nginx/static/lightyear-banana-site/releases/$VERSION"
rsync -az --delete "$RELEASE_DIR/" "codex-47-97-root:/etc/nginx/static/lightyear-banana-site/releases/$VERSION/"
ssh codex-47-97-root 'nginx -t && systemctl reload nginx'

for FILE in \
  "lightyear-banana-$VERSION-mac.zip" \
  "lightyear-banana-$VERSION-win.zip" \
  "lightyear-banana-$VERSION.ccx"
do
  curl --noproxy '*' -fsSL "$REMOTE_BASE/$FILE" -o "$VERIFY_DIR/$FILE"
  EXPECTED_SHA=$(awk -v file="$FILE" '$2 == file { print tolower($1) }' "$RELEASE_DIR/SHA256SUMS.txt")
  ACTUAL_SHA=$(shasum -a 256 "$VERIFY_DIR/$FILE" | awk '{ print tolower($1) }')
  test "$ACTUAL_SHA" = "$EXPECTED_SHA"
  test "$(wc -c < "$VERIFY_DIR/$FILE" | tr -d ' ')" = "$(wc -c < "$RELEASE_DIR/$FILE" | tr -d ' ')"
done
curl --noproxy '*' -fsSL "$REMOTE_BASE/SHA256SUMS.txt" | cmp - "$RELEASE_DIR/SHA256SUMS.txt"

rsync -az --delete \
  --exclude='/releases/***' \
  dist/site/ codex-47-97-root:/etc/nginx/static/lightyear-banana-site/
rsync -az dist/site/releases/latest.json codex-47-97-root:/etc/nginx/static/lightyear-banana-site/releases/latest.json
ssh codex-47-97-root 'nginx -t && systemctl reload nginx'
```

PowerShell 可在相同门禁下校验远端资源：

```powershell
$Version = node -p "require('./package.json').version"
$ReleaseDir = (Resolve-Path "dist/release-$Version").Path
$VerifyDir = Join-Path ([IO.Path]::GetTempPath()) "lightyear-banana-$Version-remote-check"
New-Item -ItemType Directory -Path $VerifyDir -Force | Out-Null
$Files = @(
  "lightyear-banana-$Version-mac.zip",
  "lightyear-banana-$Version-win.zip",
  "lightyear-banana-$Version.ccx"
)
foreach ($File in $Files) {
  $RemoteFile = Join-Path $VerifyDir $File
  Invoke-WebRequest "https://cake.catrefuse.com/releases/$Version/$File" -OutFile $RemoteFile
  $Local = Get-Item (Join-Path $ReleaseDir $File)
  $Remote = Get-Item $RemoteFile
  if ($Remote.Length -ne $Local.Length) { throw "Remote size mismatch: $File" }
  $Expected = (Get-FileHash -Algorithm SHA256 $Local.FullName).Hash
  $Actual = (Get-FileHash -Algorithm SHA256 $Remote.FullName).Hash
  if ($Actual -ne $Expected) { throw "Remote SHA256 mismatch: $File" }
}
```

静态文件同步时保留整个 `/releases/` 目录，避免清理历史发行物。`latest.json` 必须作为最后一个发布文件单独上传。部署主机使用 SSH Host `codex-47-97-root`，它在 `~/.ssh/config` 中绑定项目私钥。

### 8. 线上验收

```bash
curl --noproxy '*' -fsSI https://cake.catrefuse.com/
curl --noproxy '*' -fsSL https://cake.catrefuse.com/releases/latest.json | node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(0,"utf8")); console.log(JSON.stringify({version:m.version, mac:m.downloads.mac.filename, windows:m.downloads.windows.filename, ccx:m.downloads.ccx.filename, updateCheckUrl:m.updateCheckUrl}, null, 2));'
VERSION=$(node -p "require('./package.json').version")
curl --noproxy '*' -fsSI -L "https://cake.catrefuse.com/releases/$VERSION/lightyear-banana-$VERSION-mac.zip"
curl --noproxy '*' -fsSI -L "https://cake.catrefuse.com/releases/$VERSION/lightyear-banana-$VERSION-win.zip"
curl --noproxy '*' -fsSI -L "https://cake.catrefuse.com/releases/$VERSION/lightyear-banana-$VERSION.ccx"
curl --noproxy '*' -fsSL "https://cake.catrefuse.com/releases/$VERSION/SHA256SUMS.txt"
```

证书检查：

```bash
echo | openssl s_client -connect cake.catrefuse.com:443 -servername cake.catrefuse.com 2>/dev/null | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
```

验收标准：

- 官网返回 `200`
- 线上 `latest.json` 版本等于 `package.json`
- 三个下载 URL 都位于 `cake.catrefuse.com/releases/$VERSION/`
- 三个线上文件的 SHA256 和字节数与本地发行物一致
- 线上 `SHA256SUMS.txt` 与本地文件一致，清单中没有目录路径
- Electron 启动检测和设置页手动检测读取同一个 `latest.json`
- `cake.catrefuse.com` 证书域名匹配且在有效期内

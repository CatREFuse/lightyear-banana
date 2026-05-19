# Lightyear Banana 运维手册

## 发行流程

每次发布发行版时，GitHub Release、官网首页下载入口、官网版本检测 JSON 需要同步更新。Electron 版本的启动检测和设置页手动检测都会读取：

```text
https://cake.catrefuse.com/releases/latest.json
```

### 1. 更新版本

确认 `package.json` 中的 `version` 是目标发行版本。涉及安装说明、下载链接和官网静态兜底链接时，同步替换旧版本号。

常见需要检查的文件：

- `package.json`
- `README.md`
- `site/index.html`
- `site/releases/latest.json`

### 2. 构建发行物

```bash
VERSION=$(node -p "require('./package.json').version")
rm -rf "dist/release-$VERSION" "/tmp/lightyear-banana-release-$VERSION"
mkdir -p "/tmp/lightyear-banana-release-$VERSION"

npm run package:uxp
cp "dist/lightyear-banana-$VERSION.ccx" "/tmp/lightyear-banana-release-$VERSION/"

npm run package:electron:mac
cp "dist/lightyear-banana-$VERSION-mac.zip" "/tmp/lightyear-banana-release-$VERSION/"

npm run package:electron:win
cp "dist/lightyear-banana-$VERSION-win.zip" "/tmp/lightyear-banana-release-$VERSION/"

shasum -a 256 "/tmp/lightyear-banana-release-$VERSION"/* > "/tmp/lightyear-banana-release-$VERSION/SHA256SUMS.txt"
mkdir -p "dist/release-$VERSION"
cp "/tmp/lightyear-banana-release-$VERSION"/* "dist/release-$VERSION/"
```

最终目录需要包含：

- `lightyear-banana-$VERSION-mac.zip`
- `lightyear-banana-$VERSION-win.zip`
- `lightyear-banana-$VERSION.ccx`
- `SHA256SUMS.txt`

### 3. 发布 GitHub Release

先推送代码和 tag，再创建或更新 Release 资产。资产名需要和官网 JSON 保持一致。

```bash
VERSION=$(node -p "require('./package.json').version")
git tag "v$VERSION"
git push origin HEAD
git push origin "v$VERSION"

gh release create "v$VERSION" "dist/release-$VERSION"/* \
  --title "v$VERSION" \
  --notes "Lightyear Banana v$VERSION"
```

如果是在已有 Release 上替换资产：

```bash
VERSION=$(node -p "require('./package.json').version")
gh release upload "v$VERSION" "dist/release-$VERSION"/* --clobber
```

发布后验证资产可访问：

```bash
VERSION=$(node -p "require('./package.json').version")
gh release view "v$VERSION" --json tagName,assets
curl -fsSI -L "https://github.com/CatREFuse/lightyear-banana/releases/download/v$VERSION/lightyear-banana-$VERSION-mac.zip"
curl -fsSI -L "https://github.com/CatREFuse/lightyear-banana/releases/download/v$VERSION/lightyear-banana-$VERSION-win.zip"
curl -fsSI -L "https://github.com/CatREFuse/lightyear-banana/releases/download/v$VERSION/lightyear-banana-$VERSION.ccx"
```

### 4. 更新官网版本检测

GitHub Release 资产确认可访问后，更新 `site/releases/latest.json`。

必须同步的字段：

- `version`
- `tag`
- `publishedAt`
- `releaseUrl`
- `downloads.mac.filename`
- `downloads.mac.url`
- `downloads.mac.sha256`
- `downloads.mac.size`
- `downloads.windows.filename`
- `downloads.windows.url`
- `downloads.windows.sha256`
- `downloads.windows.size`
- `downloads.ccx.filename`
- `downloads.ccx.url`
- `downloads.ccx.sha256`
- `downloads.ccx.size`

`updateCheckUrl` 固定为：

```text
https://cake.catrefuse.com/releases/latest.json
```

官网首页有静态兜底链接，也需要同步更新 `site/index.html` 中的版本号、Release 链接、下载链接和 `SHA256SUMS.txt` 链接。页面加载后会用 `latest.json` 再刷新一次下载入口，但静态 HTML 不能留旧版本。

### 5. 构建并部署官网

`npm run build:site` 会检查 `site/releases/latest.json` 的 `version` 是否等于 `package.json` 的 `version`。

```bash
npm run build:site
```

官网线上静态目录：

```text
/etc/nginx/static/lightyear-banana-site
```

Nginx 配置模板：

```text
deploy/nginx/cake.catrefuse.com.conf
```

部署：

```bash
rsync -az --delete dist/site/ root@47.97.121.121:/etc/nginx/static/lightyear-banana-site/
ssh root@47.97.121.121 'nginx -t && systemctl reload nginx'
```

### 6. 线上验证

```bash
curl --noproxy '*' -fsSI https://cake.catrefuse.com/
curl --noproxy '*' -fsSL https://cake.catrefuse.com/releases/latest.json | node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(0,"utf8")); console.log(JSON.stringify({version:m.version, mac:m.downloads.mac.filename, windows:m.downloads.windows.filename, ccx:m.downloads.ccx.filename, updateCheckUrl:m.updateCheckUrl}, null, 2));'
```

继续验证三个下载地址：

```bash
VERSION=$(node -p "require('./package.json').version")
curl --noproxy '*' -fsSI -L "https://github.com/CatREFuse/lightyear-banana/releases/download/v$VERSION/lightyear-banana-$VERSION-mac.zip"
curl --noproxy '*' -fsSI -L "https://github.com/CatREFuse/lightyear-banana/releases/download/v$VERSION/lightyear-banana-$VERSION-win.zip"
curl --noproxy '*' -fsSI -L "https://github.com/CatREFuse/lightyear-banana/releases/download/v$VERSION/lightyear-banana-$VERSION.ccx"
```

证书验证：

```bash
echo | openssl s_client -connect cake.catrefuse.com:443 -servername cake.catrefuse.com 2>/dev/null | openssl x509 -noout -subject -issuer -dates -ext subjectAltName
```

验收标准：

- `https://cake.catrefuse.com/` 返回 `200`。
- `latest.json` 的 `version` 等于 `package.json` 版本。
- `latest.json` 中的 macOS、Windows、CCX 三个下载链接都指向当前 GitHub Release。
- 三个下载链接都返回可下载资产。
- Electron 启动检测和设置页手动检测读取同一个 `latest.json`。
- `cake.catrefuse.com` 证书域名匹配且未过期。

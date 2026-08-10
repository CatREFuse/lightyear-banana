# Inner WebUI 0.1 与 CCX 1.0 部署指南

Inner WebUI 与 CCX 独立发布。WebUI 使用 `0.1.0`，CCX 使用 `1.0.0`，根目录的 Electron 版本继续按原发行线维护。

## 部署配置

复制 `key.env.example` 为仓库根目录的 `key.env`。该文件已被 Git 忽略，只保存部署参数，不保存用户的模型 API Key。

必须提供以下参数：

- `INNER_WEBUI_URL`：WebUI 的正式 HTTPS 地址，必须以 `/` 结尾。该值会写入 CCX。
- `INNER_RELEASE_URL`：发行目录的正式 HTTPS 地址，必须以 `/` 结尾。该值会写入 CCX，并由发布门禁检查 `latest.json`。
- `DEPLOY_SSH_HOST`：部署服务器的主机名或 IP。
- `DEPLOY_WEB_ROOT`：服务器上的 WebUI 发布根目录。

可以提供以下参数：

- `DEPLOY_SSH_USER`：SSH 用户。
- `DEPLOY_SSH_PORT`：SSH 端口，默认 `22`。
- `DEPLOY_SSH_IDENTITY_FILE`：本机私钥文件。未设置时使用系统 SSH 配置或 agent。
- `DEPLOY_RELEASES_ROOT`：服务器上已有发行文件的目录，仅用于首次渲染 Nginx 模板，部署脚本不会修改发行文件。

`INNER_WEBUI_URL` 不得包含用户名、密码、查询参数或片段。正式构建会拒绝旧域名、HTTP 和 `.invalid` 占位域名。

## 首次配置 Nginx

以 `deploy/nginx/inner-webui.conf.template` 为模板替换以下值：

- `__SERVER_NAME__`
- `__TLS_CERTIFICATE__`
- `__TLS_CERTIFICATE_KEY__`
- `__INNER_WEBUI_ROOT__`
- `__RELEASES_ROOT__`

`__INNER_WEBUI_ROOT__` 必须与 `DEPLOY_WEB_ROOT` 相同，`__RELEASES_ROOT__` 必须与 `DEPLOY_RELEASES_ROOT` 相同。Nginx 的全局 `http` 配置必须加载标准 `mime.types`，确保 JavaScript 返回 JavaScript MIME、CSS 返回 `text/css`。`/releases/latest.json` 禁止缓存，版本化发行文件使用不可变缓存，点号开头的备份文件不会公开。启用配置后先执行 `nginx -t`，通过后再 reload，并通过 `nginx -T` 确认最终配置包含模板中的 CSP、HSTS 和 `nosniff` 响应头。WebUI 使用 Hash Router，浏览器路径固定在 `/inner/v1/`。

部署账号只需要目标目录的写权限，不使用日常管理员账号。服务器需要提供 POSIX `sh`、`tar`、`grep`、`flock`、`sha256sum`、`readlink`、`ln` 和 GNU `cp`、`mv`。模板启用 HSTS；同一域名仍承载 HTTP 资源时，先完成全站 HTTPS 迁移再启用该配置。

## 构建与发布

```powershell
npm ci
npx playwright install chromium
npm run verify:inner-webui:release
npm run deploy:inner-webui -- --dry-run
npm run deploy:inner-webui
npm run verify:inner-webui:public
npm run package:uxp
```

发布构建必须来自已提交的干净 Git 工作区。`release.json` 会记录提交、构建时间和内容哈希，部署脚本拒绝 `dirty` 构建。

部署脚本先复制稳定快照并逐文件校验上传内容，再按 WebUI 内容哈希创建不可变版本目录。服务器文件锁会串行激活，通过临时符号链接原子切换 `current`，并保留上一个目标为 `previous`。哈希资源累积保存在共享 `assets` 目录，已经打开的旧页面仍可完成懒加载。切换完成后，脚本会精确比对公网与本地 `release.json`、`compatibility.json`、入口 HTML 和入口资源字节，同时检查安全响应头与静态资源 MIME。公网校验失败时只会在 `current` 仍指向本次发布的情况下尝试恢复，避免回滚覆盖并发发布。

首次配置路由时可以先上传静态文件。该参数只允许服务器尚无 `current` 版本时使用：

```powershell
npm run deploy:inner-webui -- --skip-public-verify
```

Nginx 生效后必须重新执行不带跳过参数的正式部署，完成公网版本校验。

## 回滚

```powershell
npm run deploy:inner-webui -- --rollback
```

回滚会交换 `current` 与 `previous`，然后再次执行公网版本检查。部署脚本不会自动删除历史版本目录。

## 发布顺序

先发布并校验 WebUI，随后运行 `npm run package:uxp`。正式 CCX 打包入口会再次把公网 WebUI 与本地发布快照逐字节比对，并要求 Git 工作区干净。CCX 校验会确认 Manifest 版本为 `1.0.0`、WebView 只有一个正式 HTTPS Origin，并扫描构建产物中的旧域名和占位域名。最终产物为 `dist/lightyear-banana-1.0.0.ccx`，同目录的发布元数据和 SHA256 sidecar 用于 Electron 打包与产物追踪。

安装 CCX 后，在真实 Photoshop 中验证握手、画布抓取、参考图、生成、取消、落图、保存、历史和诊断导出。完成这些验证后，才能按 PRD 的退出门禁停止 Electron 新功能开发。

正式 Manifest 的 Provider 网络权限使用 `all`，用于用户自定义 HTTPS Base URL 和 loopback 本地服务。Host 会拒绝带凭据的 URL、非 loopback HTTP 和无效 Provider；WebView 权限仍只允许 `INNER_WEBUI_URL` 的精确 HTTPS Origin。该权限决策需要随每次 CCX 安全审查复核。

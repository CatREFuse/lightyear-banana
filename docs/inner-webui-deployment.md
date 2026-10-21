# Inner WebUI 与 CCX 部署指南

发布门禁以 `docs/build-todo-list.md` 为准。

Inner WebUI 与 CCX 独立发布。WebUI 使用 `0.2.5`，CCX 使用自身 Manifest 版本。

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

以 `utils/deploy/nginx/inner-webui.conf.template` 为模板替换以下值：

- `__SERVER_NAME__`
- `__TLS_CERTIFICATE__`
- `__TLS_CERTIFICATE_KEY__`
- `__INNER_WEBUI_ROOT__`
- `__RELEASES_ROOT__`

`__INNER_WEBUI_ROOT__` 必须与 `DEPLOY_WEB_ROOT` 相同，`__RELEASES_ROOT__` 必须与 `DEPLOY_RELEASES_ROOT` 相同。Nginx 的全局 `http` 配置必须加载标准 `mime.types`，确保 JavaScript 返回 JavaScript MIME、CSS 返回 `text/css`。`/releases/latest.json` 禁止缓存，版本化发行文件使用不可变缓存，点号开头的备份文件不会公开。启用配置后先执行 `nginx -t`，通过后再 reload，并通过 `nginx -T` 确认最终配置包含模板中的 CSP、HSTS 和 `nosniff` 响应头。WebUI 使用 Hash Router，浏览器路径固定在 `/webui/`。

浏览器版 iMini 通过同源 `/webui-api/imini/` 请求。Nginx 模板只允许 `GET` 和 `POST`，固定转发到 iMini 官方 Router，不转发 Cookie，不缓存响应。缺少该路由时，浏览器会因 iMini 官方接口未返回 CORS 许可头而显示 API 不可用。

部署账号只需要目标目录的写权限，不使用日常管理员账号。服务器需要提供 POSIX `sh`、`tar`、`grep`、`flock`、`sha256sum`、`readlink`、`ln` 和 GNU `cp`、`mv`。模板启用 HSTS；同一域名仍承载 HTTP 资源时，先完成全站 HTTPS 迁移再启用该配置。

## 构建与发布

```powershell
npm ci
npx playwright install chromium
npm run verify:inner-webui:release
npm run deploy:inner-webui -- --dry-run
npm run deploy:inner-webui
npm run verify:inner-webui:public
npm run package:ccx
```

`verify:inner-webui` 包含 iMini Provider 冒烟，校验 Bearer 鉴权、图片任务提交与查询、模型参数和多图片结果解析。

发布构建必须来自已提交的干净 Git 工作区。`release.json` 会记录提交、构建时间和内容哈希，部署脚本拒绝 `dirty` 构建。

部署脚本先复制稳定快照并逐文件校验上传内容，再按 WebUI 内容哈希创建不可变版本目录。服务器文件锁会串行激活，通过临时符号链接原子切换 `current`，并保留上一个目标为 `previous`。共享 `assets` 在验收期间保留新旧资源，验收成功后只保留当前快照拥有的资源，旧页面可能需要刷新。切换完成后，脚本会精确比对公网与本地 `release.json`、`compatibility.json`、入口 HTML 和入口资源字节，同时检查安全响应头与静态资源 MIME。公网校验失败时只会在 `current` 仍指向本次发布的情况下尝试恢复，避免回滚覆盖并发发布。

首次配置路由时可以先上传静态文件。该参数只允许服务器尚无 `current` 版本时使用：

```powershell
npm run deploy:inner-webui -- --skip-public-verify
```

Nginx 生效后必须重新执行不带跳过参数的正式部署，完成公网版本校验。

## 回滚

```powershell
npm run deploy:inner-webui -- --rollback
```

回滚会交换 `current` 与 `previous`，然后再次执行公网版本检查。恢复后的公网检查通过后自动删除非 current 目录及 previous 链接。成功发行后没有 previous；恢复旧版需从对应源码重新构建发布。

## 发布顺序

WebUI 与 CCX 使用独立发布链。WebUI 部署会校验公网文件与本次 WebUI 构建；CCX 打包不读取、不复制 `webui/dist/`，也不要求两者来自同一 Git 提交。CCX 校验会确认固定云端 URL、精确 WebView Origin、`localAndRemote` 消息桥、Host 协议标记，并拒绝归档中的 `webui/` 目录。最终产物为 `dist/mugen-$VERSION.ccx`，同目录的 `ccx-release.json` 和 SHA256 sidecar 用于发布追踪。

保持 `inner-host/v1` 兼容的 WebUI 可以独立部署。协议不兼容时，更新兼容元数据并发布对应 CCX，完成真实 Photoshop 握手和业务闭环后再切换云端 WebUI。

安装 CCX 后，在真实 Photoshop 中验证握手、画布抓取、参考图、生成、取消、落图、保存、历史和诊断导出。完成这些验证后，才能按 `docs/build-todo-list.md` 门禁进入正式发布。

正式 Manifest 的 Provider 网络权限使用 `all`，用于用户自定义 HTTPS Base URL 和 loopback 本地服务。Host 会拒绝带凭据的 URL、非 loopback HTTP 和无效 Provider；WebView 权限只允许 `INNER_WEBUI_URL` 的精确 HTTPS Origin，并使用 `localAndRemote` 消息桥。该权限决策需要随每次 CCX 安全审查复核。

## 服务器发行保留策略（2026-10-21）

- 官网和 WebUI 均只长期保留 `current` 指向的一份发行快照。上传、切换和公网校验期间保留旧版本以便失败恢复；校验成功后重新获取发布锁，确认 `current` 仍为已验证目标，再删除其他发行目录及 `previous` 链接。
- 官网不再复制整份旧安装包目录；只继承旧 `releases/latest.json` 及其引用的本地下载与 JSON 索引。当前官网 `download/` 随本次构建保留。缺失文件、路径穿越和软链接均中止处理，不能静默遗漏引用。
- WebUI 共享 `assets/` 只保留当前快照拥有的文件；旧页面可能需要刷新，HTTP/浏览器缓存响应头保持原样。
- 本次 incoming 上传包在确认安全后清除；不清理其他正在上传任务的目录，也不扫描业务数据目录。未完成公网验证、跳过验证、恢复失败或远端状态不明时不执行历史裁剪；恢复完成且公网校验通过后，使用同一规则只保留恢复后的 current。
- 清理失败会单独报错，不将它当作公网验证失败，也不回滚到可能已经删除的历史版本。所有删除目标在动手前完成边界和元数据检查；非预期目录导致停止。
- `previous` 只在尚未完成验收的发布事务中存在。成功发行后不再支持直接切回服务器历史副本；需要恢复旧版本时，从对应 Git 提交重新构建并正常发布。
- 远端依赖 Python 3.8+、现有 `flock`、GNU `sha256sum` 和原子重命名能力。公共实现为 `utils/deploy/release-retention.py` / `.mjs`，回归已纳入 `npm run test:release-policy`。

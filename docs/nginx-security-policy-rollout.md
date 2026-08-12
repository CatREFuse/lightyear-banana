# 生产 Nginx 安全策略切换

这次配置变更只允许修改目标 HTTPS `server` 中的两处响应头：

- `/webui/` 的 `connect-src` 从 `'none'` 改为 `'self' http: https:`，并把 `img-src` 从 `'self' data: blob:` 精确扩展为 `'self' data: blob: http: https:`。
- 官网入口使用严格 CSP，并返回 `Referrer-Policy: no-referrer`。

WebUI 目标值已经写入 `utils/deploy/nginx/inner-webui.conf.template`。官网目标 CSP 为：

```text
default-src 'self';
base-uri 'none';
object-src 'none';
script-src 'self';
style-src 'self';
img-src 'self' data:;
connect-src 'self';
font-src 'self';
frame-ancestors 'none';
form-action 'none';
```

## 准备候选配置

先把当前生效配置复制到本地文件，再制作候选文件。候选文件需要逐值保留首页位置当前有效的 HSTS、`X-Content-Type-Options` 和其他响应头。HSTS 的期限、`includeSubDomains` 和 `always` 参数都不能借这次授权改变。Nginx 的 `add_header` 继承会在位置内增加任意 `add_header` 后停止，因此当前继承的响应头需要在同一首页位置中显式保留。

本地执行差异门禁：

```powershell
node utils/nginx-security-policy.mjs `
  --current .tmp/nginx-active.conf `
  --candidate .tmp/nginx-candidate.conf `
  --server-name mugen.example.com `
  --origin https://mugen.example.com `
  --manifest .tmp/nginx-policy-approval.json
```

门禁要求目标域名只有一个 TLS `server`，并且只允许两处位置内的安全响应头变化。它会拒绝 root、alias、路由、证书、代理、缓存和其他服务器块的任何变化。输出中的两个 SHA256 用于锁定评审过的当前配置与候选配置。公网 origin 与 `serverName` 一起写入评审清单，后续读回不能改成其他 HTTPS 主机。

目标 `/` 与 `/webui/` 位置不得使用 `include`，并且必须各自显式定义有效响应头。HTTPS `server` 可以保留当前配置中未变化的 TLS `include`；这种情况下目标位置不能依赖 server 级响应头继承。应用前还会读取完整 `nginx -T` 输出并拒绝任何 `add_header_inherit`，避免外部 include 改写已评审的继承语义。

## 原子应用

在获得明确的生产配置变更授权后，使用评审清单运行完整编排：

```powershell
node utils/apply-nginx-security-policy.mjs `
  --apply `
  --manifest .tmp/nginx-policy-approval.json `
  --active-config /etc/nginx/conf.d/mugen.conf
```

`--active-config` 只接受 `/etc/nginx/conf.d`、`/etc/nginx/sites-available` 或 `/etc/nginx/sites-enabled` 下的直属 `.conf` 物理文件。符号链接、目录跳转、宽路径和非 root 文件都会在上传前被拒绝。生产服务器当前使用 `/etc/nginx/sites-enabled/mugen.catrefuse.com.conf` 这一物理文件。

编排器只使用 `key.env` 中的部署主机和域名，并固定使用 SSH BatchMode 公钥认证。它先记录变更前 `/` 与 `/webui/` 的公网安全头快照，再上传候选文件和事务脚本。事务脚本会拒绝摘要漂移、非 root 文件、宽目录目标和并发执行。它先在原配置旁创建权限受限的备份，紧邻原子换入前再次校验 active 与 candidate 摘要，然后运行 `nginx -t` 和 reload。

编排器随后从评审清单固定的 origin 读回两条路径。目标策略读回失败时，它会自动把备份作为反向事务候选，恢复原属主与原权限，运行 `nginx -t` 和 reload，并再次确认变更前的公网安全头快照。恢复或旧策略读回失败时流程会以严重错误停止，不能继续站点或 WebUI 激活。

成功输出会保留备份路径，供紧急人工回滚。人工回滚仍使用同一底层事务脚本，并交换两个评审摘要：

```sh
sudo sh apply-verified-config.sh \
  /etc/nginx/conf.d/mugen.conf \
  /etc/nginx/conf.d/mugen.conf.mugen-policy-TRANSACTION-HASH.bak \
  CANDIDATE_SHA256 \
  ACTIVE_SHA256 \
  NEW_24_HEX_TRANSACTION_ID
```

## 公网读回门禁

配置 reload 成功后，先读回首页响应头，再运行现有的逐字节发布校验：

```powershell
node utils/nginx-security-policy.mjs `
  --verify-public `
  --manifest .tmp/nginx-policy-approval.json
npm run verify:inner-webui:public
```

首页必须返回文档中的完整 CSP、`Referrer-Policy: no-referrer`、HSTS 和 `X-Content-Type-Options: nosniff`。WebUI 校验会检查完整 CSP，其中 `connect-src` 必须精确为 `'self' http: https:`。完整编排已经把该读回放在自动恢复边界内；这条独立命令用于再次验收。官网正式部署的公网门禁还会逐字节核对首页。下一次官网发布前仍要先运行 `npm run deploy:site -- --dry-run`。

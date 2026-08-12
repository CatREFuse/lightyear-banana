# Mugen 单屏官网部署

官网使用不可变站点快照发布，生效点由 `current` 符号链接单独原子切换。远端布局固定为：

```text
/etc/nginx/static/mugen-site/
├── releases/<site-id>/
├── current -> releases/<active-site-id>
└── previous -> releases/<previous-site-id>
```

Nginx 从 `current` 提供首页，并把 `/releases/` 映射到 `current/releases/`。每次新站部署会复制当前快照中的整个 `releases/`，逐文件校验后再合入站点文件。仓库构建中的 `dist/site/releases/latest.json` 不会打包、上传或激活。完整四件套发行门禁未通过时，线上 `latest.json` 会保持原字节内容。

## 环境

`AGENTS.md` 中的部署参数是入口契约，脚本按下表读取 `key.env`：

| `AGENTS.md` 参数 | 脚本映射 |
| --- | --- |
| `server_ip` | SSH 主机；兼容已有 `DEPLOY_SSH_HOST`，两者同时出现时必须一致 |
| `password` | 明确拒绝；脚本仅支持 SSH 公钥或 agent，不读取、打印或传递密码 |
| `domain` | 官网公网域名；兼容已有 `SITE_PUBLIC_URL` 和由 `INNER_RELEASE_URL` 推导 |
| `secondary_domain` | 记录备用域名，本脚本不把它作为发布或验收入口 |

已有环境还可提供 `DEPLOY_SSH_USER`（可选）、`DEPLOY_SSH_PORT`（默认 `22`）和 `DEPLOY_SSH_IDENTITY_FILE`（可选）。`DEPLOY_SSH_PASSWORD`、`PASSWORD` 或 `password` 只要包含非空值，脚本就会在创建任何 SSH 命令前停止，并且错误信息不会包含密码内容。

SSH 固定使用 `BatchMode` 和公钥认证。密钥可由系统 SSH agent、SSH 配置或 `DEPLOY_SSH_IDENTITY_FILE` 提供。脚本不调用交互式认证工具，也不接受凭据命令行参数。

远端契约是 GNU/Linux，不是任意 POSIX 主机。服务器需要提供 `sh`、GNU `tar`、GNU coreutils（含 `cp`、`mv`、`ln`、`sha256sum`、`realpath`）、`scp`、util-linux `flock`、`find`、`sort` 和 `readlink`。部署账号需要 `/etc/nginx/static/mugen-site` 的读写权限。

公网校验要求首页返回 `Referrer-Policy: no-referrer`，并包含以下精确 CSP 指令：

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

首页与 `releases/latest.json` 还必须返回有效的正数 `max-age` HSTS 和 `X-Content-Type-Options: nosniff`。CCX 使用受支持的二进制 MIME，`SHA256SUMS.txt` 使用 `text/plain`，两者也必须返回 HSTS 和 `nosniff`。`releases/latest.json` 必须使用 JSON MIME、HSTS、`nosniff` 和 `Cache-Control: no-store`。回滚时生成的唯一 `site-rollback-*.latest.json` 证明必须使用 JSON MIME、HSTS、`nosniff`，并使用 `no-store` 或 `no-cache`，同时拒绝 `public`、`immutable` 与持久缓存时长。部署脚本只验证这些响应头，不修改 Nginx 配置。

## 本地检查

先构建站点，再运行定向测试和只读 dry-run：

```powershell
npm run build:site
npm run test:site-deploy
npm run deploy:site -- --dry-run --include-ccx
```

`test:site-deploy` 包含会实际执行生成命令的状态转换与失败注入测试。Windows 使用 Git Bash、临时目录、测试专用 `flock` 和目录链接兼容层执行。`.github/workflows/site-deploy-linux.yml` 提供只读、无 secrets、仅手动触发的 `ubuntu-24.04` 门禁；获准生产发布前，必须在该工作流或另一隔离 GNU/Linux 环境运行 `REQUIRE_SITE_LINUX_TESTS=1 npm run test:site-deploy`，以原生远端工具完成强制复验。

`--include-ccx` 从 `plugin/manifest.json` 和 `dist/ccx-release.json` 读取当前 CCX 版本；两者必须一致。站点文件固定为 `dist/site/releases/<ccx-version>/mugen-<ccx-version>.ccx`。脚本会把它与根目录 CCX、根 SHA sidecar、CCX 发布元数据和站点 `SHA256SUMS.txt` 交叉校验。此选项不会改变 `latest.json`。

`build:site` 会生成 `site-release.json` 和 `site-manifest.json`。前者记录当前完整 Git SHA、dirty 状态、构建时间、全站内容哈希和 build ID；后者列出每个可部署静态文件的路径、大小与 SHA256。部署只接受干净工作树、`dirty: false`、与当前 `HEAD` 一致的构建，并重新计算全站内容哈希和清单。

## 发布

```powershell
npm run deploy:site -- --include-ccx
```

脚本按以下顺序执行：

1. 校验 `site-release.json`、`site-manifest.json`、当前 Git `HEAD` 和干净工作树，再从 `dist/site` 创建稳定快照。快照排除整个本地 `releases/`，拒绝任何 `site-rollback-*` 运行时证明，并为每个文件生成 SHA256。归档完成后和首次上传前都会重新读取 Git 与全站清单；期间发生变化就停止。
2. 在旧 `current` 写入本次唯一的只读回滚清单，清单覆盖 `releases/` 之外的每个静态资产；从公网逐项读回后才继续。旧站没有发布 marker 时也可形成完整回滚证据。
3. 使用 `tar` 生成本地归档，通过 `scp` 上传到唯一 incoming 目录。
4. 在 `flock` 内确认 `current` 未被并发部署切换，解包到唯一 stage 并校验所有站点文件。
5. 复制旧 `current/releases/` 并逐文件校验，确认 `latest.json` SHA256 保持不变。
6. 可选合入当前 Manifest 与 CCX 发布元数据共同声明的 CCX 及对应 `SHA256SUMS.txt`，再次校验完整 stage。
7. 在同一文件系统把 stage 移入 `releases/<site-id>`。prepare 会先记录发布前的 `previous` 目标或其不存在状态；activation 在切换前再次确认该状态未变，先更新 `previous`，最后用单次 `mv -T` 原子切换 `current`。
8. 从公网逐字节读回全部站点文件、`latest.json`、可选 CCX 和 checksum，同时检查 MIME 与安全响应头。

公网校验失败时，脚本只会在 `current` 仍指向本次发布且 `previous` 仍指向原版本时回滚。并发发布已经取代本次发布时，条件回滚会停止，避免覆盖更新。

激活命令或回滚命令已经完成远端切换，但 SSH 确认丢失或输出不完整时，脚本不会直接清理或宣称失败。它会使用本次唯一 `site-id`、token、marker 和 latest proof 在同一把锁内重查 `current`、`previous`、全资产清单与 `latest.json`。确认已经切换后继续完整公网验收；确认尚未切换后才允许清理本次 incoming 和 marker；无法确定时以 `REMOTE_STATE_UNCERTAIN` 停止，并保留远端证据供人工核查。

激活或回滚在两个链接之间收到 HUP、INT 或 TERM 时，信号处理会立即停止后续切换并按实际链接状态补偿。`current` 尚未切换时，`previous` 恢复为 prepare 记录的原目标或恢复为不存在；`current` 已切换且链接对完整时，回滚清单与 latest proof 会保留，供状态重查和公网验收使用。无法证明属于这两种状态时不删除证据，并按不确定状态退出。

## 手动回滚

```powershell
npm run deploy:site -- --rollback
```

回滚先在锁内记录并验证预期 `current`、`previous` 与相同的 `releases/latest.json` SHA256，生成或复用恢复版本的唯一全站清单，并在切换前校验清单中的每个静态资产。脚本先更新 `previous`，最后用单次重命名原子切换公网使用的 `current`；如果最后一次重命名失败，会在退出前把 `previous` 补偿恢复为原回滚目标，使状态仍可重试。两个链接不宣称成对原子交换。公网会逐字节读回清单、其中每个静态资产、活动 `latest.json` 和唯一 latest 证明，并校验 SHA256、MIME、HSTS、`nosniff` 与受约束缓存策略。历史快照不会自动删除。

# Mugen 单屏官网部署

官网使用不可变站点快照发布，生效点由 `current` 符号链接单独原子切换。远端布局固定为：

```text
/etc/nginx/static/mugen-site/
├── releases/<site-id>/
├── current -> releases/<active-site-id>
└── previous -> releases/<previous-site-id>
```

Nginx 从 `current` 提供首页。当前 CCX 固定放在 `current/download/mugen-<version>-<build>.ccx`，与 HTML、JavaScript 和图片一起进入站点清单、内容哈希、原子切换和回滚。首页不读取版本清单，`releases/latest.json` 已退出构建与用户下载链。部署器在迁移期仍会原字节保留旧快照中的 `releases/`，只用于既有回滚兼容，不作为当前版本来源。

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

首页与 `download/` CCX 必须返回有效的正数 `max-age` HSTS 和 `X-Content-Type-Options: nosniff`。CCX 使用受支持的二进制 MIME。迁移期回滚仍会校验旧快照的发布证明，但新首页、构建和下载入口不消费该证明。部署脚本只验证响应头，不修改 Nginx 配置。

## CCX 官方发布 SOP

CCX 必须随官网不可变快照发布。`npm run package:ccx` 只生成本地产物，官网切换完成并且公网 CCX 的完整字节与 SHA256 验证通过后，才能记录为正式发布。

### 1. 打包 CCX

运行 `npm run bump:ccx-build`，确认 `plug-in/package.json#buildNumber` 按 Asia/Shanghai 日期使用 `YYMMDDnnnn` 并提交。每次正式构建都必须生成新的 build 号，语义版本不变时也不得复用旧 build。

从已提交的干净工作树执行：

```bash
TMPDIR=/private/tmp npm run package:ccx
```

核对 `plug-in/manifest.json`、`dist/ccx-host/manifest.json`、`dist/ccx-release.json` 和 `dist/mugen-<version>.ccx` 的版本一致，`.sha256` 与实际文件一致，`dist/ccx-release.json` 为 `dirty: false`。

### 2. 更新官网发行信息

使用 `dist/ccx-release.json` 和实际 CCX 文件更新以下字段：

- `homesite/site/index.html`：下载 URL 与 CCX 标本号。
- `homesite/site/llms.txt`：版本、打包时间、下载 URL、SHA256 和文件大小。
- `homesite/site/LLM.TXT`：内容与 `llms.txt` 保持一致。

提交发行信息后，从干净工作树生成官网快照：

```bash
npm run build:site
npm run deploy:site -- --dry-run
```

`dist/site/download/mugen-<version>.ccx` 必须与 `dist/mugen-<version>.ccx` 逐字节一致，`dist/site/site-release.json` 必须绑定当前 Git HEAD。

### 3. 连接生产服务器

生产部署脚本只接受 SSH 公钥。`key.env` 已配置可用公钥时，直接进入下一步。

只有服务器名称和密码时，使用 `$ssh-skill` 中的服务器别名进行密码登录，为本次发行添加一把临时公钥；不要把密码传给部署脚本，也不要把密码或私钥写入仓库。临时公钥添加成功后，创建不含密码的临时部署环境文件，设置 `DEPLOY_SSH_HOST`、`DEPLOY_SSH_USER`、`DEPLOY_SSH_PORT`、`DEPLOY_SSH_IDENTITY_FILE`、`server_ip` 和 `domain`。

### 4. 发布官网与 CCX

已有公钥配置时执行：

```bash
npm run deploy:site
```

使用临时部署环境文件时执行：

```bash
npm run deploy:site -- --env=/private/tmp/<release-runtime>/deploy.env
```

部署器会生成唯一站点快照，上传并校验全部文件，原子切换 `current`，然后从公网逐文件读回。输出 `Official site <site-id> verified` 才表示站点部署流程完成。

### 5. 公网验收

```bash
curl -fsSL https://mugen.catrefuse.com/ --output /private/tmp/mugen-home.html
curl -fsSL -D /private/tmp/mugen-ccx.headers \
  https://mugen.catrefuse.com/download/mugen-<version>-<build>.ccx \
  --output /private/tmp/mugen-<version>-<build>.ccx
shasum -a 256 dist/mugen-<version>-<build>.ccx /private/tmp/mugen-<version>-<build>.ccx
```

验收结果必须满足：

- 官网首页显示本次标本号，下载链接指向本次版本。
- 本地与公网 CCX 的文件大小和 SHA256 完全一致。
- CCX 返回 HTTP `200`、`application/octet-stream`、HSTS 和 `X-Content-Type-Options: nosniff`。

使用临时公钥时，公网验收通过后立即通过 `$ssh-skill` 从 root 的 `~/.ssh/authorized_keys` 删除该公钥并读回确认，再删除本机临时私钥、临时部署环境文件和隔离运行环境。

## 本地检查

发布新版 CCX 时，先从干净提交生成 `dist/mugen-<version>-<build>.ccx`、`.sha256` 和 `dist/ccx-release.json`，再把 `homesite/site/index.html`、`homesite/site/llms.txt`、`homesite/site/LLM.TXT` 中的下载 URL、标本号、build 号、打包时间、文件大小和 SHA256 更新为这份发行元数据。任何字段仍属于旧构建时，站点构建必须失败。

完成发行信息更新后构建站点，再运行定向测试和只读 dry-run：

```powershell
npm run build:site
npm run test:site-deploy
npm run deploy:site -- --dry-run
```

`test:site-deploy` 包含状态转换与失败注入测试。日常发行使用当前开发环境完成构建和 dry-run；无需额外启动 Docker 或触发 Linux CI。服务器仍需满足上文列出的 GNU/Linux 远端契约。

`build:site` 从 `plug-in/manifest.json`、`plug-in/package.json` 和 `dist/ccx-release.json` 读取当前 CCX 版本与 build 号；三者必须一致。站点文件固定为 `dist/site/download/mugen-<ccx-version>-<build>.ccx`，其字节、大小与 SHA256 必须和根目录打包产物一致。`--include-ccx` 属于旧发布树兼容参数，新标准不使用。

`build:site` 会生成 `site-release.json` 和 `site-manifest.json`。前者记录当前完整 Git SHA、dirty 状态、构建时间、全站内容哈希和 build ID；后者列出每个可部署静态文件的路径、大小与 SHA256。部署只接受干净工作树、`dirty: false`、与当前 `HEAD` 一致的构建，并重新计算全站内容哈希和清单。

## 发布

```powershell
npm run deploy:site
```

脚本按以下顺序执行：

1. 校验 `site-release.json`、`site-manifest.json`、当前 Git `HEAD` 和干净工作树，再从 `dist/site` 创建稳定快照。快照必须包含且只包含一个 `download/mugen-<version>.ccx`，拒绝本地 `releases/` 和任何 `site-rollback-*` 运行时证明，并为每个文件生成 SHA256。归档完成后和首次上传前都会重新读取 Git 与全站清单；期间发生变化就停止。
2. 在旧 `current` 写入本次唯一的只读回滚清单，从公网逐项读回后才继续。旧站没有发布 marker 时也可形成完整回滚证据。
3. 使用 `tar` 生成本地归档，通过 `scp` 上传到唯一 incoming 目录。
4. 在 `flock` 内确认 `current` 未被并发部署切换，解包到唯一 stage 并校验所有站点文件。
5. 迁移期原字节复制旧快照中的 `releases/` 兼容数据，不把它合入新站内容哈希或下载入口。
6. 校验 stage 中 `download/` CCX 与全站清单一致。
7. 在同一文件系统把 stage 移入 `releases/<site-id>`。prepare 会先记录发布前的 `previous` 目标或其不存在状态；activation 在切换前再次确认该状态未变，先更新 `previous`，最后用单次 `mv -T` 原子切换 `current`。
8. 从公网逐字节读回全部站点文件和 `download/` CCX，同时检查 MIME 与安全响应头；迁移期额外确认旧回滚证明未被修改。

公网校验失败时，脚本只会在 `current` 仍指向本次发布且 `previous` 仍指向原版本时回滚。并发发布已经取代本次发布时，条件回滚会停止，避免覆盖更新。

激活命令或回滚命令已经完成远端切换，但 SSH 确认丢失或输出不完整时，脚本不会直接清理或宣称失败。它会使用本次唯一 `site-id`、token、marker 和 latest proof 在同一把锁内重查 `current`、`previous`、全资产清单与 `latest.json`。确认已经切换后继续完整公网验收；确认尚未切换后才允许清理本次 incoming 和 marker；无法确定时以 `REMOTE_STATE_UNCERTAIN` 停止，并保留远端证据供人工核查。

激活或回滚在两个链接之间收到 HUP、INT 或 TERM 时，信号处理会立即停止后续切换并按实际链接状态补偿。`current` 尚未切换时，`previous` 恢复为 prepare 记录的原目标或恢复为不存在；`current` 已切换且链接对完整时，回滚清单与 latest proof 会保留，供状态重查和公网验收使用。无法证明属于这两种状态时不删除证据，并按不确定状态退出。

## 手动回滚

```powershell
npm run deploy:site -- --rollback
```

回滚先在锁内记录并验证预期 `current`、`previous` 与相同的 `releases/latest.json` SHA256，生成或复用恢复版本的唯一全站清单，并在切换前校验清单中的每个静态资产。脚本先更新 `previous`，最后用单次重命名原子切换公网使用的 `current`；如果最后一次重命名失败，会在退出前把 `previous` 补偿恢复为原回滚目标，使状态仍可重试。两个链接不宣称成对原子交换。公网会逐字节读回清单、其中每个静态资产、活动 `latest.json` 和唯一 latest 证明，并校验 SHA256、MIME、HSTS、`nosniff` 与受约束缓存策略。历史快照不会自动删除。

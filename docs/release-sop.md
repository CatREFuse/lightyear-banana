# Mugen 官方发行 SOP

本流程用于将 WebUI、Photoshop CCX 和单屏官网发布到正式地址。`npm run package:ccx` 只生成本地 CCX 发行物；只有官网部署完成且公网下载文件逐字节回读通过，CCX 才算正式发布。

CCX 的运维执行步骤、密码登录时的临时公钥流程和公网验收命令同时收录在 `docs/site-deployment.md` 的“CCX 官方发布 SOP”。

## 发行范围

- WebUI 正式入口：`https://mugen.catrefuse.com/webui/`
- WebUI 测试入口：`https://imini-test.catrefuse.com/`
- CCX：`https://mugen.catrefuse.com/download/mugen-<version>-<build>.ccx`
- 官网：`https://mugen.catrefuse.com/`

WebUI 与 CCX 独立构建，CCX 固定加载云端 WebUI。一次同时包含 WebUI 和 CCX 改动的发行必须完成两条部署链，并由官网快照分发本次版本化 CCX。

## 发行前提

- 版本号、build 号、协议兼容信息、Spec 和 `docs/build-todo-list.md` 已同步。
- 代码与官网发行元数据均已提交，工作树干净。
- `key.env` 提供正式 URL、部署目录和 SSH 公钥身份；密码字段必须为空，部署脚本不接受密码认证。
- macOS 使用规范物理临时目录：`TMPDIR=/private/tmp`。
- Windows 资源管理器双击安装和真实 Photoshop 业务闭环已形成验收证据；未完成时必须在发行报告中明确标注。

## 1. WebUI 正式发布

```bash
TMPDIR=/private/tmp npm run verify:inner-webui:release
npm run deploy:inner-webui -- --dry-run
npm run deploy:inner-webui
npm run verify:inner-webui:public
```

正式部署必须完成不可变快照上传、原子切换和公网逐字节回读。dry-run、构建成功或本地预览均不能替代正式部署结果。

## 2. CCX 正式打包

每次正式构建都更新并提交 build 号；同一天自动递增 `nnnn`，跨天从 `0001` 开始：

```bash
npm run bump:ccx-build
```

本次 build 号提交且工作树恢复干净后执行：

```bash
TMPDIR=/private/tmp npm run package:ccx
```

核对以下内容：

- `plug-in/manifest.json`、`plug-in/package.json`、`dist/ccx-host/manifest.json`、`dist/ccx-host/ccx-build.json` 和 `dist/ccx-release.json` 的版本与 build 号一致。
- `dist/mugen-<version>-<build>.ccx` 与 `.sha256` 一致。
- `dist/ccx-release.json` 为 `dirty: false`，`sourceCommit` 指向本次 CCX 代码提交。
- 归档只包含 CCX Host 资源，不包含 `webui/` 静态文件。

## 3. 官网发行元数据与快照

将实际 `dist/ccx-release.json` 的版本、文件名、打包时间、大小和 SHA256 写入以下文件：

- `homesite/site/index.html`
- `homesite/site/llms.txt`
- `homesite/site/LLM.TXT`

提交这三份元数据后，从干净工作树构建官网：

```bash
TMPDIR=/private/tmp npm run build:site
npm run deploy:site -- --dry-run
```

`dist/site/download/mugen-<version>-<build>.ccx` 的字节、大小和 SHA256 必须与根目录 CCX 产物一致；`site-release.json` 必须绑定当前干净提交。

## 4. 官网与 CCX 正式发布

```bash
npm run deploy:site
```

该命令把完整官网和版本化 CCX 放入同一不可变站点快照，完成远端清单校验、原子切换、公网逐文件回读和安全响应头检查。不得单独上传 CCX、手工替换官网文件或在公网校验失败后宣称发布完成。

## 5. 公网验收

```bash
npm run verify:inner-webui:public
curl -fsSL https://mugen.catrefuse.com/download/mugen-<version>-<build>.ccx --output /private/tmp/mugen-<version>-<build>.ccx
shasum -a 256 /private/tmp/mugen-<version>-<build>.ccx
```

最终证据必须同时包含：

- 官网首页返回本次 CCX 标本号，下载按钮指向本次版本化文件。
- 公网 CCX 返回成功状态、受支持的二进制 MIME、HSTS 与 `nosniff`。
- 公网 CCX 的完整字节数和 SHA256 与 `dist/ccx-release.json` 一致。
- WebUI 的 `release.json`、`compatibility.json`、入口 HTML 和入口资源与本次部署一致。
- Git 工作树保持干净，发行提交和官网元数据提交可追溯。

## 失败与回滚

任何部署门禁失败都应停止后续步骤并保留必要的恢复材料。尚未完成验收且 previous 存在时，可使用现有事务命令：

```bash
npm run deploy:inner-webui -- --rollback
npm run deploy:site -- --rollback
```

发行报告必须分别说明本地构建、WebUI 部署、CCX 官网部署和公网回读状态。缺少任一正式部署或公网证据时，状态只能记录为待发布或发布受阻。

## 服务器发行保留策略（2026-10-21）

- 官网和 WebUI 均只长期保留 `current` 指向的一份发行快照。上传、切换和公网校验期间保留旧版本以便失败恢复；校验成功后重新获取发布锁，确认 `current` 仍为已验证目标，再删除其他发行目录及 `previous` 链接。
- 官网不再复制整份旧安装包目录；只继承旧 `releases/latest.json` 及其引用的本地下载与 JSON 索引。当前官网 `download/` 随本次构建保留。缺失文件、路径穿越和软链接均中止处理，不能静默遗漏引用。
- WebUI 共享 `assets/` 只保留当前快照拥有的文件；旧页面可能需要刷新，HTTP/浏览器缓存响应头保持原样。
- 本次 incoming 上传包在确认安全后清除；不清理其他正在上传任务的目录，也不扫描业务数据目录。未完成公网验证、跳过验证、恢复失败或远端状态不明时不执行历史裁剪；恢复完成且公网校验通过后，使用同一规则只保留恢复后的 current。
- 清理失败会单独报错，不将它当作公网验证失败，也不回滚到可能已经删除的历史版本。所有删除目标在动手前完成边界和元数据检查；非预期目录导致停止。
- `previous` 只在尚未完成验收的发布事务中存在。成功发行后不再支持直接切回服务器历史副本；需要恢复旧版本时，从对应 Git 提交重新构建并正常发布。
- 远端依赖 Python 3.8+、现有 `flock`、GNU `sha256sum` 和原子重命名能力。公共实现为 `utils/deploy/release-retention.py` / `.mjs`，回归已纳入 `npm run test:release-policy`。

# Mugen WIP 源码交接 · 2026-11-04

此分支 `codex/handoff-mugen-wip-20261104` 保存源 main 工作区的未提交开发快照，未验证、未构建、未发布。它从 `4acadab00dbb3be40534788ff7fff8391d78d162` 创建，没有把这些改动合并到生产分支。不要把本分支的版本号或默认代码当作最新生产基线。

正式生产代码与交接文档位于：https://github.com/CatREFuse/lightyear-banana/tree/codex/handoff-mugen-20261104 ，交接 HEAD `e1e8a7ad36b40426e7f8232235986f928bf0d280`，正式 CCX 为 `1.2.6+2611030002`，工作台为 https://mugen.catrefuse.com/webui/ 。

## 保存范围

按明确文件清单保存 50 个已跟踪文件的改动/删除，以及 9 个新增源码/测试文件。复制后对每个文件的字节 SHA256 与源工作区比对一致；额外新增本交接文档，并在 AGENTS.md 增加文档索引。没有运行功能测试、构建或部署，也没有为了交接改动功能实现。

主要内容：官网 WGSL/WebGPU 背景与旧 Three.js 文件删除；WebUI 设置、输入与比例选择、预览及交互审计；配置测试、存储/资产/Provider 与协议调整；部署保留实现和对应测试。其完成度、需求正确性、依赖兼容性与生产适用性均待后续审查。

新保存的文件：

- `homesite/site/prism.wgsl`
- `plug-in/src/ccx/inner/providerRuntime.configTest.test.ts`
- `utils/deploy/release-retention.mjs`
- `utils/deploy/release-retention.py`
- `utils/deploy/release-retention.test.mjs`
- `webui/e2e/controls-audit.spec.ts`
- `webui/e2e/preview-audit.spec.ts`
- `webui/e2e/settings-audit.spec.ts`
- `webui/src/composables/useInnerMugen.settings.test.ts`

## 排除项

- `key.env`、SSH 私钥、证书私钥与其他凭证：不进入此 Git 分支。部署凭证通过单独的接收方公钥加密包交接，密文也不上传 GitHub。
- `.agents/` 与 `skills-lock.json`：外部技能/工具安装配置，未确认属于产品构建必需内容，排除完整目录及锁文件。
- `output/`：未审定的审计输出/生成产物，未确认工程必需性，排除完整目录。
- `.git`、node_modules、dist、缓存、输出媒体与全局配置：不在源码清单中，未打包或提交。

提交前对明确选定文件检查私钥格式、常见服务 Token/API Key 模式及凭证字面量；自动命中的字面量仅位于 Mock、单元测试和 E2E 夹具，已核查其测试上下文。没有复制原项目配置密码、任何私钥或运行日志。此项是交接秘密检查，不是功能验收或完整安全审计。

## 接手方式

独立克隆或单独 worktree 获取本分支，避免覆盖生产工作树：

```sh
git clone --branch codex/handoff-mugen-wip-20261104 https://github.com/CatREFuse/lightyear-banana.git mugen-wip
```

按模块查看差异并决定后续保留方式。生产与 WIP 存在历史差异，部分部署保留逻辑已在生产分支独立实现，不能整批覆盖、直接合并 main 或将整个 WIP 分支部署上线。源端原工作区与索引保持原状。

## 源端原始状态清单

```text
 M AGENTS.md
 M docs/inner-webui-deployment.md
 M docs/inner-webui-prd.md
 M docs/mugen-interaction-spec.md
 M docs/ref/ccx-inner-webui-cookbook.md
 M docs/release-sop.md
 M docs/site-deployment.md
 M docs/spec.md
 M homesite/package.json
 M homesite/scripts/build-site.mjs
 M homesite/scripts/deploy-site.mjs
 M homesite/scripts/deploy-site.test.mjs
 D homesite/scripts/prism-optics.test.mjs
 M homesite/scripts/prism-scene.test.mjs
 M homesite/scripts/site-app.test.mjs
 M homesite/site/app.js
 M homesite/site/index.html
 D homesite/site/prism-optics.js
 M homesite/site/prism-scene.js
 M homesite/site/styles.css
 D homesite/site/vendor/RoomEnvironment.js
 D homesite/site/vendor/THREE-LICENSE.txt
 D homesite/site/vendor/three.core.min.js
 D homesite/site/vendor/three.module.min.js
 M package-lock.json
 M package.json
 M packages/inner-protocol/src/index.test.ts
 M packages/inner-protocol/src/index.ts
 M plug-in/src/ccx/inner/assetStore.test.ts
 M plug-in/src/ccx/inner/assetStore.ts
 M plug-in/src/ccx/inner/commandRegistry.ts
 M plug-in/src/ccx/inner/providerRuntime.ts
 M plug-in/src/ccx/inner/storage.test.ts
 M plug-in/src/ccx/inner/storage.ts
 M utils/deploy-inner-webui.mjs
 M webui/e2e/hostFixture.ts
 M webui/e2e/standalone.spec.ts
 M webui/e2e/workspace.spec.ts
 M webui/src/components/mugen/ConfigEditorForm.vue
 M webui/src/components/mugen/MessageThread.vue
 M webui/src/components/mugen/MugenPanel.vue
 M webui/src/components/mugen/RatioPicker.vue
 M webui/src/composables/useInnerMugen.ts
 M webui/src/composables/useMugen.ts
 M webui/src/host/mockHost.fixture.ts
 M webui/src/host/webviewHost.test.ts
 M webui/src/host/webviewHost.ts
 M webui/src/stores/workspace.test.ts
 M webui/src/stores/workspace.ts
 M webui/src/types/mugenController.ts
?? .agents/
?? homesite/site/prism.wgsl
?? output/
?? plug-in/src/ccx/inner/providerRuntime.configTest.test.ts
?? skills-lock.json
?? utils/deploy/release-retention.mjs
?? utils/deploy/release-retention.py
?? utils/deploy/release-retention.test.mjs
?? webui/e2e/controls-audit.spec.ts
?? webui/e2e/preview-audit.spec.ts
?? webui/e2e/settings-audit.spec.ts
?? webui/src/composables/useInnerMugen.settings.test.ts
```

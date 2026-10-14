# 自定义模型与配置保存发行记录

- 基线：线上 CCX 1.2.4，提交 `67f50bb`（含线上提交 `8c00a6e`）；原工作区不参与打包。
- 目标：WebUI 0.2.6；CCX 1.2.5+2610140001；协议 inner-host/v1 不变。
- 自定义模型开放数量选择，数量参数拒绝时逐张补发；未验证或检测失败的 API Key 允许保存，失败保留草稿。
- 适配现有历史记录存储，保存配置不会清空历史，草稿编辑不会提前覆盖已有配置；设置页复用现有 toast。
- Photoshop 稳定读取、置入及内部压缩实现保持线上基线。
- 发布回归：协议 18、WebUI 27 + 4 隔离检查、共享核心 73、CCX Host 107、Mock API 6 均通过；66 个浏览器用例通过（64 首轮通过，2 个版本文案断言同步后复测通过），含 APIMart 网络闭环与 280/960 视口。发行策略与官网构建通过；macOS 不适用的 8 项平台测试按既有条件跳过。
- Ego Lite：最终生产构建验证未测试 Key 保存及刷新恢复、存储拒绝时草稿保留与已保存值不变；280px 无横向溢出，设置页成功/失败 toast 均可见。正式官网 390px / 1280px 视觉检查通过。
- WebUI 已部署：`0.2.6-1be424d45523`，来源 `94935baf733b7a6ce9b64956272c41863b3371f5`，dirty=false；`https://imini-test.catrefuse.com/` 的部署校验通过，`https://mugen.catrefuse.com/webui/` 入口、release、compatibility、JS/CSS 独立逐字节回读通过。
- CCX：`imini-ps-1.2.5-2610140001.ccx`，62590 字节，SHA256 `87e310988acffae8c27079131ab2f63e95485c90ab6248f7fbac8af02d00622e`，来源 `94935ba`，dirty=false；Host 16 个构建资源与归档校验通过，包内不含 WebUI。
- 官网已部署：元数据提交 `637f17b`，快照 `20261014T045915Z-6bf3f330c475-96d7c34c`，16 个公网文件验证通过。独立下载 CCX 哈希、62590 字节、HTTP 200、application/octet-stream、HSTS 与 nosniff 均一致。
- 发布临时 SSH 公钥已撤销，远端匹配数 0；本机临时私钥和部署配置已删除。原工作区未提交改动保持原状。
- 本次未完成 Windows 双击安装与真实 Photoshop 业务闭环；自动测试不能替代实机验收。

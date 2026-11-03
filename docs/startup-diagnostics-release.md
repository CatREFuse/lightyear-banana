# 启动诊断与重试隔离发行记录

- 基线：已发布 CCX 1.2.5 的发行分支，含提交 637f17b、3211d13 与发行保留实现 0baffa4；原工作区的未提交改动不参与构建。
- 版本：CCX 1.2.6+2611030001，协议 inner-host/v1 不变，插件工作台继续使用 https://imini-test.catrefuse.com/。
- 修复：重试创建独立 WebView，移除旧监听器和两类计时器，拒绝旧实例消息，Host await 返回后丢弃旧握手结果；定时器在导航/ready 发送前注册。
- 日志：按 session/attempt 关联监听器、导航、原生错误码、桥发送/接收、来源拒绝原因、超时阶段和重试清理；记录插件、Photoshop 与 UXP 版本，桥日志不记录完整业务载荷。
- 范围：保留现有 Photoshop 稳定读写、内部缩略图与压缩、自定义模型及配置保存行为；WebUI 维持线上 0.2.6，本次不部署 WebUI。
- 原始现场 JSONL 未获得，尚未确定用户首次超时根因。origin 末尾斜杠已在源码与测试中排除；不将域名、代理或页面脚本异常推断为根因。
- 自动验证：Host 113、协议 19、WebUI 29 + 4 策略检查、共享核心 73、Mock API 6 均通过；完整 package:ccx（发行策略、站点部署测试、类型检查、Host 构建及归档检查）通过，平台不适用项按原规则跳过。
- 本地 CCX：`imini-ps-1.2.6-2611030001.ccx`，63096 字节，SHA256 `7f5c4105d27da25d3a2118c609fb05c0305ca96b2604aed0cc2212d3db382046`，来源 `e266f86bc903fe0e8e66805621f8449db8af0ce6`，dirty=false。
- Windows 双击安装及真实 Photoshop 业务闭环尚未验证；本机 Photoshop 应用启动调用超时，自动测试不能替代实机验收。

- 首次部署未切换：旧 latest.json 中同一下载同时含 filename 与版本目录 URL，保留工具误把 filename 当作根目录独立引用。实际历史文件存在；已通过失败测试复现，修正为有 url 时以 URL 路径为准。独立 filename、路径穿越和真实缺失引用仍校验。保留模块 18 项测试通过，未修改旧清单或补造文件。

- 官网与 CCX 已正式部署：快照 `20261103T154214Z-50624f57c86f-9f6814c1`，官网来源 `4af8d57f15f8be3ef0d68782a028d96bf9ce0a45`、dirty=false；部署器确认 16 个公网文件验证通过。
- 独立公网下载核验：HTTP 200，63096 字节，与本地 CCX 逐字节相同，SHA256 `7f5c4105d27da25d3a2118c609fb05c0305ca96b2604aed0cc2212d3db382046`；MIME application/octet-stream、HSTS 与 nosniff 正常，包内版本与单一 WebView origin 符合预期。
- WebUI 未重新部署，正式与测试入口仍为 `0.2.6-1be424d45523`，协议兼容。
- 服务器官网 current 已指向本次快照，releases 仅保留 current，previous 已移除；旧 releases/latest.json 及其真正引用的版本目录文件随快照保留。
- Ego Lite 检查官网 1280px / 390px：版本和下载地址正确，移动端无横向溢出，两个主要按钮均在首屏可见；截图位于 `/private/tmp/mugen-release-2611030001-*.png`。Ego Lite 提示有可用更新，本次未升级浏览器。
- 代码保存在隔离分支 `codex/startup-release-20261103`；原主目录工作树不变，尚未执行 git push。

## 2611030002 地址更正

用户明确要求正式地址，2611030001 错误保留的 imini-test 已纠正：工作台使用 https://mugen.catrefuse.com/webui/，Manifest 仅授权 https://mugen.catrefuse.com。构建器、测试常量、打包器、产物校验和默认环境示例一致更新。当前构建正在验证与重新发行，最终公网包核验结果随后补充。

- 地址更正包已通过完整 package:ccx 门禁：`imini-ps-1.2.6-2611030002.ccx`，63084 字节，SHA256 `b2e32212af8cea4beb87f008bc055fb54ca756a858f627aa80652148a974d54f`，来源 `14d0a3ead14e99c5bb56a8fbdb296f7894bf308b`，dirty=false。解包检查确认实际 JS 包含正式工作台 URL，不包含 imini-test 域名，Manifest 仅允许正式 origin。公网替换待完成。

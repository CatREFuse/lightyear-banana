# iMini PS 读取恢复发行记录

日期：2026-09-09

- 基线：线上 CCX 1.2.1 / 2609080001，WebUI 0.2.4，源码 c74f050；隔离分支基于发行记录提交 d0e2519。
- 修复：恢复 Imaging 读取的短时 modal scope；编码和传输在 scope 外。原始 Photoshop 错误写入脱敏诊断。
- 同步合入 APIMart GPT Image 2.5 Flare/Sunburst 模型、能力枚举、请求映射及参数校验。
- 目标版本：CCX 1.2.2，WebUI 0.2.5。
- 实机：Photoshop 27.3.0 中确认旧调用抛出 1000，修复后 RGB/8、RGB/16 的画布、图层、选区与坐标读取通过；未验证用户原始 Sony RAW 文件和 Windows 双击安装。
- 代码提交：`e018773`；官网发行元数据提交：`93661c4`，分支 `codex/fix-photoshop-capture`，隔离目录 `/private/tmp/imini-ps-capture-fix`。
- 自动化：CCX Host 107 项、Core 61 项、跨模块 regression smoke、正式 package:ccx 门禁通过；WebUI 原有 62 项 E2E 和新增 Image 2.5 的 4 项 E2E 通过。Image 2.5 六档质量在 280/960 像素视口均可操作，已检查截图。
- WebUI：`0.2.5-d8722f90a048`，干净提交 `e018773`；插件入口部署脚本公网验证通过，浏览器入口 38 个文件逐字节与本地构建一致。
- CCX：`1.2.2+2609090001`，61740 字节，SHA256 `ed62c9e79a7768fc34546e7be2f9b1368b14460cf9ca9a19be351b6838af3991`，`dirty: false`。
- 官网：快照 `20260909T123333Z-4c6d8ee000ff-6fd55efa`，部署脚本验证 16 个公网文件；安装包再次独立下载校验一致，HTTP 200、application/octet-stream、HSTS、nosniff 均通过。
- 本机 UDT 已卸载用于对照的旧版本调试实例并加载本次 `dist/ccx-host`；未将开发加载视为正式双击安装验收。
- 用户需安装新版 CCX，单独刷新 WebUI 无法更新本地宿主读取逻辑。

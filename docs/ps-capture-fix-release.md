# iMini PS 读取恢复发行记录

日期：2026-09-09

- 基线：线上 CCX 1.2.1 / 2609080001，WebUI 0.2.4，源码 c74f050；隔离分支基于发行记录提交 d0e2519。
- 修复：恢复 Imaging 读取的短时 modal scope；编码和传输在 scope 外。原始 Photoshop 错误写入脱敏诊断。
- 同步合入 APIMart GPT Image 2.5 Flare/Sunburst 模型、能力枚举、请求映射及参数校验。
- 目标版本：CCX 1.2.2，WebUI 0.2.5。
- 实机：Photoshop 27.3.0 中确认旧调用抛出 1000，修复后 RGB/8、RGB/16 的画布、图层、选区与坐标读取通过；未验证用户原始 Sony RAW 文件和 Windows 双击安装。
- 发布验证与公网回读结果将在完成后写入。

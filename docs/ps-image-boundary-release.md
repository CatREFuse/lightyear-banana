# Photoshop 图片交互边界修复发行记录

日期：2026-09-08

## 版本与范围

- WebUI：0.2.4，兼容 inner-host/v1。
- CCX：iMini PS 1.2.1，Build 2609080001，插件 ID 保持 com.tanshow.mugen。
- 基于公网 WebUI release.json 已核实的 7294ba2 合入本次修复，保留线上界面与记录设置；共享开发工作区未修改。
- PS 调用仅保留读取图片、选区及坐标和结果置入。缩略图、参考图网络副本和历史预览由内部 WebView Canvas 处理；桥接采用分片传输。
- 移除缩略图临时打开/关闭 PS 文档、选区复制/合并/关闭副本、后台文档事件订阅、生成阶段读取活动文档和独立创建空图层命令。
- 新 CCX 依赖本次 WebUI 图片处理事件，按 WebUI、CCX、官网顺序发行；旧 CCX 仍兼容更新后的 WebUI。

## 已完成验证

- 协议测试 19/19，WebUI 单元测试 23/23 与 bundle 策略测试通过，iMini Provider 网络冒烟通过。
- WebUI 完整浏览器 E2E 62/62，覆盖双视口、浅深主题、上传/粘贴/拖入、历史、并发生成、原图回退和置入桥协议。
- CCX Host 105/105；图片服务重连、分片顺序、非法输入、禁止 PS 编码/复制与读取侧选区 alpha 断言通过。
- Canvas、源图比例、重试与 Nothing 主题回归通过；CCX typecheck、Host 构建和产物隔离检查通过。
- 已检查本次实际 Canvas 缩略图与双主题界面截图。

## 实机验收限制

当前电脑控制访问 Photoshop 连续返回 screen capture failed（-10005），未完成真实 Photoshop 的 tab 闪动、读取/生成/置入闭环验收；Windows 资源管理器双击安装也未完成。浏览器和模拟 Host 测试不能替代这些结果。

## 发行状态

完整源码门禁已通过。WebUI 正式部署、CCX 官方打包、官网快照与公网逐字节回读结果将在执行后补充。

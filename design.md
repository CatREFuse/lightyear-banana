# Lightyear Banana Design System

Lightyear Banana 是 Photoshop 旁侧的高密度生成工具。界面优先服务反复操作、快速确认、低干扰反馈和跨主题可读性。设计 token 的源码入口是 `src/components/lightyear/LightyearPanel.vue`，本文档作为长期维护约束。

## 设计原则

- 信息密度保持紧凑，主界面优先展示对话、参考图、生成结果和操作按钮。
- 组件边界保持克制，常规圆角使用 `6px` 到 `8px`，状态 pill 使用 `999px`。
- 图标按钮必须有 hover 名称，文字按钮只用于明确命令或当前状态。
- 设置页、菜单、生成结果和输入区共用 token，不写只适合单一主题的硬编码状态色。
- 错误、成功、警告、禁用、hover 都使用语义 token。新增状态先补 token，再写组件样式。
- 图片预览、缩略图、菜单、toast 使用稳定尺寸和 `min-width: 0`，避免长文案把操作区挤开。
- 动效控制在 `120ms` 到 `220ms`，并保留 `prefers-reduced-motion` 的关闭路径。
- 文案直接面向用户，只展示当前状态、结果和可执行操作。

## 字体与尺寸

| 用途 | Token / 值 |
| --- | --- |
| 字体 | `Inter, "Avenir Next", "Helvetica Neue", Arial, sans-serif` |
| 主界面正文 | `12px` |
| 次级说明 | `10px` 到 `11px` |
| 组件标题 | `13px` |
| 正文行高 | `1.45` |
| 图标按钮 | `28px` 到 `34px` |
| 输入区按钮 | `32px` 到 `34px` |

## 深色主题

| Token | 色值 |
| --- | --- |
| `--lb-bg` | `#1a2028` |
| `--lb-workspace` | `#151b23` |
| `--lb-thread-bg` | `#0d1218` |
| `--lb-thread-surface` | `#202733` |
| `--lb-thread-surface-2` | `#252d39` |
| `--lb-thread-card` | `#1b222c` |
| `--lb-thread-card-deep` | `#171e27` |
| `--lb-thread-image-bg` | `#111720` |
| `--lb-composer` | `#171e27` |
| `--lb-surface` | `#242b36` |
| `--lb-surface-2` | `#2c3440` |
| `--lb-field` | `#1e2630` |
| `--lb-card` | `#202733` |
| `--lb-card-deep` | `#1b222c` |
| `--lb-overlay` | `#242b36` |
| `--lb-border` | `rgba(168, 179, 196, 0.15)` |
| `--lb-border-strong` | `rgba(180, 190, 205, 0.24)` |
| `--lb-hairline` | `rgba(168, 179, 196, 0.12)` |
| `--lb-hover` | `rgba(255, 255, 255, 0.045)` |
| `--lb-text` | `#f3f4f6` |
| `--lb-secondary` | `#aeb5c2` |
| `--lb-muted` | `#7e8795` |
| `--lb-empty-bg` | `rgba(255, 255, 255, 0.045)` |
| `--lb-shadow` | `rgba(0, 0, 0, 0.38)` |

## 浅色主题

| Token | 色值 |
| --- | --- |
| `--lb-bg` | `#ffffff` |
| `--lb-workspace` | `#f6f6f4` |
| `--lb-thread-bg` | `#eef0f3` |
| `--lb-thread-surface` | `#ffffff` |
| `--lb-thread-surface-2` | `#ffffff` |
| `--lb-thread-card` | `#ffffff` |
| `--lb-thread-card-deep` | `#ffffff` |
| `--lb-thread-image-bg` | `#e8ebf0` |
| `--lb-composer` | `#ffffff` |
| `--lb-surface` | `#f4f4f2` |
| `--lb-surface-2` | `#ececea` |
| `--lb-field` | `#f7f7f5` |
| `--lb-card` | `#ffffff` |
| `--lb-card-deep` | `#f5f5f3` |
| `--lb-overlay` | `#ffffff` |
| `--lb-border` | `rgba(48, 43, 35, 0.12)` |
| `--lb-border-strong` | `rgba(48, 43, 35, 0.2)` |
| `--lb-hairline` | `rgba(48, 43, 35, 0.1)` |
| `--lb-hover` | `rgba(48, 43, 35, 0.055)` |
| `--lb-text` | `#22211e` |
| `--lb-secondary` | `#5d5a53` |
| `--lb-muted` | `#8a857c` |
| `--lb-empty-bg` | `rgba(48, 43, 35, 0.055)` |
| `--lb-shadow` | `rgba(67, 57, 39, 0.18)` |

## 共享语义色

| Token | 深色主题 | 浅色主题 | 用途 |
| --- | --- | --- | --- |
| `--lb-accent` | `#2f8cff` | `#2f8cff` | 主操作、焦点、加载 spinner |
| `--lb-accent-soft` | `rgba(47, 140, 255, 0.14)` | `rgba(47, 140, 255, 0.13)` | 选中背景、测试中状态 |
| `--lb-danger` | `#ffb4c0` | `#a63b4a` | 危险动作或错误主色 |
| `--lb-danger-bg` | `rgba(236, 81, 93, 0.11)` | `#fff0f2` | 错误卡片和错误按钮背景 |
| `--lb-danger-border` | `rgba(255, 111, 126, 0.32)` | `rgba(185, 48, 65, 0.3)` | 错误边框 |
| `--lb-danger-muted` | `#ff9aa8` | `#b33446` | 错误标题、错误状态短文案 |
| `--lb-danger-text` | `#ffd7dc` | `#7f1d2d` | 错误正文 |
| `--lb-success` | `#43d17a` | `#1b7f4d` | 已启用、连接成功、测试成功 |
| `--lb-success-bg` | `rgba(31, 156, 91, 0.14)` | `rgba(27, 127, 77, 0.12)` | 成功状态背景 |
| `--lb-success-ring` | `rgba(67, 209, 122, 0.16)` | `rgba(27, 127, 77, 0.16)` | 成功状态外圈 |
| `--lb-warning` | `#ffbd2e` | `#936300` | 等待、警告状态 |
| `--lb-warning-ring` | `rgba(255, 189, 46, 0.16)` | `rgba(147, 99, 0, 0.16)` | 警告状态外圈 |
| `--lb-neutral-ring` | `rgba(116, 128, 147, 0.13)` | `rgba(99, 95, 88, 0.14)` | 未连接、默认状态外圈 |

## 组件用法

| 组件区域 | 约束 |
| --- | --- |
| `PanelHeader` | 只展示窗口、连接和设置入口。连接点使用 `success` / `neutral` token。 |
| `MessageThread` | 用户消息、错误消息、加载状态和结果卡片必须在 L/D 主题下保持可读。错误态使用完整 `danger` token 组。 |
| `ComposerDock` | 输入、参考图、下拉菜单和发送按钮使用 shell token，弹出态互斥。 |
| `SettingsPanel` | 配置状态 badge 使用 `success`、`danger`、`muted`。测试按钮状态同一套语义色。 |
| `ControlSelect` / `RatioPicker` | 下拉触发器和菜单使用 `surface`、`overlay`、`border`、`shadow`。状态点使用语义色。 |

## 走查清单

- Light mode 下错误卡片正文、标题、边框和背景至少达到可读对比。
- Dark mode 下错误态不能刺眼，正文仍要比标题更稳定。
- 所有状态色优先使用 `--lb-*` 变量，避免组件内硬编码红绿黄文字。
- 菜单、tooltip、toast 的背景使用 `--lb-overlay`，阴影使用 `--lb-shadow`。
- Hover 态统一使用 `--lb-hover` 或 `--lb-surface-2`，不要额外引入新色阶。
- 新增 UI 状态必须补本文档和 `LightyearPanel.vue` 的 token。

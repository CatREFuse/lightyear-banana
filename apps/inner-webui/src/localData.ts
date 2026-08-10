import type { LocalDataClearResult } from '@lightyear-banana/inner-protocol'

export const LOCAL_DATA_TYPES = [
  'API Key 和访问凭据',
  '模型配置',
  '对话历史',
  '生成图片',
  '诊断日志',
  '界面偏好和草稿'
] as const

export async function confirmAndClearLocalData(
  confirm: (message: string) => boolean,
  clear: () => Promise<LocalDataClearResult>
) {
  const listed = `将删除以下本地数据：\n\n${LOCAL_DATA_TYPES.map((item) => `· ${item}`).join('\n')}`
  if (!confirm(listed)) return null
  if (!confirm('请再次确认。清除后无法恢复。')) return null
  return clear()
}

export type MockApiKeyPreset = {
  key: string
  label: string
  title: string
}

export const mockApiKeyPresets: MockApiKeyPreset[] = [
  {
    key: 'mock-good',
    label: '成功',
    title: '成功返回图片'
  },
  {
    key: 'mock-bad-key',
    label: '无效 Key',
    title: '401 无效 API Key'
  },
  {
    key: 'mock-expired',
    label: '过期',
    title: '401 Key 已过期'
  },
  {
    key: 'mock-permission-denied',
    label: '无权限',
    title: '403 权限不足'
  },
  {
    key: 'mock-rate-limited',
    label: '限流',
    title: '429 请求频率过高'
  },
  {
    key: 'mock-quota-exceeded',
    label: '额度不足',
    title: '429 额度不足'
  },
  {
    key: 'mock-server-error',
    label: '服务错误',
    title: '500 服务错误'
  },
  {
    key: 'mock-timeout',
    label: '超时',
    title: '504 请求超时'
  }
]

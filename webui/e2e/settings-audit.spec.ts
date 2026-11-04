import { expect, test } from '@playwright/test'

test('browser discards a connection result when the draft changes during the request', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mugen.settings.v1', JSON.stringify({
      activeConfigId: 'settings-audit',
      configs: [{
        id: 'settings-audit', name: '连接测试', provider: 'openai',
        model: 'gpt-image-2', models: ['gpt-image-2'], apiKey: 'test-key',
        baseUrl: 'https://api.openai.com', enabled: true
      }]
    }))
  })
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let requested!: () => void
  const started = new Promise<void>(resolve => { requested = resolve })
  await page.route('https://api.openai.com/**', async route => {
    requested()
    await held
    await route.fulfill({ json: { data: [{ id: 'gpt-image-2' }] } })
  })
  await page.goto('/')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: /自定义 API/ }).click()
  await page.locator('.config-row').click()
  const detail = page.getByLabel('配置详情')
  await detail.getByRole('button', { name: '测试 API', exact: true }).click()
  await started
  await detail.getByLabel('API Key', { exact: true }).fill('changed-key')
  const response = page.waitForResponse('https://api.openai.com/**')
  release()
  await response
  await expect(detail.getByRole('button', { name: '测试 API', exact: true })).toBeEnabled()
  await expect(detail.getByRole('button', { name: 'API 可用', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mugen.settings.v1')!).configs[0].apiKey)).toBe('test-key')
})

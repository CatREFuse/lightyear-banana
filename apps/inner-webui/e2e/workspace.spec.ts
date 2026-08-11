import { expect, test } from '@playwright/test'
import { installTestHost } from './hostFixture'

test.beforeEach(async ({ page }) => {
  await installTestHost(page)
  await page.goto('/')
  await expect(page.getByText('Photoshop 已连接')).toBeVisible()
})

test('completes the reference, generation, preview and history flow', async ({ page }) => {
  await page.getByRole('button', { name: '添加参考' }).click()
  await page.getByRole('button', { name: '可见图层' }).click()
  await expect(page.getByRole('img', { name: '可见图层' })).toBeVisible()

  await page.getByRole('textbox', { name: '输入提示词，或输入 / 调用预设' }).fill('一张夏日音乐节海报')
  await page.getByRole('button', { name: '发送' }).click()
  const preview = page.getByRole('button', { name: '生成结果 1' })
  await expect(preview).toBeVisible({ timeout: 5_000 })
  await preview.click()
  const previewRegion = page.getByRole('region', { name: '图片预览' })
  await expect(previewRegion).toBeVisible()
  await page.getByRole('button', { name: '关闭预览' }).click()
  await expect(previewRegion).toBeHidden()

  await page.getByRole('button', { name: '设置' }).click()
  await page.getByRole('button', { name: '清空' }).click()
  await page.getByRole('button', { name: '再次清空' }).click()
  await page.getByRole('button', { name: '返回' }).click()
  await expect(page.getByRole('region', { name: '当前对话' }).getByText('READY')).toBeVisible()
})

test('opens the real settings UI through the Host bridge', async ({ page }) => {
  await page.getByRole('button', { name: '设置' }).click()
  await expect(page.getByRole('button', { name: 'APIMart APIMart · gpt-image-1 启用' })).toBeVisible()
})

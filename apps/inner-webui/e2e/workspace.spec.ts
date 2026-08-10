import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/#/workspace')
  await expect(page.getByText('预览模式')).toBeVisible()
})

test('completes the reference, generation, preview and history flow', async ({ page }) => {
  await page.getByRole('button', { name: '添加参考图' }).click()
  await page.getByRole('button', { name: '可见图层' }).click()
  await expect(page.getByRole('img', { name: '可见图层' })).toBeVisible()

  await page.getByLabel('提示词').fill('一张夏日音乐节海报')
  await page.getByRole('button', { name: /^生成/ }).click()
  const preview = page.getByRole('button', { name: '预览 生成结果 1' })
  await expect(preview).toBeVisible({ timeout: 5_000 })
  await preview.click()
  await expect(page.getByRole('dialog', { name: '图片预览' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: '图片预览' })).toBeHidden()

  page.once('dialog', dialog => dialog.accept())
  await page.getByRole('button', { name: '清除记录' }).click()
  await expect(page.getByText('从一个想法开始')).toBeVisible()
})

test('creates a keyless local provider configuration', async ({ page }) => {
  await page.getByRole('button', { name: '设置' }).click()
  await page.getByRole('button', { name: '新建配置' }).click()
  await page.getByLabel('配置名称').fill('本地工作流')
  await page.getByLabel('服务商').selectOption('comfyui')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.getByRole('heading', { name: '编辑配置' })).toBeVisible()
  await page.getByRole('button', { name: '返回配置' }).click()
  await expect(page.getByText('本地工作流')).toBeVisible()
})

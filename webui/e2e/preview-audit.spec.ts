import { expect, test } from '@playwright/test'
import { createApimartFixtureServer, expectedApiKey } from '../../utils/apimart-smoke-server.mjs'
import { installTestHost } from './hostFixture'

let fixture: ReturnType<typeof createApimartFixtureServer>
let baseUrl: string

test.beforeAll(async () => {
  fixture = createApimartFixtureServer({ port: 0 })
  baseUrl = await fixture.start()
})
test.afterAll(async () => { await fixture.stop() })

test('original preview keeps original dimensions and contains keyboard focus', async ({ page }, testInfo) => {
  await installTestHost(page, { apimartBaseUrl: baseUrl, apiKey: expectedApiKey, lowResolutionResultThumbnail: true })
  await page.goto('/')
  await page.getByRole('textbox', { name: '输入提示词，或输入 / 调用预设' }).fill('检查原图预览')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const thumbnail = page.getByRole('img', { name: '生成结果 1', exact: true })
  await expect.poll(() => thumbnail.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(1024)
  const opener = page.locator('.thumbnail-button')
  await opener.click()
  const preview = page.getByRole('dialog')
  await expect(preview.locator('.preview-header')).toContainText('1600 × 1200')
  await expect(preview.getByRole('button', { name: '关闭预览' })).toBeFocused()
  await expect(preview.getByRole('img', { name: '生成结果 1', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('original-preview.png') })
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press('Tab')
    expect(await preview.evaluate(element => element.contains(document.activeElement))).toBe(true)
  }
  await page.keyboard.press('Shift+Tab')
  expect(await preview.evaluate(element => element.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(preview).toHaveCount(0)
  await expect(opener).toBeFocused()
})

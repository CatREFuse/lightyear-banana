import { expect, test } from '@playwright/test'
import { installTestHost } from './hostFixture'

test.beforeEach(async ({ page }) => {
  await installTestHost(page, { configured: false })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'iMini PS' })).toBeVisible()
})

test('uses the preset icon and pending configuration summary', async ({ page }, testInfo) => {
  const settingsButton = page.getByRole('button', { name: '生成设置', exact: true })
  const presetButton = page.getByRole('button', { name: '预设提示词', exact: true })
  const icon = presetButton.locator('.app-icon')
  const summary = page.locator('.parameter-summary')

  await expect(icon).toHaveCSS('width', '16px')
  await expect(icon).toHaveCSS('height', '16px')
  await expect(settingsButton).toHaveClass(/parameter-summary/)
  await expect(summary).toHaveText('待配置')

  if (testInfo.project.name === 'panel-wide') {
    await expect(summary).toBeVisible()
  }

  await page.screenshot({ path: testInfo.outputPath('composer-unconfigured.png') })
})

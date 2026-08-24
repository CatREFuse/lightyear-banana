import { expect, test } from '@playwright/test'
import { installTestHost } from './hostFixture'

test.beforeEach(async ({ page }) => {
  await installTestHost(page, {
    configuredModel: {
      name: 'iMini',
      provider: 'iMini',
      model: 'openai/gpt-image-2'
    }
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'iMini PS' })).toBeVisible()
})

test('matches the configured Figma summary and wider compact breakpoint', async ({ page }, testInfo) => {
  const summary = page.locator('.parameter-summary')

  await expect(summary).toHaveCSS('font-size', '12px')
  await expect(summary.locator('.parameter-summary-icon')).toHaveAttribute('style', /width: 16px/)
  await expect(summary.locator('.parameter-summary-model')).toHaveText('gpt-image-2')
  await expect(summary.locator('.parameter-summary-divider')).toHaveText('/')
  await expect(summary.locator('.parameter-summary-field')).toHaveText(['iMini', '1K', '低', '原图比例', '1张'])

  await page.setViewportSize({ width: 400, height: 720 })
  await expect(summary).toBeHidden()
  await page.setViewportSize({ width: 402, height: 720 })
  await expect(summary).toBeVisible()
  await expect(summary.locator('.parameter-summary-chevron')).toBeVisible()

  await page.screenshot({ path: testInfo.outputPath('composer-configured-summary.png') })
})

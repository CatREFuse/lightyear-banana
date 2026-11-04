import { expect, test } from '@playwright/test'
import { installTestHost } from './hostFixture'

for (const model of ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']) {
  test(`APIMart ${model} exposes its generation settings`, async ({ page }, testInfo) => {
    await installTestHost(page, { configuredModel: { name: 'APIMart', provider: 'apimart', model } })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Mugen' })).toBeVisible()
    await page.getByRole('button', { name: '生成设置', exact: true }).click()
    const menu = page.getByRole('region', { name: '生成设置' })
    await expect(menu.getByRole('button', { name: 'xhigh', exact: true })).toBeVisible()
    await menu.getByRole('button', { name: 'max', exact: true }).click()
    await expect(menu.getByRole('button', { name: 'max', exact: true })).toHaveAttribute('aria-pressed', 'true')
    const resolution = menu.getByRole('slider', { name: '生成分辨率' })
    await resolution.focus()
    await resolution.press('End')
    await expect(resolution).toHaveAttribute('aria-valuetext', /4k/i)
    for (let i = 0; i < 3; i++) await menu.getByRole('button', { name: '增加生成数量' }).click()
    await expect(menu.locator('.parameter-stepper output')).toHaveText('4')
    await expect(menu.getByRole('button', { name: '增加生成数量' })).toBeDisabled()
    await page.screenshot({ path: testInfo.outputPath('image25-settings.png') })
  })
}

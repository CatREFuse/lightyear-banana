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

test('restores the last generation settings after reopening WebUI', async ({ page }) => {
  await page.getByRole('button', { name: '生成设置', exact: true }).click()
  let menu = page.getByRole('region', { name: '生成设置' })

  const slider = menu.getByRole('slider', { name: '生成分辨率' })
  await slider.focus()
  await slider.press('End')
  await menu.getByRole('button', { name: '增加生成数量' }).click()
  await menu.getByRole('button', { name: '高', exact: true }).click()
  await menu.locator('[data-route="ratio"]').click()
  await menu.getByRole('radio', { name: /1:1/ }).click()
  await menu.getByRole('button', { name: '宽高输入', exact: true }).click()
  await menu.getByRole('spinbutton', { name: '宽' }).fill('2304')
  await menu.getByRole('spinbutton', { name: '高' }).fill('1536')

  await expect.poll(() => page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('mugen.generation-preferences.v1') || '{}')
    return stored['e2e-apimart']
  })).toEqual({
    count: 2,
    customHeight: 1536,
    customWidth: 2304,
    quality: 'high',
    ratio: '1:1',
    resolutionMode: 'custom',
    size: '4K'
  })

  await page.reload()
  await expect(page.getByRole('heading', { name: 'iMini PS' })).toBeVisible()
  await page.getByRole('button', { name: '生成设置', exact: true }).click()
  menu = page.getByRole('region', { name: '生成设置' })

  await expect(menu.locator('.parameter-stepper output')).toHaveText('2')
  await expect(menu.getByRole('button', { name: '高', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(menu.getByRole('button', { name: '比例 1:1', exact: true })).toBeVisible()
  await expect(menu.getByRole('spinbutton', { name: '宽' })).toHaveValue('2304')
  await expect(menu.getByRole('spinbutton', { name: '高' })).toHaveValue('1536')
  await expect(menu.getByRole('slider', { name: '生成分辨率' })).toBeDisabled()
})

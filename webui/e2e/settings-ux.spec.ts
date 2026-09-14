import { expect, test } from '@playwright/test'
import { installTestHost, readTestHostTrace } from './hostFixture'

test('settings navigation, explicit saves and keyboard selection', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByLabel('iMini API Key').fill('settings-ux-test-key')
  await page.getByRole('button', { name: '保存 API Key', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存 API Key', exact: true })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => {
    const configs = JSON.parse(localStorage.getItem('mugen.settings.v1')!).configs
    return configs.map((config: { provider: string; apiKey: string }) => [config.provider, config.apiKey])
  })).toEqual([['iMini', 'settings-ux-test-key']])
  await page.getByRole('button', { name: /自定义 API/ }).click()
  await page.locator('.config-row').click()
  await page.getByLabel('配置名称').fill('未保存名称')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mugen.settings.v1')!).configs[0].name)).toBe('iMini')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.locator('.config-row strong')).toHaveText('iMini')
  await page.locator('.config-row').click()
  await expect(page.getByLabel('配置名称')).toHaveValue('iMini')
  await page.getByLabel('配置名称').fill('已保存名称')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.config-row strong')).toHaveText('已保存名称')
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByRole('heading', { name: '常用设置' })).toBeVisible()
  await page.getByRole('button', { name: /常用提示词/ }).click()
  await expect(page.getByRole('heading', { name: '预设提示词', exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await page.getByRole('button', { name: '清空生成记录', exact: true }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('group', { name: '确认清空生成记录' })).toHaveCount(0)
  await page.getByRole('button', { name: '返回', exact: true }).click()
  const trigger = page.locator('.composer .select-field').filter({ hasText: '数量' }).locator('.select-trigger')
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('option', { selected: true })).toBeFocused()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await trigger.press('ArrowUp')
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await page.reload()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.getByLabel('iMini API Key')).toHaveValue('settings-ux-test-key')
  await page.getByRole('button', { name: /自定义 API/ }).click()
  await expect(page.locator('.config-row strong')).toHaveText('已保存名称')
})

test('settings stays readable across themes and panel widths', async ({ page }, testInfo) => {
  await page.goto('/')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  for (const theme of ['经典', 'Nothing']) {
    for (const mode of ['浅色', '深色']) {
      await page.getByRole('button', { name: '主题', exact: true }).click()
      await page.locator('.theme-menu button').filter({ hasText: theme }).click()
      await page.locator('.theme-menu button').filter({ hasText: mode }).click()
      await page.keyboard.press('Escape')
      await expect(page.locator('.theme-menu')).toHaveCount(0)
      for (const width of [260, 402, 960]) {
        await page.setViewportSize({ width, height: 720 })
        await expect(page.getByLabel('iMini API Key')).toBeVisible()
        expect(await page.evaluate(() => {
          const panel = document.querySelector('.settings-panel')!
          return panel.scrollWidth <= panel.clientWidth && document.documentElement.scrollWidth <= innerWidth
        })).toBe(true)
        const stepper = page.getByRole('group', { name: '生成记录保存条数' })
        const [decrease, count, increase] = await Promise.all([
          stepper.locator('button').first().boundingBox(),
          stepper.locator('output').boundingBox(),
          stepper.locator('button').last().boundingBox()
        ])
        expect(decrease!.x + decrease!.width).toBeLessThanOrEqual(count!.x)
        expect(count!.x + count!.width).toBeLessThanOrEqual(increase!.x)
        await page.screenshot({ path: testInfo.outputPath(`settings-${theme}-${mode}-${width}.png`), animations: 'disabled' })
      }
    }
  }
})

test('iMini quick save uses the CCX credential bridge', async ({ page }) => {
  await installTestHost(page)
  await page.goto('/')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByLabel('iMini API Key').fill('ccx-settings-ux-test-key')
  await page.getByRole('button', { name: '保存 API Key', exact: true }).click()
  await expect(page.getByRole('button', { name: '保存 API Key', exact: true })).toHaveCount(0)
  const trace = await readTestHostTrace(page)
  expect(trace.commands.some(item => item.command === 'credential.set')).toBe(true)
  await page.getByRole('button', { name: /自定义 API/ }).click()
  await expect(page.locator('.config-row strong')).toContainText(['APIMart', 'iMini'])
})

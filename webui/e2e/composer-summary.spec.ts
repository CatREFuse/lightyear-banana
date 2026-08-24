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

test('matches the Figma input surface in light and dark themes', async ({ page }, testInfo) => {
  const composer = page.locator('.composer')
  const surface = page.locator('.composer-surface')
  const summary = page.locator('.parameter-summary')
  const prompt = page.getByRole('textbox', { name: '描述你想生成的画面，输入 / 调用常用提示词' })
  const toolButtons = page.locator('.composer-tools .tool-button')
  const sendButton = page.getByRole('button', { name: '发送' })

  await expect(summary).toHaveCSS('font-size', '12px')
  await expect(summary).toHaveCSS('height', '47px')
  await expect(summary).toHaveCSS('padding-top', '8px')
  await expect(summary).toHaveCSS('padding-right', '12px')
  await expect(summary).toHaveCSS('border-radius', '12px')
  await expect(summary.locator('.parameter-provider')).toHaveText('iMini')
  await expect(summary.locator('.parameter-provider-dot')).toHaveCSS('width', '7px')
  await expect(summary.locator('.parameter-summary-icon')).toHaveAttribute('style', /width: 12px/)
  await expect(summary.locator('.parameter-summary-model')).toHaveText('gpt-image-2')
  await expect(summary.locator('.parameter-summary-divider')).toHaveText('/')
  await expect(summary.locator('.parameter-summary-field')).toHaveText(['1K', '低', '原图比例', '1张'])
  await expect(summary.locator('.parameter-summary-chevron')).toHaveAttribute('style', /width: 12px/)
  const summaryAlignment = await summary.evaluate((element) => {
    const icon = element.querySelector<HTMLElement>('.parameter-summary-icon')?.getBoundingClientRect()
    const model = element.querySelector<HTMLElement>('.parameter-summary-model')?.getBoundingClientRect()
    const chevron = element.querySelector<HTMLElement>('.parameter-summary-chevron')?.getBoundingClientRect()
    if (!icon || !model || !chevron) throw new Error('Parameter summary alignment targets are missing.')
    const modelCenter = model.top + model.height / 2
    return {
      iconCenterDelta: Math.abs(icon.top + icon.height / 2 - modelCenter),
      chevronCenterDelta: Math.abs(chevron.top + chevron.height / 2 - modelCenter)
    }
  })
  expect(summaryAlignment.iconCenterDelta).toBeLessThanOrEqual(0.5)
  expect(summaryAlignment.chevronCenterDelta).toBeLessThanOrEqual(0.5)

  await expect(summary).toBeVisible()
  await expect(surface).toHaveCSS('min-height', '138px')
  await expect(surface).toHaveCSS('padding-top', '12px')
  await expect(surface).toHaveCSS('padding-right', testInfo.project.name === 'panel-280' ? '12px' : '16px')
  expect(await surface.evaluate((element) => parseFloat(getComputedStyle(element).borderTopWidth))).toBeLessThanOrEqual(1)
  await expect(surface).toHaveCSS('border-radius', '16px')
  await expect(prompt).toHaveCSS('font-size', '12px')
  await expect(prompt).toHaveCSS('line-height', '16px')
  await expect(toolButtons).toHaveCount(2)
  await expect(toolButtons.first()).toHaveCSS('width', '24px')
  await expect(toolButtons.first()).toHaveCSS('height', '24px')
  await expect(sendButton).toHaveCSS('width', '24px')
  await expect(sendButton).toHaveCSS('height', '24px')

  const layout = await composer.evaluate((element) => {
    const status = element.querySelector<HTMLElement>('.composer-status')?.getBoundingClientRect()
    const input = element.querySelector<HTMLElement>('.composer-surface')?.getBoundingClientRect()
    if (!status || !input) throw new Error('Composer surfaces are missing.')
    return {
      inputHeight: Math.round(input.height),
      inputWidth: Math.round(input.width),
      overlap: Math.round(status.bottom - input.top),
      statusCenterDelta: Math.abs((status.left + status.right - input.left - input.right) / 2),
      statusLeftInset: Math.round(status.left - input.left),
      statusRightInset: Math.round(input.right - status.right),
      statusWidth: Math.round(status.width)
    }
  })
  expect(layout.statusCenterDelta).toBeLessThanOrEqual(0.5)
  expect(layout).toEqual(testInfo.project.name === 'panel-280'
    ? { inputHeight: 138, inputWidth: 264, overlap: 17, statusCenterDelta: 0, statusLeftInset: 12, statusRightInset: 12, statusWidth: 240 }
    : { inputHeight: 138, inputWidth: 460, overlap: 17, statusCenterDelta: 0, statusLeftInset: 15, statusRightInset: 15, statusWidth: 431 })
  await expect(page.locator('.mugen-shell')).toHaveCSS('width', testInfo.project.name === 'panel-280' ? '280px' : '482px')

  await page.getByRole('button', { name: '外观' }).click()
  await page.getByRole('button', { name: '浅色', exact: true }).click()
  await expect(page.getByLabel('外观设置')).toBeHidden()
  await expect(page.locator('.mugen-shell')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(page.locator('.mugen-shell')).toHaveCSS('color', 'rgb(24, 24, 27)')
  await expect(page.locator('.panel-header')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(page.locator('.workspace-route')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(page.locator('.thread')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(composer).toHaveCSS('box-shadow', 'none')
  await expect(surface).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(surface).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0.1)')
  await expect(summary).toHaveCSS('background-color', 'rgb(244, 244, 245)')
  await expect(summary.locator('.parameter-provider-dot')).toHaveCSS('background-color', 'rgb(34, 197, 94)')
  await expect(summary.locator('.parameter-summary-model')).toHaveCSS('color', 'rgb(24, 24, 27)')
  await expect(summary.locator('.parameter-summary-field').first()).toHaveCSS('color', 'rgb(161, 161, 170)')
  await expect(toolButtons.first()).toHaveCSS('background-color', 'rgb(244, 244, 245)')
  await expect(toolButtons.first()).toHaveCSS('color', 'rgb(24, 24, 27)')
  await page.screenshot({ path: testInfo.outputPath('composer-figma-light.png') })

  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.locator('.settings-panel')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  const settingsBackButton = page.getByRole('button', { name: '返回' })
  await settingsBackButton.hover()
  await expect(settingsBackButton).toHaveCSS('width', '24px')
  await expect(settingsBackButton).toHaveCSS('height', '24px')
  await expect(settingsBackButton.locator('svg')).toHaveCSS('width', '18px')
  await expect(settingsBackButton.locator('svg')).toHaveCSS('height', '18px')
  await page.screenshot({ path: testInfo.outputPath('settings-back-hover.png') })
  await settingsBackButton.click()

  await page.getByRole('button', { name: '外观' }).click()
  await page.getByRole('button', { name: '深色', exact: true }).click()
  await expect(page.getByLabel('外观设置')).toBeHidden()
  await expect(page.locator('.mugen-shell')).toHaveCSS('background-color', 'rgb(63, 63, 70)')
  await expect(page.locator('.mugen-shell')).toHaveCSS('color', 'rgb(255, 255, 255)')
  await expect(page.locator('.panel-header')).toHaveCSS('background-color', 'rgb(63, 63, 70)')
  await expect(page.locator('.workspace-route')).toHaveCSS('background-color', 'rgb(63, 63, 70)')
  await expect(page.locator('.thread')).toHaveCSS('background-color', 'rgb(63, 63, 70)')
  await expect(surface).toHaveCSS('background-color', 'rgb(63, 63, 70)')
  await expect(surface).toHaveCSS('border-top-color', 'rgba(255, 255, 255, 0.2)')
  await expect(summary).toHaveCSS('background-color', 'rgb(39, 39, 42)')
  await expect(summary.locator('.parameter-provider-dot')).toHaveCSS('background-color', 'rgb(34, 197, 94)')
  await expect(summary.locator('.parameter-summary-model')).toHaveCSS('color', 'rgb(255, 255, 255)')
  await expect(summary.locator('.parameter-summary-field').first()).toHaveCSS('color', 'rgba(255, 255, 255, 0.5)')
  await expect(toolButtons.first()).toHaveCSS('background-color', 'rgb(82, 82, 91)')
  await expect(toolButtons.first()).toHaveCSS('color', 'rgb(255, 255, 255)')
  await page.screenshot({ path: testInfo.outputPath('composer-figma-dark.png') })

  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.locator('.settings-panel')).toHaveCSS('background-color', 'rgb(63, 63, 70)')
})

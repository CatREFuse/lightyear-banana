import { expect, test } from '@playwright/test'
import { installTestHost } from './hostFixture'

test.beforeEach(async ({ page }) => {
  await installTestHost(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Mugen' })).toBeVisible()
  await page.getByRole('button', { name: '外观' }).click()
  await page.getByRole('button', { name: '浅色', exact: true }).click()
})

test('aligns setting icons and keeps every settings route on bg-base', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.locator('.panel-header.is-settings')).toHaveCSS('background-color', 'rgb(244, 244, 245)')
  await expect(page.locator('.route-shell.is-settings-active')).toHaveCSS('background-color', 'rgb(244, 244, 245)')
  await expect(page.locator('.settings-panel')).toHaveCSS('background-color', 'rgb(244, 244, 245)')
  await expect(page.locator('.settings-page')).toHaveCSS('background-color', 'rgb(244, 244, 245)')

  for (const [label, row] of [
    ['常用提示词', page.getByRole('button', { name: /^常用提示词/ })],
    ['生成记录保存条数', page.getByRole('group', { name: '生成记录保存条数' }).locator('..')]
  ] as const) {
    const geometry = await row.evaluate((element) => {
      const icon = element.querySelector<HTMLElement>('.settings-row-icon')
      const title = element.querySelector<HTMLElement>('.settings-row-copy strong')
      if (!icon || !title) return null
      const iconRect = icon.getBoundingClientRect()
      const titleRect = title.getBoundingClientRect()
      return {
        iconHeight: iconRect.height,
        iconTop: iconRect.top,
        offset: (iconRect.top + (iconRect.height / 2)) - (titleRect.top + (titleRect.height / 2)),
        titleHeight: titleRect.height,
        titleTop: titleRect.top
      }
    })
    expect(geometry, `${label} 图标应与第一行文字中心对齐`).toMatchObject({ offset: 0 })
  }

  await page.locator('.settings-panel').evaluate((panel) => {
    const target = window as Window & {
      __settingsMotion?: string[]
      __settingsMotionObserver?: MutationObserver
    }
    target.__settingsMotion = []
    target.__settingsMotionObserver?.disconnect()
    target.__settingsMotionObserver = new MutationObserver((records) => {
      for (const record of records) {
        const element = record.target as HTMLElement
        const className = element.className
        if (typeof className === 'string' && /settings-(?:forward|back)-/.test(className)) {
          target.__settingsMotion?.push(className)
        }
      }
    })
    target.__settingsMotionObserver.observe(panel, {
      attributes: true,
      attributeFilter: ['class'],
      subtree: true
    })
  })

  await page.getByRole('button', { name: /^常用提示词/ }).click()
  await expect(page.getByRole('heading', { name: '预设提示词' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (
    (window as Window & { __settingsMotion?: string[] }).__settingsMotion
      ?.some((className) => className.includes('settings-forward-enter-active')) ?? false
  ))).toBe(true)

  const presetPage = page.locator('.prompt-preset-settings')
  await expect(page.locator('.settings-page')).toHaveCSS('background-color', 'rgb(244, 244, 245)')
  await expect(presetPage.getByText('[PRESETS]', { exact: true })).toHaveCount(0)
  await expect(presetPage.getByText('已有 0 个', { exact: true })).toBeVisible()
  await expect.poll(() => presetPage.locator('.preset-empty-state').evaluate((element) => {
    const style = getComputedStyle(element)
    return { background: style.backgroundColor, radius: style.borderRadius }
  })).toEqual({ background: 'rgb(255, 255, 255)', radius: '16px' })
  await expect.poll(() => presetPage.locator('.add-button').evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    return { height: Math.round(bounds.height), radius: style.borderRadius }
  })).toEqual({ height: 28, radius: '8px' })

  await presetPage.getByRole('button', { name: '添加' }).click()
  await presetPage.getByRole('textbox', { name: /^名称/ }).fill('产品海报')
  await presetPage.getByRole('textbox', { name: '提示词' }).fill('制作一张留白充足的产品海报')
  await presetPage.getByRole('button', { name: '保存预设' }).click()
  await expect(presetPage.getByText('制作一张留白充足的产品海报')).toBeVisible()
  await expect.poll(() => presetPage.locator('.preset-list').evaluate((element) => getComputedStyle(element).borderRadius)).toBe('16px')
  await page.screenshot({ path: testInfo.outputPath('preset-settings-page.png') })

  await page.evaluate(() => {
    (window as Window & { __settingsMotion?: string[] }).__settingsMotion = []
  })
  await page.getByRole('button', { name: '返回', exact: true }).click()
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (
    (window as Window & { __settingsMotion?: string[] }).__settingsMotion
      ?.some((className) => className.includes('settings-back-enter-active')) ?? false
  ))).toBe(true)

  await page.getByRole('button', { name: /^自定义 API/ }).click()
  await expect(page.getByRole('heading', { name: '自定义 API' })).toBeVisible()
  await expect(page.locator('.settings-page')).toHaveCSS('background-color', 'rgb(244, 244, 245)')
  await page.getByRole('button', { name: '添加', exact: true }).click()
  await expect(page.getByLabel('配置详情')).toBeVisible()
  await expect(page.locator('.settings-page')).toHaveCSS('background-color', 'rgb(244, 244, 245)')
})

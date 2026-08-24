import { expect, test } from '@playwright/test'
import { installTestHost } from './hostFixture'

test.beforeEach(async ({ page }) => {
  await installTestHost(page)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'iMini PS' })).toBeVisible()
  await page.getByRole('button', { name: '外观' }).click()
  await page.getByRole('button', { name: '浅色', exact: true }).click()
})

test('controls generation resolution with the Figma discrete slider', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: '生成设置', exact: true }).click()
  const menu = page.getByRole('region', { name: '生成设置' })
  const slider = menu.getByRole('slider', { name: '生成分辨率' })
  const sliderTrack = menu.locator('.discrete-slider')
  const sliderFill = menu.locator('.discrete-slider-fill')
  const sliderThumb = menu.locator('.discrete-slider-thumb')

  await expect(slider).toHaveAttribute('min', '0')
  await expect(slider).toHaveAttribute('max', '3')
  await expect(slider).toHaveAttribute('step', '1')
  await expect(slider).toHaveValue('1')
  await expect(slider).toHaveAttribute('aria-valuetext', '1K')
  await expect.poll(async () => sliderTrack.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return { width: Math.round(bounds.width), height: Math.round(bounds.height) }
  })).toEqual({ width: 221, height: 26 })
  await expect(menu.locator('.discrete-slider-tick.is-complete')).toHaveCount(1)
  await expect(menu.locator('.discrete-slider-tick.is-complete')).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.9)')
  await expect(sliderThumb).toHaveCSS('background-color', 'rgb(255, 255, 255)')
  await expect(menu.locator('.discrete-slider-tick.is-pending').first()).toHaveCSS('background-color', 'rgb(212, 212, 216)')
  await expect(menu.locator('.discrete-slider-tick.is-current')).toHaveCSS('visibility', 'hidden')
  await expect.poll(async () => menu.evaluate((element) => {
    const tick = element.querySelector<HTMLElement>('.discrete-slider-tick.is-current')?.getBoundingClientRect()
    const thumb = element.querySelector<HTMLElement>('.discrete-slider-thumb')?.getBoundingClientRect()
    if (!tick || !thumb) return Number.POSITIVE_INFINITY
    return Math.abs((tick.left + tick.width / 2) - (thumb.left + thumb.width / 2))
  })).toBeLessThanOrEqual(0.5)
  await expect.poll(() => sliderFill.evaluate((element) => getComputedStyle(element).transitionProperty)).toContain('width')
  await page.screenshot({ path: testInfo.outputPath('figma-resolution-slider-mid.png') })

  await slider.focus()
  await expect(sliderTrack).toHaveCSS('outline-style', 'none')
  await expect(sliderThumb).toHaveCSS('transform', 'matrix(1, 0, 0, 1.16, 0, 0)')
  await slider.press('End')
  await expect(slider).toHaveValue('3')
  await expect(slider).toHaveAttribute('aria-valuetext', '4K')
  await expect(menu.locator('.parameter-resolution-actions output')).toHaveText('4K')
  await expect.poll(() => sliderFill.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgb(168, 85, 247)')
  await expect.poll(async () => sliderFill.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(221)
  await expect(menu.locator('.discrete-slider-tick.is-complete')).toHaveCount(3)
  await expect(menu.locator('.discrete-slider-tick.is-pending')).toHaveCount(0)
  await expect.poll(() => sliderFill.evaluate((element) => {
    const charge = getComputedStyle(element, '::before')
    return {
      animationActive: charge.animationName.includes('discrete-slider-charge'),
      animationDuration: charge.animationDuration,
      opacity: charge.opacity
    }
  })).toEqual({ animationActive: true, animationDuration: '2.4s', opacity: '1' })

  await slider.press('Home')
  await expect(slider).toHaveValue('0')
  await expect(slider).toHaveAttribute('aria-valuetext', '0.5K')
  await expect.poll(async () => sliderFill.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(16)

  const sliderBounds = await slider.boundingBox()
  if (!sliderBounds) throw new Error('Resolution slider is not measurable')
  await page.mouse.move(sliderBounds.x + 8, sliderBounds.y + (sliderBounds.height / 2))
  await page.mouse.down()
  await page.mouse.move(sliderBounds.x + sliderBounds.width - 8, sliderBounds.y + (sliderBounds.height / 2))
  await page.mouse.up()
  await expect(slider).toHaveValue('3')
  await expect(slider).toHaveAttribute('aria-valuetext', '4K')

  await menu.getByRole('button', { name: '宽高输入', exact: true }).click()
  await expect(menu.getByRole('spinbutton', { name: '宽' })).toBeVisible()
  await expect(menu.getByRole('spinbutton', { name: '高' })).toBeVisible()
  await expect(slider).toBeDisabled()
  await menu.getByRole('button', { name: '使用预设', exact: true }).click()
  await expect(menu.getByRole('spinbutton', { name: '宽' })).toHaveCount(0)
  await expect(slider).toBeEnabled()
  await expect(menu.locator('.parameter-resolution-actions output')).toHaveText('4K')
  await expect.poll(async () => sliderFill.evaluate((element) => Math.round(element.getBoundingClientRect().width))).toBe(221)

  await slider.evaluate((element) => (element as HTMLInputElement).blur())
  await page.screenshot({ path: testInfo.outputPath('figma-resolution-slider-max.png') })
})

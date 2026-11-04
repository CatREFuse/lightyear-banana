import { expect, test } from '@playwright/test'
import { installTestHost } from './hostFixture'

test('ComfyUI accepts multiple node IDs typed separately and preserves them after saving', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('mugen.settings.v1', JSON.stringify({
      activeConfigId: 'comfy-controls-audit',
      configs: [{
        id: 'comfy-controls-audit',
        name: 'ComfyUI controls audit',
        provider: 'comfyui',
        model: 'workflow-api-json',
        models: ['workflow-api-json'],
        apiKey: '',
        baseUrl: 'http://127.0.0.1:8000',
        enabled: true,
        comfyUi: {
          workflow: '{"12":{"class_type":"CLIPTextEncode","inputs":{"text":""}},"13":{"class_type":"CLIPTextEncode","inputs":{"text":""}}}',
          workflowNodes: [{ type: 'prompt', nodeIds: ['12'], key: 'text' }],
          timeoutMs: 180000
        }
      }],
      promptPresets: []
    }))
  })
  await page.goto('/')
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: /自定义 API/ }).click()
  await page.locator('.config-row').click()
  const nodeIds = page.getByLabel('节点 ID', { exact: true })
  await nodeIds.fill('')
  await nodeIds.pressSequentially('12,13', { delay: 80 })
  await expect(nodeIds).toHaveValue('12,13')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('mugen.settings.v1')!).configs[0].comfyUi.workflowNodes[0].nodeIds)).toEqual(['12', '13'])
  await page.locator('.config-row').click()
  await expect(nodeIds).toHaveValue('12, 13')
})

test('ratio menu supports keyboard selection, escape and tab dismissal', async ({ page }) => {
  await installTestHost(page)
  await page.goto('/')
  await expect(page.getByText('Photoshop 已连接')).toBeVisible()
  const trigger = page.locator('.ratio-trigger')
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  const menu = page.locator('.ratio-menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('option', { selected: true })).toBeFocused()
  await page.keyboard.press('End')
  await expect(menu.getByRole('option').last()).toBeFocused()
  await page.keyboard.press('Home')
  await expect(menu.getByRole('option').first()).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(menu.getByRole('option').nth(1)).toBeFocused()
  const selected = await menu.getByRole('option').nth(1).locator('strong').textContent()
  await page.keyboard.press('Enter')
  await expect(trigger).toHaveAttribute('aria-label', `比例：${selected}`)
  await expect(trigger).toBeFocused()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await trigger.press('ArrowUp')
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(trigger).toBeFocused()
  await trigger.press('ArrowDown')
  await page.keyboard.press('Tab')
  await expect(menu).toBeHidden()
  await expect(page.locator('.composer .select-field').filter({ hasText: '数量' }).locator('.select-trigger')).toBeFocused()
})

test('ratio menu fits a 260px panel and closes on an outside click', async ({ page }, testInfo) => {
  await installTestHost(page)
  await page.setViewportSize({ width: 260, height: 720 })
  await page.goto('/')
  await expect(page.getByText('Photoshop 已连接')).toBeVisible()
  await page.locator('.ratio-trigger').click()
  const menu = page.locator('.ratio-menu')
  await expect(menu).toBeVisible()
  await expect.poll(async () => {
    const bounds = await menu.boundingBox()
    return Boolean(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 260)
  }).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('ratio-menu-260.png'), animations: 'disabled' })
  await page.locator('.thread').click({ position: { x: 8, y: 8 } })
  await expect(menu).toBeHidden()
})

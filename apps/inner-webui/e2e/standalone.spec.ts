import { expect, test } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { createApimartFixtureServer, expectedApiKey } from '../../../scripts/apimart-smoke-server.mjs'

const catFixturePath = fileURLToPath(new URL('../../../public/mock-images/cats/cat-01.jpg', import.meta.url))
let apimartFixture: ReturnType<typeof createApimartFixtureServer>
let apimartBaseUrl = ''

test.beforeAll(async () => {
  apimartFixture = createApimartFixtureServer({ port: 0 })
  apimartBaseUrl = await apimartFixture.start()
})

test.afterAll(async () => {
  await apimartFixture.stop()
})

test.beforeEach(async ({ page }) => {
  apimartFixture.reset()
  await page.goto('/')
  await expect(page.getByRole('status', { name: '浏览器模式' })).toBeVisible()
})

test('browser creates and reloads APIMart config, then completes the network flow without Photoshop controls', async ({ page }) => {
  expect(await page.evaluate(() => Boolean(window.uxpHost))).toBe(false)

  await page.getByRole('button', { name: '设置' }).click()
  await expect(page.getByText('v0.2.0', { exact: true })).toBeVisible()
  await expect(page.getByText(/0\.3\.19/)).toHaveCount(0)
  await expect(page.getByText(/Build/)).toHaveCount(0)
  await page.getByRole('button', { name: '新建配置' }).click()
  const detail = page.getByLabel('配置详情')
  await detail.getByLabel('配置名称').fill('APIMart Browser')

  const providerField = detail.locator('.select-field').filter({ hasText: '供应商' })
  await providerField.locator('.select-trigger').click()
  await providerField.locator('.select-menu button').filter({ hasText: 'APIMart' }).click()
  await detail.getByLabel('API Key', { exact: true }).fill(expectedApiKey)
  await detail.getByLabel('Base URL').fill(apimartBaseUrl)
  await detail.getByRole('button', { name: '测试 API' }).click()
  await expect(detail.getByRole('button', { name: 'API 可用' })).toBeVisible()
  await detail.getByRole('button', { name: '保存' }).click()
  await expect(page.getByRole('button', { name: /APIMart Browser/ })).toBeVisible()

  await expect.poll(() => page.evaluate(() => {
    const raw = localStorage.getItem('mugen.settings.v1')
    if (!raw) return false
    const stored = JSON.parse(raw)
    return stored.configs?.some((config: { name?: string; baseUrl?: string }) => (
      config.name === 'APIMart Browser' && config.baseUrl?.startsWith('http://127.0.0.1:')
    ))
  })).toBe(true)

  await page.reload()
  await expect(page.getByRole('status', { name: '浏览器模式' })).toBeVisible()
  await page.getByRole('button', { name: '设置' }).click()
  await expect(page.getByRole('button', { name: /APIMart Browser/ })).toBeVisible()
  await page.getByRole('button', { name: '返回' }).click()

  const configField = page.locator('.composer .select-field').filter({ hasText: '接口' })
  await expect(configField.locator('.select-value')).toHaveText('APIMart Browser')

  await page.getByRole('button', { name: '添加参考' }).click()
  await expect(page.getByRole('button', { name: '可见图层', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '选区', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '当前选中图层', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '上传文件', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '剪贴板', exact: true })).toBeVisible()

  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: '上传文件', exact: true }).click()
  const chooser = await chooserPromise
  await chooser.setFiles(catFixturePath)
  await expect(page.getByRole('img', { name: '上传图片' })).toBeVisible()

  await page.getByPlaceholder('输入提示词，或输入 / 调用预设').fill('浏览器生成一张小猫海报')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect(page.getByRole('img', { name: '生成图 1' })).toBeVisible({ timeout: 10_000 })

  await expect(page.getByRole('button', { name: '切换置入方式' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '全画布置入', exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => Boolean(window.uxpHost))).toBe(false)

  const smokeState = await (await fetch(`${apimartBaseUrl}/__smoke/state`)).json()
  expect(smokeState).toMatchObject({ modelChecks: 1, uploads: 1, generations: 1, polls: 1 })
  expect(smokeState.imageDownloads).toBeGreaterThanOrEqual(1)
  expect(smokeState.lastGeneration).toMatchObject({
    prompt: '浏览器生成一张小猫海报',
    n: 1,
    image_urls: [`${apimartBaseUrl}/fixtures/cat.jpg`]
  })
  expect(smokeState.requests.map((entry: { phase: string }) => entry.phase)).toEqual(expect.arrayContaining([
    'models.list',
    'reference.upload',
    'generation.submit',
    'generation.poll',
    'image.download'
  ]))
})

import { expect, test } from '@playwright/test'
import { createApimartFixtureServer, expectedApiKey } from '../../utils/apimart-smoke-server.mjs'
import { installTestHost, readTestHostTrace } from './hostFixture'

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
  await installTestHost(page, { apimartBaseUrl, apiKey: expectedApiKey })
  await page.goto('/')
  await expect(page.getByText('Photoshop 已连接')).toBeVisible()
})

test('CCX bridge completes canvas capture, APIMart generation, cat download, and canvas placement', async ({ page }) => {
  await page.getByRole('button', { name: '添加参考' }).click()
  await page.getByRole('button', { name: '可见图层', exact: true }).click()
  await expect(page.getByRole('img', { name: '可见图层' })).toBeVisible()

  await page.getByRole('textbox', { name: '输入提示词，或输入 / 调用预设' }).fill('一张夏日音乐节海报')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const preview = page.getByRole('button', { name: '生成结果 1' })
  await expect(preview).toBeVisible({ timeout: 10_000 })
  await preview.click()
  const previewRegion = page.getByRole('region', { name: '图片预览' })
  await expect(previewRegion).toBeVisible()
  await expect.poll(async () => (await readTestHostTrace(page)).commands.some((entry) => entry.command === 'asset.readOriginal')).toBe(true)
  await expect(previewRegion.getByRole('img', { name: '生成结果 1' })).toBeVisible()
  await previewRegion.getByRole('button', { name: '下载' }).click()
  await expect.poll(async () => (await readTestHostTrace(page)).commands.some((entry) => entry.command === 'asset.save')).toBe(true)
  await expect(previewRegion).toBeVisible()
  await page.getByRole('button', { name: '关闭预览' }).click()
  await expect(previewRegion).toBeHidden()

  await page.locator('.result-card .place-primary').click()
  await expect(page.getByRole('status').getByText('已置入 Photoshop')).toBeVisible()

  const hostTrace = await readTestHostTrace(page)
  const commands = hostTrace.commands.map((entry) => entry.command)
  const captureIndex = commands.indexOf('canvas.captureVisible')
  const generationIndex = commands.indexOf('generation.start')
  const placementIndex = commands.indexOf('canvas.placeAsset')
  expect(captureIndex).toBeGreaterThan(-1)
  expect(generationIndex).toBeGreaterThan(captureIndex)
  expect(placementIndex).toBeGreaterThan(generationIndex)
  expect(hostTrace.captures).toEqual([expect.objectContaining({
    assetId: 'e2e-visible',
    source: 'visible',
    width: 640,
    height: 480
  })])
  expect(hostTrace.captures[0]?.previewBytes).toBeGreaterThan(100)
  expect(hostTrace.network.map((entry) => entry.phase)).toEqual(expect.arrayContaining([
    'reference.upload',
    'generation.submit',
    'generation.poll',
    'image.download',
    'workflow.completed'
  ]))
  expect(hostTrace.placements).toEqual([expect.objectContaining({
    assetId: 'e2e-result-1',
    target: { type: 'full-canvas' },
    previewUrl: `${apimartBaseUrl}/fixtures/cat.jpg`,
    layerName: 'Mugen 生成结果'
  })])

  const smokeState = await (await fetch(`${apimartBaseUrl}/__smoke/state`)).json()
  expect(smokeState).toMatchObject({ uploads: 1, generations: 1, polls: 1 })
  expect(smokeState.imageDownloads).toBeGreaterThanOrEqual(1)
  expect(smokeState.lastUpload).toMatchObject({ hasFile: true, contentType: 'multipart/form-data' })
  expect(smokeState.lastGeneration).toMatchObject({
    model: 'gpt-image-1',
    prompt: '一张夏日音乐节海报',
    n: 1,
    image_urls: [`${apimartBaseUrl}/fixtures/cat.jpg`]
  })
  expect(smokeState.requests.map((entry: { phase: string }) => entry.phase)).toEqual(expect.arrayContaining([
    'reference.upload',
    'generation.submit',
    'generation.poll',
    'image.download'
  ]))

  await page.getByRole('button', { name: '设置' }).click()
  await page.getByRole('button', { name: '清空' }).click()
  await page.getByRole('button', { name: '再次清空' }).click()
  await page.getByRole('button', { name: '返回' }).click()
  await expect(page.getByRole('region', { name: '当前对话' }).getByText('READY')).toBeVisible()
})

test('opens the real settings UI through the Host bridge', async ({ page }) => {
  await page.getByRole('button', { name: '设置' }).click()
  await expect(page.getByRole('button', { name: 'APIMart APIMart · gpt-image-1 启用' })).toBeVisible()
})

test('adds uploaded and clipboard images as references through the CCX host', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: '添加参考' }).click()
  await page.getByRole('button', { name: '上传文件', exact: true }).click()
  await expect(page.getByRole('img', { name: '上传图片' })).toBeVisible()

  await page.getByRole('button', { name: '添加参考' }).click()
  await page.getByRole('button', { name: '剪贴板', exact: true }).click()
  await expect(page.getByRole('img', { name: '剪贴板' })).toBeVisible()
  await expect(page.locator('.reference-thumb')).toHaveCount(2)
  await page.screenshot({ path: testInfo.outputPath('ccx-reference-images.png') })

  const commands = (await readTestHostTrace(page)).commands.map((entry) => entry.command)
  expect(commands).toContain('reference.pickFile')
  expect(commands).toContain('reference.readClipboard')
})

test('shows a thumbnail error, advances the timer, and opens the original image', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 480, height: 760 } })
  const page = await context.newPage()
  await installTestHost(page, { apimartBaseUrl, apiKey: expectedApiKey, generationDelayMs: 3_500, thumbnailUnavailable: true })
  await page.goto('/')
  await expect(page.getByText('Photoshop 已连接')).toBeVisible()

  await page.getByRole('textbox', { name: '输入提示词，或输入 / 调用预设' }).fill('异常缩略图验证')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const loading = page.locator('.loading-turn')
  await expect(loading).toBeVisible()
  await expect.poll(async () => Number((await loading.textContent())?.match(/(\d+)s/)?.[1] ?? 0), { timeout: 3_500 }).toBeGreaterThan(0)

  const unavailable = page.getByRole('status').filter({ hasText: '预览不可用' })
  await expect(unavailable).toBeVisible({ timeout: 10_000 })
  await page.screenshot({ path: testInfo.outputPath('thumbnail-unavailable.png') })
  await page.locator('.thumbnail-button').click()
  const previewRegion = page.getByRole('region', { name: '图片预览' })
  await expect(previewRegion.getByRole('img', { name: '生成结果 1' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('original-preview.png') })
  await context.close()
})

test('keeps concurrent generation tasks visible until both complete', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 480, height: 760 } })
  const page = await context.newPage()
  await installTestHost(page, { apimartBaseUrl, apiKey: expectedApiKey, generationDelayMs: 1_000 })
  await page.goto('/')
  const composer = page.getByRole('textbox', { name: '输入提示词，或输入 / 调用预设' })
  await composer.fill('并发任务一')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await composer.fill('并发任务二')
  await page.getByRole('button', { name: '发送', exact: true }).click()

  await expect(page.locator('.loading-turn')).toHaveCount(2)
  await expect(page.locator('.result-card')).toHaveCount(2, { timeout: 10_000 })
  await expect(page.getByText('并发任务一', { exact: true })).toBeVisible()
  await expect(page.getByText('并发任务二', { exact: true })).toBeVisible()
  await context.close()
})

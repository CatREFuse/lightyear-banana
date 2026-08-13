import { expect, test } from '@playwright/test'
import { createApimartFixtureServer, expectedApiKey } from '../../utils/apimart-smoke-server.mjs'
import { installTestHost, readTestHostTrace } from './hostFixture'

const providerNames = [
  'OpenAI',
  'i-mini',
  'Google Gemini',
  'APIMart',
  'ByteDance Seedream',
  'Alibaba Qwen',
  'Kuaishou Kling',
  'Black Forest Labs',
  '本地 ComfyUI',
  'Codex Image Server',
  '自定义模型'
]
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

test('restores prompt editing after the CCX WebView regains window focus', async ({ page }) => {
  const prompt = page.getByRole('textbox', { name: '输入提示词，或输入 / 调用预设' })
  await prompt.fill('窗口切换后')

  await prompt.evaluate((target) => {
    target.focus()
    window.dispatchEvent(new Event('blur'))
    target.blur()
    window.dispatchEvent(new Event('focus'))
  })

  await expect(prompt).toBeFocused()
  await prompt.pressSequentially('继续输入')
  await expect(prompt).toHaveValue('窗口切换后继续输入')

  await page.getByRole('button', { name: '设置' }).focus()
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'))
    ;(document.activeElement as HTMLElement | null)?.blur()
    window.dispatchEvent(new Event('focus'))
  })
  await expect(prompt).not.toBeFocused()
})

test('CCX exposes the complete shared Provider catalog', async ({ page }) => {
  await page.getByRole('button', { name: '设置' }).click()
  await page.getByRole('button', { name: 'APIMart APIMart · gpt-image-1 启用' }).click()
  const providerField = page.getByLabel('配置详情').locator('.select-field').filter({ hasText: '供应商' })
  await providerField.locator('.select-trigger').click()

  await expect(providerField.locator('.option-label')).toHaveText(providerNames)
})

test('adds uploaded, pasted, and dropped images as references through the CCX host', async ({ page }, testInfo) => {
  await expect(page.locator('input[data-browser-reference-input]')).toHaveCount(0)
  await page.getByRole('button', { name: '添加参考' }).click()
  await expect(page.getByRole('button', { name: '剪贴板', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '上传文件', exact: true })).toBeVisible()
  await page.getByRole('region', { name: '当前对话' }).click()
  await expect(page.getByRole('button', { name: '上传文件', exact: true })).toBeHidden()

  await page.getByRole('button', { name: '添加参考' }).click()
  await page.getByRole('button', { name: '上传文件', exact: true }).click()
  await expect(page.getByRole('img', { name: '上传图片' })).toBeVisible()

  const prompt = page.getByRole('textbox', { name: '输入提示词，或输入 / 调用预设' })
  await prompt.fill('保留的提示词')
  await prompt.evaluate((target) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="#d97706"/></svg>'
    ], '剪贴板图片.svg', { type: 'image/svg+xml' }))
    target.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }))
  })
  await expect(page.getByRole('img', { name: '剪贴板图片' })).toBeVisible()
  await expect(prompt).toHaveValue('保留的提示词')

  const htmlImagePastePrevented = await prompt.evaluate((target) => {
    const imageUrl = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64"><rect width="96" height="64" fill="#16a34a"/></svg>')}`
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        files: [],
        getData: () => '',
        items: [{
          kind: 'string',
          type: 'text/html',
          getAsString: (callback: (value: string) => void) => callback(`<img src="${imageUrl}">`)
        }]
      }
    })
    target.dispatchEvent(event)
    return event.defaultPrevented
  })
  expect(htmlImagePastePrevented).toBe(true)
  await expect(page.locator('.reference-thumb')).toHaveCount(3)
  await expect(prompt).toHaveValue('保留的提示词')

  const plainTextPastePrevented = await prompt.evaluate((target) => {
    const transfer = new DataTransfer()
    transfer.setData('text/plain', '普通文本')
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })
    target.dispatchEvent(event)
    return event.defaultPrevented
  })
  expect(plainTextPastePrevented).toBe(false)

  const deferredPlainTextPastePrevented = await prompt.evaluate((target) => {
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', {
      value: {
        files: [],
        getData: () => '',
        items: [{
          kind: 'string',
          type: 'text/plain',
          getAsString: (callback: (value: string) => void) => callback('补充文本')
        }]
      }
    })
    target.dispatchEvent(event)
    return event.defaultPrevented
  })
  expect(deferredPlainTextPastePrevented).toBe(true)
  await expect(prompt).toHaveValue('保留的提示词补充文本')

  const unreadableImagePastePrevented = await prompt.evaluate((target) => {
    const transfer = new DataTransfer()
    transfer.setData('text/html', '<img src="data:text/plain,not-an-image">')
    transfer.setData('text/plain', 'https://example.com/pasted-image.png')
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })
    target.dispatchEvent(event)
    return event.defaultPrevented
  })
  expect(unreadableImagePastePrevented).toBe(true)
  await expect(page.getByRole('alert')).toHaveText('无法读取剪贴板图片，请重新复制图片或保存后拖入')
  await expect(prompt).toHaveValue('保留的提示词补充文本')

  const composer = page.locator('.composer')
  await composer.evaluate((target) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="120"><rect width="80" height="120" fill="#2563eb"/></svg>'
    ], '拖入图片.svg', { type: 'image/svg+xml' }))
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  })
  await expect(page.getByText('松开添加参考图')).toBeVisible()
  await composer.evaluate((target) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([
      '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="120"><rect width="80" height="120" fill="#2563eb"/></svg>'
    ], '拖入图片.svg', { type: 'image/svg+xml' }))
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  })
  await expect(page.getByRole('img', { name: '上传图片：拖入图片.svg' })).toBeVisible()
  await expect(page.locator('.reference-thumb')).toHaveCount(4)
  await page.screenshot({ path: testInfo.outputPath('ccx-reference-images.png') })

  const commands = (await readTestHostTrace(page)).commands.map((entry) => entry.command)
  expect(commands).toContain('reference.pickFile')
  expect(commands.filter((command) => command === 'reference.importImageChunk').length).toBeGreaterThanOrEqual(2)
  expect(commands).not.toContain('reference.readClipboard')
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

test('upgrades a low-resolution generated thumbnail to a 1K conversation preview', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 480, height: 760 } })
  const page = await context.newPage()
  await installTestHost(page, { apimartBaseUrl, apiKey: expectedApiKey, lowResolutionResultThumbnail: true })
  await page.goto('/')

  await page.getByRole('textbox', { name: '输入提示词，或输入 / 调用预设' }).fill('高清缩略图验证')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const thumbnail = page.getByRole('img', { name: '生成结果 1' })
  await expect(thumbnail).toBeVisible({ timeout: 10_000 })
  await expect.poll(() => thumbnail.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(1024)
  await expect.poll(async () => (await readTestHostTrace(page)).commands.some((entry) => entry.command === 'asset.readOriginal')).toBe(true)

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

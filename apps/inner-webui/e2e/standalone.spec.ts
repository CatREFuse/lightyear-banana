import { expect, test, type Page } from '@playwright/test'
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
  await page.goto('/?host=uxp')
  await expect(page.getByRole('status', { name: '浏览器模式' })).toBeVisible()
})

async function useApimartBrowserConfig(page: Page, name: string) {
  await page.evaluate(({ apiKey, baseUrl, configName }) => {
    localStorage.setItem('mugen.settings.v1', JSON.stringify({
      activeConfigId: 'apimart-browser-smoke',
      configs: [{
        id: 'apimart-browser-smoke',
        name: configName,
        provider: 'apimart',
        model: 'gemini-3.1-flash-image-preview',
        models: ['gemini-3.1-flash-image-preview'],
        apiKey,
        baseUrl,
        usesOfficialBaseUrl: false,
        enabled: true
      }],
      generationHistory: [],
      promptPresets: []
    }))
  }, { apiKey: expectedApiKey, baseUrl: apimartBaseUrl, configName: name })
  await page.reload()
  await expect(page.getByRole('status', { name: '浏览器模式' })).toBeVisible()
  await expect(page.locator('.composer .select-field').filter({ hasText: '接口' }).locator('.select-value')).toHaveText(name)
}

async function walkCompleteFocusOrder(page: Page) {
  await page.evaluate(() => {
    const selector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[contenteditable="true"]',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',')
    document.querySelectorAll<HTMLElement>(selector).forEach((element, index) => {
      element.dataset.smokeFocusIndex = String(index)
    })
    document.body.tabIndex = -1
    document.body.focus()
  })

  const visited: Array<{ index: string; name: string }> = []
  let firstIndex = ''
  let closedCycle = false
  for (let step = 0; step < 100; step += 1) {
    await page.keyboard.press('Tab')
    const current = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null
      return {
        index: element?.dataset.smokeFocusIndex ?? '',
        name: (
          element?.getAttribute('aria-label')
          || element?.getAttribute('title')
          || element?.getAttribute('placeholder')
          || element?.textContent
          || element?.tagName
          || ''
        ).trim()
      }
    })
    if (!current.index) continue
    if (!firstIndex) firstIndex = current.index
    else if (current.index === firstIndex) {
      closedCycle = true
      break
    }
    expect(visited.some(({ index }) => index === current.index)).toBe(false)
    visited.push(current)
  }

  expect(closedCycle).toBe(true)
  return visited
}

test('URL parameters cannot enable CCX and browser capabilities omit the canvas ratio', async ({ page }) => {
  expect(await page.evaluate(() => Boolean(window.uxpHost))).toBe(false)

  await page.evaluate(() => {
    localStorage.setItem('mugen.settings.v1', JSON.stringify({
      activeConfigId: 'browser-runtime-boundary',
      configs: [{
        id: 'browser-runtime-boundary',
        name: 'Browser Runtime Boundary',
        provider: 'codex-image-server',
        model: 'gpt-image-2',
        models: ['gpt-image-2'],
        apiKey: '',
        baseUrl: '',
        usesOfficialBaseUrl: false,
        enabled: true
      }],
      generationHistory: [],
      promptPresets: []
    }))
  })
  await page.reload()
  await expect(page.getByRole('status', { name: '浏览器模式' })).toBeVisible()

  await page.locator('.ratio-trigger').click()
  await expect(page.getByText('画布比例', { exact: true })).toHaveCount(0)
  await expect(page.getByText('跟随当前画布', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: '设置' }).click()
  await page.getByRole('button', { name: /Browser Runtime Boundary/ }).click()
  const detail = page.getByLabel('配置详情')
  await expect(detail.getByText('画布比例', { exact: true })).toHaveCount(0)
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

test('browser surfaces a recoverable APIMart network error and retries it from the keyboard-submitted turn', async ({ page }) => {
  await useApimartBrowserConfig(page, 'APIMart Recovery')

  const focusOrder = await walkCompleteFocusOrder(page)
  expect(focusOrder.length).toBeGreaterThan(4)
  expect(focusOrder.slice(0, 2).map(({ name }) => name)).toEqual(['设置', '主题'])
  expect(focusOrder.map(({ name }) => name).join('\n')).not.toMatch(/Photoshop|可见图层|选区|当前选中图层|置入/)
  await page.keyboard.press('Control+Shift+P')
  await expect(page.getByRole('button', { name: '可见图层', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '全画布置入', exact: true })).toHaveCount(0)

  apimartFixture.failNextGeneration({ status: 422, message: 'Fixture generation rejected' })
  const prompt = page.getByPlaceholder('输入提示词，或输入 / 调用预设')
  await prompt.fill('验证浏览器可恢复网络错误')
  await prompt.press('Enter')

  const failedTurn = page.locator('.assistant-message.is-error').filter({ hasText: 'Fixture generation rejected' })
  await expect(failedTurn).toBeVisible()
  await expect(failedTurn.getByRole('button', { name: '重试' })).toBeVisible()
  await expect(page.getByRole('img', { name: /^生成图/ })).toHaveCount(0)
  expect(apimartFixture.state.requests).toEqual(expect.arrayContaining([
    expect.objectContaining({ phase: 'generation.submit', status: 422, result: 'fixture-error' })
  ]))

  await failedTurn.getByRole('button', { name: '重试' }).click()
  await expect(page.getByRole('img', { name: '生成图 1' })).toBeVisible({ timeout: 10_000 })
  expect(apimartFixture.state.requests.filter((entry: { phase: string }) => entry.phase === 'generation.submit')).toEqual([
    expect.objectContaining({ status: 422, result: 'fixture-error' }),
    expect.objectContaining({ status: 200 })
  ])
  expect(apimartFixture.state.imageDownloads).toBeGreaterThanOrEqual(1)
})

test('browser cancellation aborts the active APIMart poll and leaves no generated result', async ({ page }) => {
  await useApimartBrowserConfig(page, 'APIMart Cancellation')
  apimartFixture.delayNextPoll()

  await page.getByPlaceholder('输入提示词，或输入 / 调用预设').fill('验证浏览器取消生成')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  await expect.poll(() => apimartFixture.state.polls).toBe(1)

  await page.getByRole('button', { name: '取消', exact: true }).click()
  const canceledTurn = page.locator('.assistant-message.is-canceled')
  await expect(canceledTurn).toContainText('已取消生成')
  await expect(page.getByRole('img', { name: /^生成图/ })).toHaveCount(0)
  await expect.poll(() => apimartFixture.state.abortedRequests).toBe(1)

  expect(apimartFixture.state.requests).toEqual(expect.arrayContaining([
    expect.objectContaining({ phase: 'generation.submit', status: 200 }),
    expect.objectContaining({ phase: 'generation.poll', status: 499, result: 'aborted' })
  ]))
  expect(apimartFixture.state.imageDownloads).toBe(0)
})

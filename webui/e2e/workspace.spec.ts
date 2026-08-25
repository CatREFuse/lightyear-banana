import { expect, test, type Locator, type Page } from '@playwright/test'
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
  await expect(page.getByRole('heading', { name: 'iMini PS' })).toBeVisible()
})

test('keeps image previews inside the fixed-width workspace', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'panel-wide') {
    await page.getByRole('button', { name: '外观' }).click()
    await page.getByRole('button', { name: '浅色', exact: true }).click()
  }

  await page.getByRole('button', { name: '添加参考图' }).click()
  await page.getByRole('button', { name: '可见图层', exact: true }).click()
  await page.getByRole('img', { name: '可见图层' }).click()

  const preview = page.getByRole('region', { name: '图片预览' })
  await expect(preview).toBeVisible()
  await expect(preview.getByRole('dialog')).toBeVisible()
  const previewImage = preview.getByRole('img', { name: '可见图层' })
  await expect(previewImage).toBeVisible()
  await expect.poll(() => previewImage.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await expectPopupInsideWorkspace(page, '.preview-dialog')
  await expect.poll(() => preview.evaluate((element) => getComputedStyle(element).opacity)).toBe('1')
  await page.screenshot({ path: testInfo.outputPath('image-preview-bounds.png') })
})

async function openCustomApiConfigs(page: Page) {
  await page.getByRole('button', { name: /^自定义 API/ }).click()
  await expect(page.getByRole('heading', { name: '自定义 API' })).toBeVisible()
}

async function expectPopupInsideWorkspace(page: Page, selector: string) {
  await expect(page.locator(selector)).toBeVisible()
  await expect.poll(() => page.locator(selector).evaluate((popup) => {
    const shell = popup.closest('.mugen-shell')
    if (!shell) return 'missing-shell'

    const popupRect = popup.getBoundingClientRect()
    const shellRect = shell.getBoundingClientRect()
    const inside = popupRect.left >= shellRect.left
      && popupRect.top >= shellRect.top
      && popupRect.right <= shellRect.right
      && popupRect.bottom <= shellRect.bottom
    if (inside) return 'inside'
    const composerRect = popup.closest('.composer')?.getBoundingClientRect()
    const footerRect = popup.closest('.composer-footer')?.getBoundingClientRect()
    const wrapperRect = popup.closest('.parameter-wrap')?.getBoundingClientRect()
    const route = popup.closest('.route-shell')
    const workspace = popup.closest('.workspace-route')
    const routeRect = route?.getBoundingClientRect()
    const workspaceRect = workspace?.getBoundingClientRect()
    return JSON.stringify({
      popup: { left: popupRect.left, top: popupRect.top, right: popupRect.right, bottom: popupRect.bottom },
      shell: { left: shellRect.left, top: shellRect.top, right: shellRect.right, bottom: shellRect.bottom },
      composer: composerRect && { left: composerRect.left, right: composerRect.right, width: composerRect.width },
      footer: footerRect && { left: footerRect.left, right: footerRect.right, width: footerRect.width },
      wrapper: wrapperRect && { left: wrapperRect.left, right: wrapperRect.right, width: wrapperRect.width },
      route: routeRect && { left: routeRect.left, right: routeRect.right, width: routeRect.width, scrollLeft: route?.scrollLeft },
      workspace: workspaceRect && { left: workspaceRect.left, right: workspaceRect.right, width: workspaceRect.width, scrollLeft: workspace?.scrollLeft }
    })
  })).toBe('inside')
}

async function expectPopupAnchoredToTrigger(page: Page, popupSelector: string, trigger: Locator) {
  await expect.poll(async () => {
    const triggerRect = await trigger.boundingBox()
    return page.locator(popupSelector).evaluate((popup, triggerBox) => {
      if (!triggerBox) return 'missing-trigger'
      const surface = popup.closest('.composer')?.querySelector('.composer-surface')
      if (!surface) return 'missing-surface'
      const popupRect = popup.getBoundingClientRect()
      const surfaceRect = surface.getBoundingClientRect()
      const triggerRight = triggerBox.x + triggerBox.width
      const expectedRight = Math.min(surfaceRect.right, Math.max(triggerRight, surfaceRect.left + popupRect.width))
      return JSON.stringify({
        horizontalDelta: Math.round((popupRect.right - expectedRight) * 10) / 10,
        verticalGap: Math.round((triggerBox.y - popupRect.bottom) * 10) / 10
      })
    }, triggerRect)
  }).toBe(JSON.stringify({ horizontalDelta: 0, verticalGap: 8 }))
}

function sampleElementHeights(element: Locator) {
  return element.evaluate((target) => new Promise<Array<{ elapsed: number; height: number }>>((resolve) => {
    const samples: Array<{ elapsed: number; height: number }> = []
    const startedAt = performance.now()
    const sample = (now: number) => {
      samples.push({ elapsed: now - startedAt, height: target.getBoundingClientRect().height })
      if (now - startedAt >= 480) {
        resolve(samples)
        return
      }
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }))
}

test('CCX bridge completes canvas capture, APIMart generation, context-menu download, and canvas placement', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: '添加参考图' }).click()
  await page.getByRole('button', { name: '可见图层', exact: true }).click()
  await expect(page.getByRole('img', { name: '可见图层' })).toBeVisible()

  await page.getByRole('textbox', { name: '描述你想生成的画面，输入 / 调用常用提示词' }).fill('一张夏日音乐节海报')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const thumbnail = page.getByRole('img', { name: '生成结果 1' })
  await expect(thumbnail).toBeVisible({ timeout: 10_000 })
  const resultSummary = page.locator('.response-text').filter({ hasText: /^已生成 1 张/ })
  await expect(resultSummary).toHaveText('已生成 1 张 · gpt-image-1 · 1K · 自动 · 640x480')
  await expect(resultSummary).not.toHaveText(/·\s*$/)
  const completedTurn = resultSummary.locator('..')
  const elapsedTrigger = completedTurn.locator('.elapsed-trigger')
  await expect(elapsedTrigger.locator('.app-icon')).toHaveCount(1)
  await expect.poll(() => elapsedTrigger.evaluate((element) => {
    const icon = element.querySelector<HTMLElement>('.app-icon')!.getBoundingClientRect()
    const label = element.querySelector<HTMLElement>('span:last-child')!.getBoundingClientRect()
    return {
      iconHeight: Math.round(icon.height),
      iconWidth: Math.round(icon.width),
      centerOffset: Math.round(((icon.top + icon.height / 2) - (label.top + label.height / 2)) * 10) / 10,
      gap: Math.round((label.left - icon.right) * 10) / 10
    }
  })).toEqual({ iconHeight: 12, iconWidth: 12, centerOffset: 0, gap: 4 })
  await expect.poll(() => completedTurn.evaluate((element) => {
    const results = element.querySelector<HTMLElement>('.result-grid')!.getBoundingClientRect()
    const actions = element.querySelector<HTMLElement>('.response-actions')!.getBoundingClientRect()
    return actions.top >= results.bottom
  })).toBe(true)
  await expect.poll(() => resultSummary.evaluate((element) => (
    getComputedStyle(element.closest('.turn')!).opacity
  ))).toBe('1')
  await page.screenshot({ path: testInfo.outputPath('result-summary-parameters.png') })
  await thumbnail.click()
  const previewRegion = page.getByRole('region', { name: '图片预览' })
  await expect(previewRegion).toBeHidden()
  expect((await readTestHostTrace(page)).commands.some((entry) => entry.command === 'asset.readOriginal')).toBe(false)
  await thumbnail.click({ button: 'right' })
  await page.getByRole('menuitem', { name: '下载到本地' }).click()
  await expect.poll(async () => (await readTestHostTrace(page)).commands.some((entry) => entry.command === 'asset.save')).toBe(true)

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
    layerName: 'iMini PS 生成结果'
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

  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('button', { name: '清空' }).click()
  await page.getByRole('button', { name: '再次清空' }).click()
  await page.getByRole('button', { name: '返回' }).click()
  await expect(page.getByRole('region', { name: '当前对话' }).getByText('开始创作')).toBeVisible()
})

test('opens custom API management as a secondary settings page', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: '外观' }).click()
  await page.getByRole('button', { name: '浅色', exact: true }).click()
  await expect(page.locator('.mugen-shell')).toHaveClass(/mode-light/)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page.getByRole('button', { name: 'APIMart APIMart · gpt-image-1 启用' })).toHaveCount(0)
  await openCustomApiConfigs(page)
  await expect(page.getByRole('button', { name: 'APIMart APIMart · gpt-image-1 启用' })).toBeVisible()
  await page.waitForTimeout(220)
  await page.screenshot({ path: testInfo.outputPath('custom-api-secondary-page-light.png') })
  await page.getByRole('button', { name: 'APIMart APIMart · gpt-image-1 启用' }).click()
  await page.getByLabel('配置详情').getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByRole('heading', { name: '自定义 API' })).toBeVisible()
  await page.getByRole('button', { name: '返回' }).click()
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'APIMart APIMart · gpt-image-1 启用' })).toHaveCount(0)
})

test('matches the Figma history stepper and saves the Host retention limit', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: '外观' }).click()
  await page.getByRole('button', { name: '浅色', exact: true }).click()
  await expect(page.locator('.mugen-shell')).toHaveClass(/mode-light/)
  await page.getByRole('button', { name: '设置', exact: true }).click()

  const presetEntry = page.getByRole('button', { name: /^常用提示词/ })
  await expect.poll(() => presetEntry.evaluate((element) => {
    const icon = element.querySelector<HTMLElement>('.settings-row-icon')!
    const title = element.querySelector<HTMLElement>('strong')!
    const iconRect = icon.getBoundingClientRect()
    const titleRect = title.getBoundingClientRect()
    return Math.abs((iconRect.top + iconRect.height / 2) - (titleRect.top + titleRect.height / 2))
  })).toBeLessThanOrEqual(0.5)
  await expect(page.getByText('在 iMini → 个人设置 → API 中可找到', { exact: true })).toHaveCount(0)
  await expect.poll(() => page.locator('.imini-quick-body').evaluate((element) => {
    const heading = element.querySelector<HTMLElement>('.imini-quick-heading')!
    const form = element.querySelector<HTMLElement>('.imini-quick-form')!
    return Math.round(form.getBoundingClientRect().top - heading.getBoundingClientRect().bottom)
  })).toBe(4)
  await expect.poll(() => page.locator('.imini-quick-card').evaluate((element) => {
    const body = element.querySelector<HTMLElement>('.imini-quick-body')!
    const form = element.querySelector<HTMLElement>('.imini-quick-form')!
    const input = form.querySelector<HTMLInputElement>('input')!
    const icon = element.querySelector<HTMLElement>('.imini-quick-icon')!
    const cardBounds = element.getBoundingClientRect()
    const bodyBounds = body.getBoundingClientRect()
    const formBounds = form.getBoundingClientRect()
    const inputBounds = input.getBoundingClientRect()
    const iconBounds = icon.getBoundingClientRect()
    return {
      bodyRightGap: Math.round(cardBounds.right - bodyBounds.right),
      bodyWidthDelta: Math.round(bodyBounds.width - (cardBounds.width - iconBounds.width - 12)),
      formWidthDelta: Math.round(formBounds.width - bodyBounds.width),
      inputWidthDelta: Math.round(inputBounds.width - formBounds.width)
    }
  })).toEqual({ bodyRightGap: 0, bodyWidthDelta: 0, formWidthDelta: 0, inputWidthDelta: 0 })

  const stepper = page.getByRole('group', { name: '生成记录保存条数' })
  await expect(page.getByText('超过设定上限的生成记录会被删除')).toBeVisible()
  await expect(stepper.locator('output')).toHaveText('30')
  await expect.poll(() => stepper.evaluate((element) => {
    const value = element.querySelector('output')!
    const button = element.querySelector('button')!
    return {
      width: element.getBoundingClientRect().width,
      height: element.getBoundingClientRect().height,
      valueWidth: value.getBoundingClientRect().width,
      valueHeight: value.getBoundingClientRect().height,
      buttonWidth: button.getBoundingClientRect().width,
      buttonHeight: button.getBoundingClientRect().height
    }
  })).toEqual({ width: 72, height: 32, valueWidth: 18, valueHeight: 24, buttonWidth: 24, buttonHeight: 24 })

  await page.waitForTimeout(300)
  await page.screenshot({ path: testInfo.outputPath('figma-history-stepper.png') })

  await stepper.getByRole('button', { name: '减少生成记录保存条数' }).click()
  await expect(stepper.locator('output')).toHaveText('29')
  await expect.poll(async () => (await readTestHostTrace(page)).commands
    .filter((entry) => entry.command === 'settings.save')
    .at(-1)?.payload).toMatchObject({ historyLimit: 29 })

})

test('iMini shortcut keeps Host settings unchanged until the legacy save action', async ({ page }) => {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('textbox', { name: 'iMini API Key' }).fill('host-draft-imini-token')
  await page.getByRole('button', { name: '继续', exact: true }).click()

  const detail = page.getByLabel('配置详情')
  await expect(detail.getByLabel('Base URL')).toHaveValue('https://openapi.imini.ai/imini/router')
  await expect(detail.getByLabel('API Key', { exact: true })).toHaveValue('host-draft-imini-token')

  const commands = (await readTestHostTrace(page)).commands.map((entry) => entry.command)
  expect(commands).not.toContain('settings.save')
  expect(commands).not.toContain('credential.set')

  await detail.getByRole('button', { name: '保存', exact: true }).click()
  await expect.poll(async () => (await readTestHostTrace(page)).commands.map((entry) => entry.command)).toEqual(
    expect.arrayContaining(['credential.set', 'settings.save'])
  )
})

test('restores prompt editing after the CCX WebView regains window focus', async ({ page }) => {
  const prompt = page.getByRole('textbox', { name: '描述你想生成的画面，输入 / 调用常用提示词' })
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

  await page.getByRole('button', { name: '设置', exact: true }).focus()
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'))
    ;(document.activeElement as HTMLElement | null)?.blur()
    window.dispatchEvent(new Event('focus'))
  })
  await expect(prompt).not.toBeFocused()
})

test('CCX exposes the complete shared Provider catalog', async ({ page }) => {
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await openCustomApiConfigs(page)
  await page.getByRole('button', { name: 'APIMart APIMart · gpt-image-1 启用' }).click()
  const providerField = page.getByLabel('配置详情').locator('.select-field').filter({ hasText: '供应商' })
  await providerField.locator('.select-trigger').click()

  await expect(providerField.locator('.option-label')).toHaveText(providerNames)
})

test('adds uploaded, pasted, and dropped images as references through the CCX host', async ({ page }, testInfo) => {
  await expect(page.locator('input[data-browser-reference-input]')).toHaveCount(0)
  await page.getByRole('button', { name: '添加参考图' }).click()
  await expect(page.getByRole('button', { name: '剪贴板', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '上传文件', exact: true })).toBeVisible()
  await page.getByRole('region', { name: '当前对话' }).click()
  await expect(page.getByRole('button', { name: '上传文件', exact: true })).toBeHidden()

  await page.getByRole('button', { name: '添加参考图' }).click()
  await page.getByRole('button', { name: '上传文件', exact: true }).click()
  await expect(page.getByRole('img', { name: '上传图片' })).toBeVisible()

  const prompt = page.getByRole('textbox', { name: '描述你想生成的画面，输入 / 调用常用提示词' })
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

test('keeps composer popups inside the fixed-width workspace', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: '外观' }).click()
  await page.getByRole('button', { name: '浅色', exact: true }).click()

  await page.getByRole('button', { name: '添加参考图' }).click()
  await expectPopupInsideWorkspace(page, '.reference-menu')
  await page.getByRole('button', { name: '可见图层', exact: true }).click()
  await expect(page.getByRole('img', { name: '可见图层' })).toBeVisible()
  await page.getByRole('button', { name: '添加参考图' }).click()
  await expectPopupInsideWorkspace(page, '.reference-menu')
  await expect.poll(() => page.locator('.mugen-shell').evaluate((shell) => shell.scrollLeft)).toBe(0)
  await page.screenshot({ path: testInfo.outputPath('reference-popup-in-workspace.png') })

  const presetTrigger = page.getByRole('button', { name: '预设提示词', exact: true })
  await presetTrigger.click()
  await expect(page.getByRole('listbox', { name: '预设提示词' })).toBeVisible()
  await expect(page.locator('.reference-menu')).toBeHidden()
  await expectPopupInsideWorkspace(page, '.prompt-preset-menu')
  await expect(page.locator('.parameter-panel')).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('preset-popup-in-workspace.png') })
  await presetTrigger.click()
  await expect(page.getByRole('listbox', { name: '预设提示词' })).toBeHidden()

  const parameterTrigger = page.getByRole('button', { name: '生成设置', exact: true })
  await parameterTrigger.click()
  await expectPopupInsideWorkspace(page, '.parameter-panel')
  await expectPopupAnchoredToTrigger(page, '.parameter-panel', parameterTrigger)
  await expect.poll(() => page.locator('.parameter-panel').evaluate((popup) => (
    Math.round(popup.getBoundingClientRect().width)
  ))).toBeGreaterThan(239)
  const mainMenuWidth = await page.locator('.parameter-panel').evaluate((popup) => (
    Math.round(popup.getBoundingClientRect().width)
  ))
  if (testInfo.project.name === 'panel-wide') {
    expect(mainMenuWidth).toBe(288)
  }

  await page.locator('.parameter-panel [data-route="config"]').click()
  await expect(page.getByText('选择供应商', { exact: true })).toBeVisible()
  await expectPopupInsideWorkspace(page, '.parameter-panel')
  await expect.poll(() => page.locator('.parameter-panel').evaluate((popup) => (
    Math.round(popup.getBoundingClientRect().width)
  ))).toBeGreaterThan(239)
  const submenuWidth = await page.locator('.parameter-panel').evaluate((popup) => (
    Math.round(popup.getBoundingClientRect().width)
  ))
  expect(submenuWidth).toBe(mainMenuWidth)

  await page.screenshot({ path: testInfo.outputPath('composer-popups-in-workspace.png') })
})

test('navigates parameter choices inside the popup menu', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: '生成设置', exact: true }).click()
  const menu = page.getByRole('region', { name: '生成设置' })
  await expect(menu).toBeVisible()

  const mainRatioTrigger = menu.getByRole('button', { name: /^比例/ })
  await expect(mainRatioTrigger).toHaveClass(/generation-settings-item/)
  await mainRatioTrigger.hover()
  await expect(mainRatioTrigger).toHaveCSS('padding-top', '4px')
  await expect(mainRatioTrigger).toHaveCSS('padding-left', '4px')
  await expect(mainRatioTrigger).toHaveCSS('padding-right', '4px')
  await expect(mainRatioTrigger).toHaveCSS('padding-bottom', '4px')
  await expect.poll(() => mainRatioTrigger.evaluate((button) => {
    const icon = button.querySelector<HTMLElement>('.generation-settings-item-icon')?.getBoundingClientRect()
    const title = button.querySelector<HTMLElement>('.generation-settings-item-title')?.getBoundingClientRect()
    if (!icon || !title) return Number.POSITIVE_INFINITY
    return Math.abs((icon.top + icon.height / 2) - (title.top + title.height / 2))
  })).toBeLessThanOrEqual(0.5)
  await page.screenshot({ path: testInfo.outputPath('parameter-menu-main-hover.png') })
  const forwardHeightSamples = sampleElementHeights(menu)
  await mainRatioTrigger.click()
  await expect.poll(() => menu.evaluate((element) => element.getAnimations().some((animation) => (
    animation.effect instanceof KeyframeEffect
      && animation.effect.getKeyframes().some((keyframe) => typeof keyframe.height === 'string')
  ))), { intervals: [16], timeout: 1_000 }).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('parameter-menu-height-transition.png') })
  await expect(menu.getByText('生成图片比例', { exact: true })).toBeVisible()
  await expect(menu.getByRole('button', { name: '返回', exact: true })).toBeVisible()
  await expect(menu.locator('.parameter-submenu-option[aria-checked="true"]')).toHaveCount(1)
  const recommendedRatioOption = menu.getByRole('radio', { name: /^原图比例/ })
  await expect(recommendedRatioOption).toHaveClass(/generation-settings-item/)
  await recommendedRatioOption.hover()
  await expect(recommendedRatioOption).toHaveCSS('padding-top', '4px')
  await expect(recommendedRatioOption).toHaveCSS('padding-left', '4px')
  await expect(recommendedRatioOption).toHaveCSS('padding-right', '4px')
  await expect(recommendedRatioOption).toHaveCSS('padding-bottom', '4px')
  await expect.poll(() => recommendedRatioOption.evaluate((button) => {
    const icon = button.querySelector<HTMLElement>('.generation-settings-item-icon')?.getBoundingClientRect()
    const title = button.querySelector<HTMLElement>('.generation-settings-item-title')?.getBoundingClientRect()
    if (!icon || !title) return Number.POSITIVE_INFINITY
    return Math.abs((icon.top + icon.height / 2) - (title.top + title.height / 2))
  })).toBeLessThanOrEqual(0.5)
  const recommendedBadge = recommendedRatioOption.locator('.generation-settings-item-badge')
  await expect(recommendedBadge).toHaveText('推荐')
  await expect(recommendedBadge.locator('xpath=..')).toHaveClass(/generation-settings-item-title-line/)
  await expect(recommendedBadge.locator('xpath=preceding-sibling::*[1]')).toHaveClass(/generation-settings-item-title/)
  const submenuScroll = menu.locator('.parameter-submenu-scroll')
  await expect.poll(() => submenuScroll.evaluate((element) => getComputedStyle(element, '::-webkit-scrollbar').width)).toBe('4px')
  await expect.poll(() => submenuScroll.evaluate((element) => getComputedStyle(element, '::-webkit-scrollbar-track').backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  const scrollBefore = await menu.evaluate((element) => {
    const back = element.querySelector<HTMLElement>('.parameter-back-button')!.getBoundingClientRect()
    const title = element.querySelector<HTMLElement>('.parameter-submenu-title')!.getBoundingClientRect()
    return { backTop: back.top, titleTop: title.top }
  })
  await submenuScroll.evaluate((element) => { element.scrollTop = 64 })
  await expect.poll(() => submenuScroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  const scrollAfter = await menu.evaluate((element) => {
    const back = element.querySelector<HTMLElement>('.parameter-back-button')!.getBoundingClientRect()
    const title = element.querySelector<HTMLElement>('.parameter-submenu-title')!.getBoundingClientRect()
    return { backTop: back.top, titleTop: title.top }
  })
  expect(Math.abs(scrollAfter.backTop - scrollBefore.backTop)).toBeLessThanOrEqual(0.5)
  expect(scrollAfter.titleTop).toBeLessThan(scrollBefore.titleTop - 8)
  await expect(menu.locator('.select-menu, .ratio-menu')).toHaveCount(0)
  await expectPopupInsideWorkspace(page, '.parameter-panel')
  const forwardHeightTimeline = await forwardHeightSamples
  const sampledHeights = forwardHeightTimeline.map((sample) => sample.height)
  const heightFloor = Math.min(sampledHeights[0] ?? 0, sampledHeights.at(-1) ?? 0)
  const heightCeiling = Math.max(sampledHeights[0] ?? 0, sampledHeights.at(-1) ?? 0)
  expect(Math.min(...sampledHeights)).toBeGreaterThanOrEqual(heightFloor - 1)
  expect(Math.max(...sampledHeights)).toBeLessThanOrEqual(heightCeiling + 1)
  expect(sampledHeights.some((height) => height > heightFloor + 1 && height < heightCeiling - 1)).toBe(true)
  expect(sampledHeights.some((height, index) => index > 0 && height < sampledHeights[index - 1]! - 1)).toBe(false)
  expect(forwardHeightTimeline.find((sample) => Math.abs(sample.height - (sampledHeights[0] ?? 0)) > 1)?.elapsed).toBeLessThan(80)
  await page.screenshot({ path: testInfo.outputPath('parameter-menu-ratio-route.png') })

  const ratioOption = menu.getByRole('radio', { name: /^4:3/ })
  const backwardHeightSamples = sampleElementHeights(menu)
  await ratioOption.click()
  await expect.poll(() => menu.evaluate((element) => element.getAnimations().some((animation) => (
    animation.effect instanceof KeyframeEffect
      && animation.effect.getKeyframes().some((keyframe) => typeof keyframe.height === 'string')
  ))), { intervals: [16], timeout: 1_000 }).toBe(true)
  await page.screenshot({ path: testInfo.outputPath('parameter-menu-height-decrease.png') })
  const ratioTrigger = menu.getByRole('button', { name: /^比例 4:3/ })
  await expect(ratioTrigger).toBeVisible()
  await expect(ratioTrigger).toBeFocused()
  const backwardHeightTimeline = await backwardHeightSamples
  const sampledBackwardHeights = backwardHeightTimeline.map((sample) => sample.height)
  const backwardHeightFloor = Math.min(sampledBackwardHeights[0] ?? 0, sampledBackwardHeights.at(-1) ?? 0)
  const backwardHeightCeiling = Math.max(sampledBackwardHeights[0] ?? 0, sampledBackwardHeights.at(-1) ?? 0)
  expect(Math.min(...sampledBackwardHeights)).toBeGreaterThanOrEqual(backwardHeightFloor - 1)
  expect(Math.max(...sampledBackwardHeights)).toBeLessThanOrEqual(backwardHeightCeiling + 1)
  expect(sampledBackwardHeights.some((height) => (
    height > backwardHeightFloor + 1 && height < backwardHeightCeiling - 1
  ))).toBe(true)
  expect(sampledBackwardHeights.some((height, index) => (
    index > 0 && height > sampledBackwardHeights[index - 1]! + 1
  ))).toBe(false)
  expect(backwardHeightTimeline.find((sample) => (
    Math.abs(sample.height - (sampledBackwardHeights[0] ?? 0)) > 1
  ))?.elapsed).toBeLessThan(80)

  await menu.getByRole('button', { name: /^模型/ }).click()
  await expect(menu.getByText('选择模型', { exact: true })).toBeVisible()
  await menu.getByRole('button', { name: '返回', exact: true }).click()
  const modelTrigger = menu.getByRole('button', { name: /^模型/ })
  await expect(modelTrigger).toBeVisible()
  await expect(modelTrigger).toBeFocused()

  await page.screenshot({ path: testInfo.outputPath('parameter-menu-internal-route.png') })
  await page.locator('.thread').click({ position: { x: 8, y: 8 } })
  await expect(menu).toBeHidden()
})

test('shows a thumbnail error without opening the original image on click', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 480, height: 760 } })
  const page = await context.newPage()
  await installTestHost(page, { apimartBaseUrl, apiKey: expectedApiKey, generationDelayMs: 3_500, thumbnailUnavailable: true })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'iMini PS' })).toBeVisible()

  await page.getByRole('textbox', { name: '描述你想生成的画面，输入 / 调用常用提示词' }).fill('异常缩略图验证')
  await page.getByRole('button', { name: '发送', exact: true }).click()
  const loading = page.locator('.loading-turn')
  await expect(loading).toBeVisible()
  await expect.poll(async () => Number((await loading.textContent())?.match(/(\d+)s/)?.[1] ?? 0), { timeout: 3_500 }).toBeGreaterThan(0)

  const unavailable = page.getByRole('status').filter({ hasText: '预览不可用' })
  await expect(unavailable).toBeVisible({ timeout: 10_000 })
  await expect(unavailable).toContainText('原图仍可用')
  await page.screenshot({ path: testInfo.outputPath('thumbnail-unavailable.png') })
  await unavailable.click()
  const previewRegion = page.getByRole('region', { name: '图片预览' })
  await expect(previewRegion).toBeHidden()
  expect((await readTestHostTrace(page)).commands.some((entry) => entry.command === 'asset.readOriginal')).toBe(false)
  await context.close()
})

test('constrains completed landscape and portrait thumbnails by orientation', async ({ browser }, testInfo) => {
  for (const orientation of ['landscape', 'portrait'] as const) {
    const context = await browser.newContext({ viewport: { width: 480, height: 760 } })
    const page = await context.newPage()
    await installTestHost(page, { apimartBaseUrl, apiKey: expectedApiKey, generatedResultOrientation: orientation })
    await page.goto('/')

    await page.getByRole('textbox', { name: '描述你想生成的画面，输入 / 调用常用提示词' }).fill(`${orientation} 缩略图验证`)
    await page.getByRole('button', { name: '发送', exact: true }).click()
    const thumbnail = page.getByRole('img', { name: '生成结果 1' })
    await expect(thumbnail).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.loading-turn')).toHaveCount(0)
    await thumbnail.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)

    const rect = await thumbnail.evaluate((image) => {
      const bounds = image.getBoundingClientRect()
      return { height: bounds.height, width: bounds.width }
    })
    if (orientation === 'landscape') {
      expect(rect.height).toBeLessThanOrEqual(160)
    } else {
      expect(rect.width).toBeLessThanOrEqual(160)
    }
    const layout = await page.locator('.result-card').evaluate((card) => {
      const grid = card.parentElement
      const frame = card.querySelector<HTMLElement>('.thumbnail-button')
      const image = card.querySelector<HTMLImageElement>('img')
      const message = card.closest<HTMLElement>('.assistant-message')
      if (!grid || !frame || !image || !message) throw new Error('Completed result layout is incomplete.')
      return {
        cardBackground: getComputedStyle(card).backgroundColor,
        frameBackground: getComputedStyle(frame).backgroundColor,
        cardWidth: card.getBoundingClientRect().width,
        frameWidth: frame.getBoundingClientRect().width,
        gridWidth: grid.getBoundingClientRect().width,
        imageWidth: image.getBoundingClientRect().width,
        messageWidth: message.getBoundingClientRect().width
      }
    })
    expect(layout.cardBackground).toBe('rgba(0, 0, 0, 0)')
    expect(layout.frameBackground).toBe('rgba(0, 0, 0, 0)')
    expect(Math.abs(layout.frameWidth - layout.imageWidth)).toBeLessThanOrEqual(2)
    expect(Math.abs(layout.cardWidth - layout.imageWidth)).toBeLessThanOrEqual(2)
    expect(Math.abs(layout.gridWidth - layout.cardWidth)).toBeLessThanOrEqual(2)
    expect(layout.gridWidth).toBeLessThan(layout.messageWidth)
    await page.screenshot({ path: testInfo.outputPath(`completed-${orientation}-thumbnail.png`) })
    await context.close()
  }
})

test('matches the Figma loading-state dimensions and hierarchy', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 402, height: 874 }, colorScheme: 'light' })
  const page = await context.newPage()
  await installTestHost(page, { apimartBaseUrl, apiKey: expectedApiKey, generationDelayMs: 4_000 })
  await page.goto('/')
  await page.getByRole('button', { name: '外观' }).click()
  await page.getByRole('button', { name: '浅色', exact: true }).click()

  await page.getByRole('textbox', { name: '描述你想生成的画面，输入 / 调用常用提示词' }).fill('Figma 加载状态验证')
  await page.getByRole('button', { name: '发送', exact: true }).click()

  const loading = page.locator('.loading-turn')
  await expect(loading.locator('.loading-status-row')).toContainText('正在生成...')
  await expect(loading.locator('.loading-model-row')).toContainText('/')
  const placeholder = loading.locator('.loading-placeholder').first()
  await expect(placeholder).toBeVisible()
  await expect.poll(() => placeholder.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { width: rect.width, height: rect.height, radius: getComputedStyle(element).borderRadius }
  })).toEqual({ width: 160, height: 209, radius: '8px' })
  await expect.poll(() => loading.locator('.loading-message').evaluate((element) => {
    const style = getComputedStyle(element)
    return { background: style.backgroundColor, border: style.borderTopWidth, gap: style.rowGap }
  })).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '0px', gap: '12px' })
  await expect(page.locator('.operation-status')).toHaveCount(0)

  await page.waitForTimeout(300)
  await page.screenshot({ path: testInfo.outputPath('figma-loading-state.png') })
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await context.close()
})

test('upgrades a low-resolution generated thumbnail to a 1K conversation preview', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 480, height: 760 } })
  const page = await context.newPage()
  await installTestHost(page, { apimartBaseUrl, apiKey: expectedApiKey, lowResolutionResultThumbnail: true })
  await page.goto('/')

  await page.getByRole('textbox', { name: '描述你想生成的画面，输入 / 调用常用提示词' }).fill('高清缩略图验证')
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
  const composer = page.getByRole('textbox', { name: '描述你想生成的画面，输入 / 调用常用提示词' })
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

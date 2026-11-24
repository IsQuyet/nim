import { createTestImage } from '../test/media-fixtures'
import { mediaUploadResponseSchema } from '../modules/media/model'
import { createTestDraft, publishTestDraft } from '../test/post-commands'
import { test, expect, withWritingStore } from './fixtures'

let pngBytes: Buffer

test.beforeAll(async () => {
  pngBytes = await createTestImage('png', '#336699')
})

test('跨内容站内搜索支持页头 Ctrl+K 弹窗与独立 /search 页面，且隔离草稿内容', async ({ page, browser, login, runtime }) => {
  await withWritingStore(runtime, async writer => {
    await createTestDraft(writer, {
      title: 'Private Secret Draft',
      description: 'Hidden',
      body: 'SecretDraftKeyword only visible to drafts.',
    })
    const live = await createTestDraft(writer, {
      title: '记账数据与 Next.js',
      description: '公开文章关于 Next.js 与个人记账。',
      body: '这里详细讨论 记账 数据迁移与 Next.js 渲染边界。',
    })
    return publishTestDraft(writer, live)
  })

  await login()
  await page.goto('/admin/gallery')
  const upload = page.waitForResponse(
    response => response.url().endsWith('/api/admin/media') && response.request().method() === 'POST',
  )
  await page.getByLabel('Upload new image', { exact: true }).setInputFiles({
    name: 'kyoto.png',
    mimeType: 'image/png',
    buffer: pngBytes,
  })
  const uploaded = mediaUploadResponseSchema.parse(await (await upload).json())
  expect(uploaded.status).toBe('success')
  await page.getByLabel('Title', { exact: true }).fill('Kyoto Walk')
  await page.getByLabel('Caption', { exact: true }).fill('Next.js conference trip notes')
  await page.getByLabel('Location', { exact: true }).fill('Kyoto')
  await page.getByRole('button', { name: 'Publish photo', exact: true }).click()
  await expect(page.getByText('Gallery item published.', { exact: true })).toBeVisible()

  const visitor = await browser.newContext()
  try {
    const reader = await visitor.newPage()
    await reader.setViewportSize({ width: 1280, height: 800 })
    await reader.goto(`${runtime.origin}/`)

    // Ctrl+K 打开快速搜索面板并搜中文短词 "记账"
    await reader.keyboard.press('Control+k')
    const dialog = reader.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const input = dialog.getByLabel('Search posts and photos', { exact: true })
    await input.fill('记账')
    await expect(dialog.getByRole('link', { name: /记账数据与 Next\.js/ })).toBeVisible()
    await expect(dialog.getByText('SecretDraftKeyword')).toHaveCount(0)

    // 改搜跨内容词 "Next.js"，应同时出现 Post 和 Gallery
    await input.fill('Next.js')
    await expect(dialog.getByRole('button', { name: /All \(2\)/ })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /Posts \(1\)/ })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /Gallery \(1\)/ })).toBeVisible()

    // 跳转到独立 /search 页面并在手机宽度验证无横向溢出与范围筛选
    await dialog.getByRole('link', { name: /Open search page/ }).click()
    await expect(reader).toHaveURL(/\/search\?q=Next\.js/)
    await expect(reader.getByRole('heading', { name: 'Search', level: 1 })).toBeVisible()

    await reader.setViewportSize({ width: 390, height: 800 })
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    await reader.getByRole('link', { name: /^Gallery \(1\)/ }).click()
    await expect(reader).toHaveURL(/type=gallery/)
    await reader.getByRole('link', { name: /Kyoto Walk/ }).click()
    await expect(reader).toHaveURL(/\/gallery\/[0-9a-f-]+$/)
    await expect(reader.getByRole('heading', { name: 'Kyoto Walk', level: 1 })).toBeVisible()
  } finally {
    await visitor.close()
  }
})

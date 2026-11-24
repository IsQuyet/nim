import { createTestImage } from '../test/media-fixtures'
import { mediaUploadResponseSchema } from '../modules/media/model'
import { test, expect } from './fixtures'

let pngOne: Buffer
let pngTwo: Buffer

test.beforeAll(async () => {
  pngOne = await createTestImage('png', '#224466')
  pngTwo = await createTestImage('png', '#664422')
})

test('画廊从草稿到公开灯箱与详情页，以及首页独立策展控制端到端闭环', async ({ page, browser, login, runtime }) => {
  await login()
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/admin/gallery')
  await expect(page.getByRole('heading', { name: 'Gallery', level: 1 })).toBeVisible()

  // 上传第一张图片并先存为草稿，验证匿名访问隔离。
  const uploadFirst = page.waitForResponse(
    response => response.url().endsWith('/api/admin/media') && response.request().method() === 'POST',
  )
  await page.getByLabel('Upload new image', { exact: true }).setInputFiles({
    name: 'harbor.png',
    mimeType: 'image/png',
    buffer: pngOne,
  })
  const firstUploadResponse = await uploadFirst
  expect(firstUploadResponse.status()).toBe(200)
  const firstMedia = mediaUploadResponseSchema.parse(await firstUploadResponse.json())
  if (firstMedia.status !== 'success') throw new Error('Expected upload to succeed.')

  await page.getByLabel('Title', { exact: true }).fill('Harbor Dawn')
  await page.getByLabel('Caption', { exact: true }).fill('Morning fog by the pier.')
  await page.getByLabel('Location', { exact: true }).fill('Kobe')
  await page.getByLabel('Date taken', { exact: true }).fill('2026-10-12')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByText('Gallery draft saved.', { exact: true })).toBeVisible()

  const anonymous = await browser.newContext()
  try {
    expect((await anonymous.request.get(`${runtime.origin}${firstMedia.media.url}`)).status()).toBe(404)
    const galleryPage = await anonymous.newPage()
    await galleryPage.goto(`${runtime.origin}/gallery`)
    await expect(galleryPage.getByText('No photos yet.', { exact: true })).toBeVisible()
  } finally {
    await anonymous.close()
  }

  // 在列表里将 Harbor Dawn 发布，并新增发布第二张图片 Night Tram。
  const list = page.getByRole('list', { name: 'Gallery items' })
  await list.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByText('Gallery item published.', { exact: true })).toBeVisible()

  const uploadSecond = page.waitForResponse(
    response => response.url().endsWith('/api/admin/media') && response.request().method() === 'POST',
  )
  await page.getByLabel('Upload new image', { exact: true }).setInputFiles({
    name: 'tram.png',
    mimeType: 'image/png',
    buffer: pngTwo,
  })
  expect((await uploadSecond).status()).toBe(200)

  await page.getByLabel('Title', { exact: true }).fill('Night Tram')
  await page.getByLabel('Caption', { exact: true }).fill('Reflections after rain.')
  await page.getByLabel('Location', { exact: true }).fill('Sapporo')
  await page.getByRole('button', { name: 'Publish photo', exact: true }).click()
  await expect(page.getByText('Gallery item published.', { exact: true })).toBeVisible()

  // 公开访客浏览 /gallery，测试手机端无横向滚动、灯箱键盘切换和详情页。
  const reader = await browser.newContext()
  try {
    const publicPage = await reader.newPage()
    await publicPage.setViewportSize({ width: 390, height: 800 })
    await publicPage.goto(`${runtime.origin}/gallery`)
    expect(await publicPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

    await publicPage.setViewportSize({ width: 1280, height: 800 })
    await expect(publicPage.getByRole('link', { name: 'Harbor Dawn', exact: true })).toBeVisible()
    await expect(publicPage.getByRole('link', { name: 'Night Tram', exact: true })).toBeVisible()

    await publicPage.getByRole('button', { name: 'Preview Night Tram', exact: true }).click()
    const dialog = publicPage.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('1 / 2', { exact: true })).toBeVisible()
    await publicPage.keyboard.press('ArrowRight')
    await expect(dialog.getByText('2 / 2', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Harbor Dawn' })).toBeVisible()

    await dialog.getByRole('link', { name: 'Open detail page', exact: true }).click()
    await expect(publicPage).toHaveURL(/\/gallery\/[0-9a-f-]+$/)
    await expect(publicPage.getByRole('heading', { name: 'Harbor Dawn', level: 1 })).toBeVisible()
    await expect(publicPage.getByText('Morning fog by the pier.', { exact: true })).toBeVisible()

    const sitemapResponse = await reader.request.get(`${runtime.origin}/sitemap.xml`)
    expect(sitemapResponse.status()).toBe(200)
    const sitemapXml = await sitemapResponse.text()
    expect(sitemapXml).toContain('/gallery</loc>')
    expect(sitemapXml).toContain('/gallery/')
  } finally {
    await reader.close()
  }

  // 管理员通过 /admin/home 单独控制首页条目与区块显隐。
  await page.goto('/admin/home')
  await expect(page.getByRole('heading', { name: 'Homepage', level: 1 })).toBeVisible()

  await page.getByLabel('Selection mode', { exact: true }).nth(1).selectOption('manual')
  await page.getByLabel('Choose gallery entry to add', { exact: true }).selectOption({ label: 'Harbor Dawn' })
  await page.getByRole('button', { name: 'Add entry', exact: true }).nth(1).click()

  const experienceSection = page.locator('section', { has: page.getByRole('heading', { name: 'experience' }) })
  await experienceSection.getByLabel('Show on homepage', { exact: true }).uncheck()

  await page.getByRole('button', { name: 'Save homepage', exact: true }).click()
  await expect(page.getByText('Homepage settings saved.', { exact: true })).toBeVisible()

  const homeReader = await browser.newContext()
  try {
    const homePage = await homeReader.newPage()
    await homePage.goto(`${runtime.origin}/`)
    const featuredGallery = homePage.getByRole('list', { name: 'Featured gallery' })
    await expect(featuredGallery.getByRole('link', { name: 'Harbor Dawn', exact: true })).toBeVisible()
    await expect(featuredGallery.getByRole('link', { name: 'Night Tram', exact: true })).toHaveCount(0)
    await expect(homePage.getByRole('heading', { name: 'Work experience' })).toHaveCount(0)

    await featuredGallery.getByRole('button', { name: 'Preview Harbor Dawn', exact: true }).click()
    await expect(homePage.getByRole('dialog')).toBeVisible()
    await homePage.keyboard.press('Escape')
    await expect(homePage.getByRole('dialog')).toBeHidden()
  } finally {
    await homeReader.close()
  }
})

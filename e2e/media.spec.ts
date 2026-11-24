import { type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { createTestImage } from '../test/media-fixtures'
import { eq } from 'drizzle-orm'
import { postIdSchema } from '../modules/posts/model'
import { mediaAssets } from '../modules/media/server/schema'
import { postPublicationMedia } from '../modules/posts/server/schema'
import { mediaUploadResponseSchema } from '../modules/media/model'
import { openDatabase } from '../lib/server/database'
import { test, expect, snapshot, withWritingStore } from './fixtures'
import { createTestDraft } from '../test/post-commands'

let pngBytes: Buffer

test.beforeAll(async () => { pngBytes = await createTestImage() })

async function localCopy(page: Page, postId: string) {
  return page.evaluate(async id => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('nim-writing-recovery')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<unknown | null>((resolve, reject) => {
        const transaction = database.transaction('copies', 'readonly')
        const request = transaction.objectStore('copies').index('postId').getAll(id)
        let result: unknown[] = []
        request.onsuccess = () => { result = request.result }
        request.onerror = () => reject(request.error)
        transaction.oncomplete = () => resolve(result.at(-1) ?? null)
        transaction.onabort = () => reject(transaction.error)
      })
    } finally { database.close() }
  }, postId)
}

test('上传图片在光标处插入原生 Markdown，仅发布时关联公开版本', async ({ page, browser, login, runtime }) => {
  await login()
  const draft = await withWritingStore(runtime, writer => createTestDraft(writer, { title: 'Image article', description: '', body: 'Before after' }))
  await page.goto(`/admin/posts/${draft.id}`)
  await expect(page.getByText('No unsaved changes.', { exact: true })).toBeVisible()
  const baseline = snapshot(runtime, draft.id)
  const body = page.getByRole('textbox', { name: 'Body', exact: true })
  await body.press('ControlOrMeta+End')

  await page.getByLabel('Choose image', { exact: true }).setInputFiles({
    name: 'tiny.png', mimeType: 'image/png', buffer: pngBytes,
  })
  await expect(page.getByText('tiny.png', { exact: true })).toBeVisible()
  const uploadResponse = page.waitForResponse(response => response.url().endsWith('/api/admin/media') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Upload and insert', exact: true }).click()
  const uploaded = await uploadResponse
  expect(uploaded.status()).toBe(200)
  const result = mediaUploadResponseSchema.parse(await uploaded.json())
  expect(result).toMatchObject({ status: 'success', media: { mediaType: 'image/webp', width: 2, height: 3 } })
  if (result.status !== 'success') throw new Error('The upload must succeed.')
  const mediaId = result.media.id
  const mediaUrl = result.media.url
  await expect(page.getByText('Recovery copy saved on this browser.', { exact: true })).toBeVisible()
  await expect(body).toContainText(mediaUrl)

  const copy = await localCopy(page, draft.id)
  expect(copy).toMatchObject({ content: { body: `Before after ![tiny](${mediaUrl})` } })
  expect(snapshot(runtime, draft.id)).toEqual(baseline)

  const anonymous = await browser.newContext()
  try {
    const privateResponse = await anonymous.request.get(`${runtime.origin}${mediaUrl}`)
    expect(privateResponse.status()).toBe(404)
    expect((await privateResponse.body()).byteLength).toBe(0)
  } finally { await anonymous.close() }

  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByText('Post published.', { exact: true })).toBeVisible()
  const published = snapshot(runtime, draft.id)
  expect(published.revisions.at(-1)?.body).toBe(`Before after ![tiny](${mediaUrl})`)

  await body.press('ControlOrMeta+Home')
  await expect(body.locator(`img[src="${mediaUrl}"]`)).toBeVisible()

  const publicReader = await browser.newContext()
  let storedBytes: Buffer
  try {
    const publicResponse = await publicReader.request.get(`${runtime.origin}${mediaUrl}`)
    expect(publicResponse.status()).toBe(200)
    expect(publicResponse.headers()['content-type']).toBe('image/webp')
    expect(publicResponse.headers()['x-content-type-options']).toBe('nosniff')
    storedBytes = await publicResponse.body()
    expect((await sharp(storedBytes).metadata()).format).toBe('webp')
    expect(await sharp(storedBytes).ensureAlpha().raw().toBuffer()).toEqual(await sharp(pngBytes).ensureAlpha().raw().toBuffer())
    const article = await publicReader.newPage()
    await article.goto(`${runtime.origin}/blog/${draft.id}`)
    const image = article.locator(`img[src="${mediaUrl}"]`)
    await expect(image).toBeVisible()
    await expect(image).toHaveAttribute('alt', 'tiny')
  } finally { await publicReader.close() }

  const database = openDatabase(runtime.filename)
  try {
    expect(database.select().from(mediaAssets).where(eq(mediaAssets.id, mediaId)).get()).toMatchObject({
      id: mediaId, byteSize: storedBytes.byteLength, state: 'ready', sha256: createHash('sha256').update(storedBytes).digest('hex'),
    })
    expect(database.select().from(postPublicationMedia)
      .where(eq(postPublicationMedia.mediaId, mediaId)).all()).toHaveLength(1)
    expect(database.$client.pragma('foreign_key_check')).toEqual([])
  } finally { database.$client.close() }
})

test('上传期间继续输入并移动光标，响应仍插入跟随原文移动的位置', async ({ page, login, runtime }) => {
  await login()
  const draft = await withWritingStore(runtime, writer => createTestDraft(writer, { title: 'Typing during upload', description: '', body: 'Before after' }))
  await page.goto(`/admin/posts/${draft.id}`)
  await expect(page.getByText('No unsaved changes.', { exact: true })).toBeVisible()
  const baseline = snapshot(runtime, draft.id)
  const body = page.getByRole('textbox', { name: 'Body', exact: true })
  await body.press('ControlOrMeta+End')
  const stored = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let mediaUrl = ''
  await page.route('**/api/admin/media', async route => {
    const response = await route.fetch()
    const result = mediaUploadResponseSchema.parse(await response.json())
    if (result.status !== 'success') throw new Error('The upload must succeed.')
    mediaUrl = result.media.url
    stored.resolve()
    await release.promise
    await route.fulfill({ response })
  })
  await page.getByLabel('Choose image', { exact: true }).setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: pngBytes })
  await page.getByRole('button', { name: 'Upload and insert', exact: true }).click()
  await stored.promise
  try {
    await body.press('ControlOrMeta+Home')
    await body.pressSequentially('Prefix ')
    await body.press('ControlOrMeta+Home')
  } finally { release.resolve() }
  await expect(body).toContainText(mediaUrl)
  await expect.poll(() => localCopy(page, draft.id)).toMatchObject({ content: { body: `Prefix Before after ![tiny](${mediaUrl})` } })
  expect(snapshot(runtime, draft.id)).toEqual(baseline)
})

test('服务器已接收但响应中断时，只有明确重试才核对同一媒体身份', async ({ page, login, runtime }) => {
  await login()
  const draft = await withWritingStore(runtime, writer => createTestDraft(writer, { title: 'Retry image', description: '', body: 'Before after' }))
  await page.goto(`/admin/posts/${draft.id}`)
  await expect(page.getByText('No unsaved changes.', { exact: true })).toBeVisible()
  const baseline = snapshot(runtime, draft.id)
  const body = page.getByRole('textbox', { name: 'Body', exact: true })
  await body.press('ControlOrMeta+End')
  const uploadedIds: string[] = []
  await page.route('**/api/admin/media', async route => {
    const response = await route.fetch()
    const result = mediaUploadResponseSchema.parse(await response.json())
    if (result.status !== 'success') throw new Error('The upload must succeed.')
    uploadedIds.push(result.media.id)
    if (uploadedIds.length === 1) await route.abort('failed')
    else await route.fulfill({ response })
  })
  await page.getByLabel('Choose image', { exact: true }).setInputFiles({ name: 'tiny.png', mimeType: 'image/png', buffer: pngBytes })
  await page.getByRole('button', { name: 'Upload and insert', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Retry upload', exact: true })).toBeVisible()
  expect(uploadedIds).toHaveLength(1)
  expect(snapshot(runtime, draft.id)).toEqual(baseline)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(body).not.toContainText('/media/')
  expect(uploadedIds).toHaveLength(1)
  await page.getByRole('button', { name: 'Retry upload', exact: true }).click()
  const url = `/media/${uploadedIds[0]}`
  await expect(body).toContainText(url)
  expect(uploadedIds).toEqual([uploadedIds[0], uploadedIds[0]])
  await expect.poll(() => localCopy(page, draft.id)).toMatchObject({ content: { body: `Before after ![tiny](${url})` } })
  expect(snapshot(runtime, draft.id)).toEqual(baseline)
  const database = openDatabase(runtime.filename)
  try {
    expect(database.select().from(mediaAssets).where(eq(mediaAssets.id, uploadedIds[0])).all()).toHaveLength(1)
    expect(database.select().from(postPublicationMedia).where(eq(postPublicationMedia.mediaId, uploadedIds[0])).all()).toEqual([])
  } finally { database.$client.close() }
})

test('上传成功但正文未保存时，图片保持私有且正文仍为本机内容', async ({ page, browser, login, runtime }) => {
  await login()
  await page.goto('/admin/posts/new')
  await expect(page.getByText('Ready to write.', { exact: true })).toBeVisible()
  const postId = postIdSchema.parse(new URL(page.url()).searchParams.get('draft'))
  await page.getByLabel('Title', { exact: true }).fill('Private image draft')
  await page.getByLabel('Choose image', { exact: true }).setInputFiles({
    name: 'tiny.png', mimeType: 'image/png', buffer: pngBytes,
  })
  const uploadedResponse = page.waitForResponse(response => response.url().endsWith('/api/admin/media') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Upload and insert', exact: true }).click()
  const upload = mediaUploadResponseSchema.parse(await (await uploadedResponse).json())
  if (upload.status !== 'success') throw new Error('The upload must succeed.')
  expect(upload.media.url).toBe(`/media/${upload.media.id}`)
  await expect(page.getByText('Recovery copy saved on this browser.', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Body', exact: true })).toContainText(upload.media.url)
  expect(snapshot(runtime, postId)).toEqual({ posts: [], revisions: [], drafts: [], publications: [], published: [], receipts: [] })
  const anonymous = await browser.newContext()
  try {
    const response = await anonymous.request.get(`${runtime.origin}${upload.media.url}`)
    expect(response.status()).toBe(404)
  } finally { await anonymous.close() }
})

test('后台媒体库展示引用关系，并仅允许删除未被引用的图片', async ({ page, context, login, runtime }) => {
  await login()
  await page.goto('/admin/posts/new')
  await expect(page.getByText('Ready to write.', { exact: true })).toBeVisible()

  // 上传第一张图片并发布文章（应显示 Published 引用且不可删除）
  await page.getByLabel('Title', { exact: true }).fill('Media library post')
  await page.getByLabel('Choose image', { exact: true }).setInputFiles({
    name: 'used.png', mimeType: 'image/png', buffer: pngBytes,
  })
  const usedResponse = page.waitForResponse(response => response.url().endsWith('/api/admin/media') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Upload and insert', exact: true }).click()
  const used = mediaUploadResponseSchema.parse(await (await usedResponse).json())
  if (used.status !== 'success') throw new Error('Expected first upload to succeed.')
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByText('Post published.', { exact: true })).toBeVisible()

  // 上传第二张图片但不保存/发布正文（应显示 Not referenced 且可删除）
  await page.goto('/admin/posts/new')
  await expect(page.getByText('Ready to write.', { exact: true })).toBeVisible()
  await page.getByLabel('Choose image', { exact: true }).setInputFiles({
    name: 'orphan.png', mimeType: 'image/png', buffer: pngBytes,
  })
  const orphanResponse = page.waitForResponse(response => response.url().endsWith('/api/admin/media') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Upload and insert', exact: true }).click()
  const orphan = mediaUploadResponseSchema.parse(await (await orphanResponse).json())
  if (orphan.status !== 'success') throw new Error('Expected second upload to succeed.')

  const mediaPage = await context.newPage()
  await mediaPage.goto('/admin/media')
  await expect(mediaPage.getByRole('heading', { name: 'Media', exact: true })).toBeVisible()
  const mediaList = mediaPage.getByRole('list', { name: 'Media assets' })
  const usedCard = mediaList.locator(':scope > li', { hasText: 'used.png' })
  const orphanCard = mediaList.locator(':scope > li', { hasText: 'orphan.png' })

  await expect(usedCard.getByRole('link', { name: 'Media library post' })).toBeVisible()
  await expect(usedCard.getByRole('link', { name: 'Published', exact: true })).toBeVisible()
  await expect(usedCard.getByRole('button', { name: 'Delete' })).toHaveCount(0)

  await expect(orphanCard.getByText('Not referenced', { exact: true })).toBeVisible()
  await orphanCard.getByRole('button', { name: 'Delete', exact: true }).click()
  const dialog = mediaPage.getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(orphanCard).toHaveCount(0)
  await expect(usedCard).toBeVisible()

  expect((await mediaPage.request.get(`${runtime.origin}${orphan.media.url}`)).status()).toBe(404)
  await mediaPage.close()
})

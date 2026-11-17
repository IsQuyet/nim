import assert from 'node:assert/strict'
import type { Page, Route } from '@playwright/test'
import { parseMarkdownFile } from '../modules/posts/server/file-format'
import { recoveryCopySchema } from '../modules/posts/writing'
import { createTestDraft, publishTestDraft, saveTestDraft } from '../test/post-commands'
import { test, expect, expireSession, signIn, snapshot, withStore, withWritingStore } from './fixtures'

async function openNewDraft(page: Page) {
  await page.goto('/admin/posts/new')
  const status = page.getByLabel('Saving status')
  await expect(status).toContainText(/Ready to write\.|Choose how to continue with your local copies\./)
  const recovery = page.getByRole('region', { name: 'Local recovery copies' })
  if (await recovery.isVisible()) {
    await recovery.getByRole('button', { name: 'Continue without restoring', exact: true }).click()
  }
  await expect(recovery).toBeHidden()
  await expect(status).toContainText('Ready to write.')
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeEnabled()
}

async function createDraft(page: Page, title: string, body = '# First snapshot') {
  await openNewDraft(page)
  await page.getByLabel('Title', { exact: true }).fill(title)
  await page.getByLabel('Body', { exact: true }).fill(body)
  await save(page)
  await expect(page).toHaveURL(/\/admin\/posts\/[0-9a-f-]{36}$/)
  const id = new URL(page.url()).pathname.split('/').at(-1)
  assert.ok(id)
  return id
}

async function confirmed(page: Page) {
  const status = page.getByLabel('Saving status')
  await expect(status).toContainText('No unsaved changes.')
  await expect(status).toContainText('Recovery copy saved on this browser.')
}

async function localBodies(page: Page, postId: string) {
  const records = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('nim-writing-recovery')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<unknown[]>((resolve, reject) => {
        const transaction = database.transaction('copies', 'readonly')
        const request = transaction.objectStore('copies').getAll()
        let result: unknown[] = []
        request.onsuccess = () => { result = request.result }
        transaction.oncomplete = () => resolve(result)
        transaction.onabort = () => reject(transaction.error)
      })
    } finally { database.close() }
  })
  return recoveryCopySchema.array().parse(records)
    .filter(copy => copy.postId === postId)
    .map(copy => copy.content.body)
}

async function expectLocalBody(page: Page, postId: string, body: string) {
  await expect.poll(() => localBodies(page, postId)).toContain(body)
}

async function save(page: Page) {
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByText('Draft saved.', { exact: true })).toBeVisible()
  await confirmed(page)
}

async function publish(page: Page) {
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByText('Post published.', { exact: true })).toBeVisible()
  await confirmed(page)
}

function actionRequest(route: Route, intent?: 'save' | 'publish') {
  const request = route.request()
  const body = request.postData() ?? ''
  return request.method() === 'POST' && Boolean(request.headers()['next-action'])
    && body.includes('"intent"')
    && (intent === undefined || new RegExp(`"intent"\\s*:\\s*"${intent}"`).test(body))
}

function operationId(route: Route) {
  const id = route.request().postData()?.match(/"operationId"\s*:\s*"([0-9a-f-]{36})"/i)?.[1]
  assert.ok(id, '写入请求必须携带 operationId。')
  return id
}

test('发布当前可见内容，私有修改和历史恢复不改变公开版本', async ({ page, login, runtime }, testInfo) => {
  await login()
  const id = await createDraft(page, 'History origin', '# First snapshot\n\nORIGINAL_MARKER')
  const original = snapshot(runtime, id).revisions[0]
  await page.getByLabel('Title', { exact: true }).fill('Published visible title')
  await page.getByLabel('Description', { exact: true }).fill('Public summary')
  await page.getByLabel('Body', { exact: true }).fill('# Public snapshot\n\nPUBLIC_MARKER')
  await publish(page)
  const live = snapshot(runtime, id)
  expect(live.revisions).toHaveLength(2)
  expect(live.publications).toHaveLength(1)
  expect(live.revisions[1].source).toBe('publish')
  expect(live.drafts[0].revisionId).toBe(live.publications[0].revisionId)
  expect(await (await page.request.get(`/blog/${id}`)).text()).toContain('PUBLIC_MARKER')
  expect(await (await page.request.get('/')).text()).toContain('Published visible title')
  expect(await (await page.request.get('/sitemap.xml')).text()).toContain(`/blog/${id}`)

  await page.getByLabel('Body', { exact: true }).fill('# Private snapshot\n\nPRIVATE_MARKER')
  await save(page)
  expect(snapshot(runtime, id).publications).toEqual(live.publications)
  await page.goto(`/admin/posts/${id}/history?revisionId=${original.id}`)
  const historyComparison = page.getByRole('region', { name: 'Rendered version comparison' })
  await expect(historyComparison.getByRole('article', { name: 'Published version' })).toContainText('PUBLIC_MARKER')
  await expect(page.getByRole('article', { name: 'Selected revision' })).toContainText('ORIGINAL_MARKER')
  await expect(page.getByRole('article', { name: 'Selected revision' })).not.toContainText('PRIVATE_MARKER')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: testInfo.outputPath('history-mobile.png'), fullPage: true })
  await page.getByRole('button', { name: 'Restore draft', exact: true }).click()
  await expect(page).toHaveURL(`${runtime.origin}/admin/posts/${id}`)
  await expect(page.getByLabel('Body', { exact: true })).toContainText('ORIGINAL_MARKER')
  const restored = snapshot(runtime, id)
  expect(restored.revisions).toHaveLength(4)
  expect(restored.revisions.at(-1)?.restoredFromRevisionId).toBe(original.id)
  expect(restored.publications).toEqual(live.publications)
  expect(await (await page.request.get(`/blog/${id}`)).text()).toContain('PUBLIC_MARKER')
  await page.goto(`/admin/posts/${id}/history`)
  await expect(page.getByRole('button', { name: 'Restore draft', exact: true })).toBeDisabled()
})

test('旧编辑基线拒绝覆盖，过期会话重登后原标签页仍能保存', async ({ page, context, login, runtime }) => {
  await login()
  const id = await createDraft(page, 'Concurrent post')
  const stale = await context.newPage()
  await stale.goto(`/admin/posts/${id}`)
  await expect(stale.getByLabel('Saving status')).toContainText('No unsaved changes.')
  const staleRecovery = stale.getByRole('region', { name: 'Local recovery copies' })
  if (await staleRecovery.isVisible()) {
    await staleRecovery.getByRole('button', { name: 'Continue without restoring', exact: true }).click()
  }
  await page.getByLabel('Body', { exact: true }).fill('# Current saved revision')
  await save(page)
  const before = snapshot(runtime, id)
  await stale.getByLabel('Body', { exact: true }).fill('# Keep this stale input')
  await expectLocalBody(stale, id, '# Keep this stale input')
  await stale.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(stale.getByRole('region', { name: 'Draft conflict' })).toBeVisible()
  await expectLocalBody(stale, id, '# Keep this stale input')
  expect(snapshot(runtime, id)).toEqual(before)

  await expireSession(page, runtime)
  await page.getByLabel('Body', { exact: true }).fill('# Keep this after expiry')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByRole('form', { name: 'Draft' }).getByRole('alert')).toContainText('Sign in to save or publish this draft.')
  expect(snapshot(runtime, id)).toEqual(before)
  const signingIn = await context.newPage()
  await signIn(signingIn, runtime.origin)
  await page.getByRole('button', { name: 'Retry previous save', exact: true }).click()
  await expect(page.getByText('Draft saved.', { exact: true })).toBeVisible()
  await confirmed(page)
  expect(snapshot(runtime, id).revisions.at(-1)?.body).toBe('# Keep this after expiry')
})

test('历史分页有界读取，只展示选中正文并保护访问', async ({ page, browser, login, runtime }) => {
  await login()
  const draft = await withWritingStore(runtime, writer => {
    let current = createTestDraft(writer, { title: 'Page 0', description: '', body: '# BODY_0' })
    const first = current.revisionId
    for (let index = 1; index < 27; index += 1) {
      current = saveTestDraft(writer, current, { title: `Page ${index}`, description: '', body: `# BODY_${index}` })
    }
    return { id: current.id, first }
  })
  await page.goto(`/admin/posts/${draft.id}/history?revisionId=${draft.first}`)
  await expect(page.getByRole('list', { name: 'Revisions' }).locator(':scope > li')).toHaveCount(20)
  await expect(page.getByRole('article', { name: 'Selected revision' })).toContainText('BODY_0')
  await expect(page.locator('body')).not.toContainText('BODY_26')
  await page.getByRole('link', { name: 'Next page' }).click()
  await expect(page.getByRole('list', { name: 'Revisions' }).locator(':scope > li')).toHaveCount(7)
  await expect(page.getByRole('article', { name: 'Selected revision' })).toContainText('BODY_0')
  expect((await page.request.get(`/admin/posts/${draft.id}/history?page=0`)).status()).toBe(404)
  const other = await withWritingStore(runtime, writer => createTestDraft(writer, { title: 'Other', description: '', body: '# Other' }))
  expect((await page.request.get(`/admin/posts/${draft.id}/history?revisionId=${other.revisionId}`)).status()).toBe(404)
  const anonymous = await browser.newContext()
  try {
    const visitor = await anonymous.newPage()
    await visitor.goto(`${runtime.origin}/admin/posts/${draft.id}/history`)
    await expect(visitor).toHaveURL(`${runtime.origin}/admin/login`)
    expect((await anonymous.request.get(`${runtime.origin}/admin/posts/${draft.id}/export`)).status()).toBe(401)
  } finally {
    await anonymous.close()
  }
})

test('文件 ID 决定草稿目标，下载保留 UTF-8 原文且不改变公开版本', async ({ page, login, runtime }, testInfo) => {
  await login()
  const draft = await withWritingStore(runtime, writer => {
    const created = createTestDraft(writer, { title: 'Original public', description: '', body: '# Original public body' })
    publishTestDraft(writer, created)
    return created
  })
  const live = snapshot(runtime, draft.id).publications
  const body = '    first-line code\r\n\r\n# 导入正文\r\n\r\n'
  const file = `---\nid: ${draft.id}\ntitle: Imported title\n---\n${body}`
  await page.goto('/admin/import')
  await page.getByLabel('Markdown file', { exact: true }).setInputFiles({ name: 'not-the-id.md', mimeType: 'text/markdown', buffer: Buffer.from(file) })
  await page.getByRole('button', { name: 'Import draft', exact: true }).click()
  await expect(page).toHaveURL(`${runtime.origin}/admin/posts/${draft.id}`)
  expect(snapshot(runtime, draft.id).revisions.at(-1)?.body).toBe(body)
  expect(snapshot(runtime, draft.id).revisions.at(-1)?.source).toBe('import')
  expect(snapshot(runtime, draft.id).publications).toEqual(live)
  const download = await page.request.get(`/admin/posts/${draft.id}/export`)
  expect(download.headers()['cache-control']).toBe('private, no-store')
  expect(download.headers()['content-disposition']).toContain(`${draft.id}.md`)
  const parsed = parseMarkdownFile(await download.text())
  assert.ok(parsed.success)
  expect(parsed.data).toEqual({ id: draft.id, title: 'Imported title', description: '', body })
  const published = parseMarkdownFile(await (await page.request.get(`/admin/posts/${draft.id}/export?stage=published`)).text())
  assert.ok(published.success)
  expect(published.data.body).toBe('# Original public body')
  const before = snapshot(runtime, draft.id)
  await page.goto('/admin/import')
  await page.getByLabel('Markdown file', { exact: true }).setInputFiles({ name: 'renamed.md', mimeType: 'text/markdown', buffer: Buffer.from(file) })
  await page.getByRole('button', { name: 'Import draft', exact: true }).click()
  await expect(page).toHaveURL(`${runtime.origin}/admin/posts/${draft.id}`)
  expect(snapshot(runtime, draft.id)).toEqual(before)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/admin/import')
  await page.screenshot({ path: testInfo.outputPath('import-mobile.png'), fullPage: true })
})

test('大于默认 HTTP 上限的合法文件能导入，超文件限额会保留选择并拒绝写入', async ({ page, login, runtime }) => {
  await login()
  const body = 'large line\n'.repeat(110_000)
  await page.goto('/admin/import')
  await page.getByLabel('Markdown file', { exact: true }).setInputFiles({ name: 'large.md', mimeType: 'text/markdown', buffer: Buffer.from(`---\ntitle: Large file\n---\n${body}`) })
  await page.getByRole('button', { name: 'Import draft', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/posts\/[0-9a-f-]{36}$/)
  const id = new URL(page.url()).pathname.split('/').at(-1)
  assert.ok(id)
  expect(snapshot(runtime, id).revisions[0].body).toBe(body)
  const before = await withStore(runtime, store => store.listPosts())
  await page.goto('/admin/import')
  await page.getByLabel('Markdown file', { exact: true }).setInputFiles({ name: 'too-large.md', mimeType: 'text/markdown', buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 65) })
  await page.getByRole('button', { name: 'Import draft', exact: true }).click()
  await expect(page.getByRole('form', { name: 'Import Markdown' }).getByRole('alert')).toContainText('5 MiB limit')
  expect(await withStore(runtime, store => store.listPosts())).toEqual(before)
  expect(await page.getByLabel('Markdown file', { exact: true }).evaluate(input => {
    if (!(input instanceof HTMLInputElement)) throw new Error('Expected a file input')
    return input.files?.[0]?.name
  })).toBe('too-large.md')
})

test('提交丢响应以原回执重试，保存发布断网与远端变化均保留本地输入', async ({ page, context, login, runtime }) => {
  await login()
  await openNewDraft(page)
  await page.getByLabel('Title', { exact: true }).fill('Lost response creation')
  await page.getByLabel('Body', { exact: true }).fill('# Keep after response loss')
  const committedResponse = Promise.withResolvers<void>()
  const dropResponse = Promise.withResolvers<void>()
  const creationOperations: string[] = []
  let drop = true
  await page.route(`${runtime.origin}/**`, async route => {
    if (!actionRequest(route, 'save')) {
      await route.continue()
      return
    }
    creationOperations.push(operationId(route))
    if (drop) {
      drop = false
      const response = await route.fetch()
      await response.body()
      committedResponse.resolve()
      await dropResponse.promise
      await route.abort('failed')
    } else await route.continue()
  })
  const continuedBody = '# Keep typing while creation is pending'
  try {
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await committedResponse.promise
    await expect(page.getByLabel('Body', { exact: true })).toBeEditable()
    await page.getByLabel('Body', { exact: true }).fill(continuedBody)
  } finally {
    dropResponse.resolve()
  }
  await expect(page.getByLabel('Saving status')).toContainText('The previous operation is not confirmed. Your input is preserved.')
  const created = await withStore(runtime, store => store.listPosts().filter(post => post.title === 'Lost response creation'))
  expect(created).toHaveLength(1)
  await expectLocalBody(page, created[0].id, continuedBody)
  const before = snapshot(runtime, created[0].id)
  expect(before.posts).toHaveLength(1)
  expect(before.revisions).toHaveLength(1)
  expect(before.revisions[0].body).toBe('# Keep after response loss')
  expect(before.receipts.filter(receipt => receipt.operationId === creationOperations[0])).toHaveLength(1)

  await page.getByRole('button', { name: 'Check previous operation', exact: true }).click()
  await expect(page).toHaveURL(`${runtime.origin}/admin/posts/${created[0].id}`)
  await expect(page.getByLabel('Saving status')).toContainText('Unsaved changes. Not saved to the server.')
  await expectLocalBody(page, created[0].id, continuedBody)
  expect(creationOperations).toEqual([creationOperations[0]])
  expect(snapshot(runtime, created[0].id)).toEqual(before)
  await page.unrouteAll({ behavior: 'wait' })
  await save(page)
  expect(snapshot(runtime, created[0].id).revisions.at(-1)?.body).toBe(continuedBody)

  for (const intent of ['save', 'publish'] as const) {
    let fail = true
    const rejected = Promise.withResolvers<ReturnType<typeof snapshot>>()
    const operations: string[] = []
    const body = `# Kept during ${intent} outage`
    await page.route(`${runtime.origin}/**`, async route => {
      if (!actionRequest(route, intent)) {
        await route.continue()
        return
      }
      operations.push(operationId(route))
      if (fail) {
        fail = false
        rejected.resolve(snapshot(runtime, created[0].id))
        await route.abort('internetdisconnected')
      } else await route.continue()
    })
    await page.getByLabel('Body', { exact: true }).fill(body)
    await page.getByRole('button', { name: intent === 'save' ? 'Save draft' : 'Publish', exact: true }).click()
    await expect(page.getByLabel('Saving status')).toContainText('The previous operation is not confirmed. Your input is preserved.')
    await expectLocalBody(page, created[0].id, body)
    const beforeAttempt = await rejected.promise
    expect(snapshot(runtime, created[0].id)).toEqual(beforeAttempt)
    await page.getByRole('button', { name: intent === 'save' ? 'Retry previous save' : 'Retry previous publish', exact: true }).click()
    await expect(page.getByText(intent === 'save' ? 'Draft saved.' : 'Post published.', { exact: true })).toBeVisible()
    await confirmed(page)
    const accepted = snapshot(runtime, created[0].id)
    expect(operations).toEqual([operations[0], operations[0]])
    expect(accepted.revisions).toHaveLength(beforeAttempt.revisions.length + 1)
    expect(accepted.revisions.at(-1)?.body).toBe(body)
    expect(accepted.publications).toHaveLength(beforeAttempt.publications.length + (intent === 'publish' ? 1 : 0))
    expect(accepted.receipts.filter(receipt => receipt.operationId === operations[0])).toHaveLength(1)
    await page.unrouteAll({ behavior: 'wait' })
  }

  await openNewDraft(page)
  await page.getByLabel('Title', { exact: true }).fill('Changed response creation')
  await page.getByLabel('Body', { exact: true }).fill('# Actually committed first text')
  const changedOperations: string[] = []
  drop = true
  await page.route(`${runtime.origin}/**`, async route => {
    if (!actionRequest(route, 'save')) {
      await route.continue()
      return
    }
    changedOperations.push(operationId(route))
    if (drop) {
      drop = false
      const response = await route.fetch()
      await response.body()
      await route.abort('failed')
    } else await route.continue()
  })
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByLabel('Saving status')).toContainText('The previous operation is not confirmed. Your input is preserved.')
  const changed = await withStore(runtime, store => store.listPosts().filter(post => post.title === 'Changed response creation'))
  expect(changed).toHaveLength(1)
  expect(snapshot(runtime, changed[0].id).revisions).toHaveLength(1)
  const localBody = '# Keep these different local edits'
  const remoteBody = '# Remote import after response loss'
  await page.getByLabel('Body', { exact: true }).fill(localBody)
  await withStore(runtime, store => store.importDraft({
    id: changed[0].id, title: 'Changed response creation', description: 'Imported remotely', body: remoteBody,
  }))
  const imported = snapshot(runtime, changed[0].id)
  expect(imported.revisions).toHaveLength(2)
  expect(imported.revisions.at(-1)?.source).toBe('import')
  await page.getByRole('button', { name: 'Check previous operation', exact: true }).click()
  await expect(page).toHaveURL(`${runtime.origin}/admin/posts/${changed[0].id}`)
  const conflict = page.getByRole('region', { name: 'Draft conflict' })
  await expect(conflict).toBeVisible()
  await conflict.getByText('Review server text', { exact: true }).click()
  await expect(conflict).toContainText(remoteBody)
  await expectLocalBody(page, changed[0].id, localBody)
  expect(changedOperations).toEqual([changedOperations[0]])
  expect(snapshot(runtime, changed[0].id)).toEqual(imported)
  const [review] = await Promise.all([
    context.waitForEvent('page'),
    conflict.getByRole('link', { name: 'Review server draft in a new tab', exact: true }).click(),
  ])
  const reviewStatus = review.getByLabel('Saving status')
  await expect(reviewStatus).toContainText('No unsaved changes.')
  const recovery = review.getByRole('region', { name: 'Local recovery copies' })
  if (await recovery.isVisible()) {
    await recovery.getByRole('button', { name: 'Continue without restoring', exact: true }).click()
  }
  await expect(reviewStatus).toContainText('No unsaved changes.')
  await expect(review.getByLabel('Body', { exact: true })).toContainText('Remote import after response loss')
  await expectLocalBody(page, changed[0].id, localBody)
  expect(await withStore(runtime, store => store.listPosts().filter(post => post.title === 'Changed response creation'))).toHaveLength(1)
  expect(snapshot(runtime, changed[0].id)).toEqual(imported)
  await page.unrouteAll({ behavior: 'wait' })
})

test('公开 Markdown 多语言高亮并安全渲染，不请求 WASM', async ({ page, context, login }, testInfo) => {
  const requests: { url: string; type: string }[] = []
  const contentTypes: string[] = []
  context.on('request', request => requests.push({ url: request.url(), type: request.resourceType() }))
  context.on('response', response => {
    const type = response.headers()['content-type']
    if (type) contentTypes.push(type)
  })
  await login()
  const source = '# 中文标题\n\n```rust\nfn main() {}\n```\n\n```sql\nSELECT title FROM posts;\n```\n\n```bash\necho "$HOME"\n```\n\n```unknown-language\n<Widget />\n```\n\n<script>globalThis.__nimMarkdownExecuted = true</script>\n'
  const id = await createDraft(page, 'Multilingual article', source)
  await publish(page)
  const publicPage = await context.newPage()
  await publicPage.goto(`/blog/${id}`)
  await publicPage.waitForLoadState('networkidle')

  const expectedCode = ['fn main() {}', 'SELECT title FROM posts;', 'echo "$HOME"', '<Widget />']
  expect(await publicPage.locator('pre code').allTextContents()).toEqual(expectedCode)
  await expect(publicPage.locator('.prose script, .prose widget')).toHaveCount(0)
  expect(await publicPage.evaluate(() => Object.hasOwn(globalThis, '__nimMarkdownExecuted'))).toBe(false)
  const samples = [{ index: 0, keyword: 'fn' }, { index: 1, keyword: 'SELECT' }, { index: 2, keyword: 'echo' }]
  for (const sample of samples) {
    const block = publicPage.locator('pre code').nth(sample.index)
    const token = block.locator('span[style]').filter({ hasText: new RegExp(`^${sample.keyword}$`) })
    const color = await token.evaluate(element => getComputedStyle(element).color)
    expect(color).not.toBe(await block.evaluate(element => getComputedStyle(element).color))
  }
  expect(requests.some(request => /\.wasm(?:\?|$)/i.test(request.url))).toBe(false)
  expect(contentTypes.some(type => /application\/wasm/i.test(type))).toBe(false)
  await publicPage.setViewportSize({ width: 390, height: 844 })
  await publicPage.screenshot({ path: testInfo.outputPath('multilingual-public-mobile.png'), fullPage: true })
})

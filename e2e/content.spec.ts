import assert from 'node:assert/strict'
import type { Page, Route } from '@playwright/test'
import { parseMarkdownFile } from '../lib/markdown-file'
import { MARKDOWN_CODE_THEME } from '../lib/markdown-highlighter'
import { test, expect, expireSession, signIn, snapshot, withStore } from './fixtures'

async function createDraft(page: Page, title: string, body = '# First snapshot') {
  await page.goto('/admin/posts/new')
  await page.getByLabel('Title', { exact: true }).fill(title)
  await page.getByLabel('Body', { exact: true }).fill(body)
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/posts\/[0-9a-f-]{36}$/)
  const id = new URL(page.url()).pathname.split('/').at(-1)
  assert.ok(id)
  return id
}

async function save(page: Page) {
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByText('Draft saved.', { exact: true })).toBeVisible()
}

async function publish(page: Page) {
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByText('Post published.', { exact: true })).toBeVisible()
}

function actionRequest(route: Route) {
  return route.request().method() === 'POST' && Boolean(route.request().headers()['next-action'])
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
  await expect(page.getByRole('region', { name: 'Selected revision' })).toContainText('ORIGINAL_MARKER')
  await expect(page.getByRole('region', { name: 'Selected revision' })).not.toContainText('PRIVATE_MARKER')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: testInfo.outputPath('history-mobile.png'), fullPage: true })
  await page.getByRole('button', { name: 'Restore draft', exact: true }).click()
  await expect(page).toHaveURL(`${runtime.origin}/admin/posts/${id}`)
  await expect(page.getByLabel('Body', { exact: true })).toHaveValue('# First snapshot\n\nORIGINAL_MARKER')
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
  await page.getByLabel('Body', { exact: true }).fill('# Current saved revision')
  await save(page)
  const before = snapshot(runtime, id)
  await stale.getByLabel('Body', { exact: true }).fill('# Keep this stale input')
  await stale.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(stale.getByRole('form', { name: 'Draft' }).getByRole('alert')).toContainText('changed since you opened it')
  await expect(stale.getByLabel('Body', { exact: true })).toHaveValue('# Keep this stale input')
  expect(snapshot(runtime, id)).toEqual(before)

  await expireSession(page, runtime)
  await page.getByLabel('Body', { exact: true }).fill('# Keep this after expiry')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByRole('form', { name: 'Draft' }).getByRole('alert')).toContainText('Sign in to save')
  expect(snapshot(runtime, id)).toEqual(before)
  const signingIn = await context.newPage()
  await signIn(signingIn, runtime.origin)
  await save(page)
  expect(snapshot(runtime, id).revisions.at(-1)?.body).toBe('# Keep this after expiry')
})

test('历史分页有界读取，只展示选中正文并保护访问', async ({ page, browser, login, runtime }) => {
  await login()
  const draft = await withStore(runtime, store => {
    let current = store.createDraft({ title: 'Page 0', description: '', body: '# BODY_0' })
    const first = current.revisionId
    for (let index = 1; index < 27; index += 1) {
      const result = store.saveDraft(current.id, { title: `Page ${index}`, description: '', body: `# BODY_${index}` }, current.revisionId)
      assert.ok(result.status === 'success')
      current = result.value
    }
    return { id: current.id, first }
  })
  await page.goto(`/admin/posts/${draft.id}/history?revisionId=${draft.first}`)
  await expect(page.getByRole('list', { name: 'Revisions' }).locator(':scope > li')).toHaveCount(20)
  await expect(page.getByRole('region', { name: 'Selected revision' })).toContainText('BODY_0')
  await expect(page.locator('body')).not.toContainText('BODY_26')
  await page.getByRole('link', { name: 'Next page' }).click()
  await expect(page.getByRole('list', { name: 'Revisions' }).locator(':scope > li')).toHaveCount(7)
  await expect(page.getByRole('region', { name: 'Selected revision' })).toContainText('BODY_0')
  expect((await page.request.get(`/admin/posts/${draft.id}/history?page=0`)).status()).toBe(404)
  const other = await withStore(runtime, store => store.createDraft({ title: 'Other', description: '', body: '# Other' }))
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
  const draft = await withStore(runtime, store => {
    const created = store.createDraft({ title: 'Original public', description: '', body: '# Original public body' })
    const result = store.publishDraft(created.id, created, created.revisionId)
    assert.ok(result.status === 'success')
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

test('已提交的新建重试保持幂等，改内容则冲突，保存与发布断网均保留输入', async ({ page, context, login, runtime }) => {
  await login()
  await page.goto('/admin/posts/new')
  await page.getByLabel('Title', { exact: true }).fill('Lost response creation')
  await page.getByLabel('Body', { exact: true }).fill('# Keep after response loss')
  let drop = true
  await page.route(`${runtime.origin}/**`, async route => {
    if (drop && actionRequest(route)) {
      drop = false
      const response = await route.fetch()
      await response.body()
      await route.abort('failed')
    } else await route.continue()
  })
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByRole('form', { name: 'Draft' }).getByRole('alert')).toContainText('Could not confirm')
  const created = await withStore(runtime, store => store.listPosts().filter(post => post.title === 'Lost response creation'))
  expect(created).toHaveLength(1)
  const before = snapshot(runtime, created[0].id)
  expect(before.posts).toHaveLength(1)
  expect(before.revisions).toHaveLength(1)
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page).toHaveURL(`${runtime.origin}/admin/posts/${created[0].id}`)
  expect(snapshot(runtime, created[0].id)).toEqual(before)
  await page.unrouteAll({ behavior: 'wait' })

  for (const intent of ['save', 'publish'] as const) {
    let fail = true
    const beforeAttempt = snapshot(runtime, created[0].id)
    const body = `# Kept during ${intent} outage`
    await page.route(`${runtime.origin}/**`, async route => {
      if (fail && actionRequest(route)) { fail = false; await route.abort('internetdisconnected') }
      else await route.continue()
    })
    await page.getByLabel('Body', { exact: true }).fill(body)
    await page.getByRole('button', { name: intent === 'save' ? 'Save draft' : 'Publish', exact: true }).click()
    await expect(page.getByRole('form', { name: 'Draft' }).getByRole('alert')).toContainText('Could not confirm')
    await expect(page.getByLabel('Body', { exact: true })).toHaveValue(body)
    expect(snapshot(runtime, created[0].id)).toEqual(beforeAttempt)
    if (intent === 'save') await save(page)
    else await publish(page)
    expect(snapshot(runtime, created[0].id).revisions.at(-1)?.body).toBe(body)
    await page.unrouteAll({ behavior: 'wait' })
  }

  await page.goto('/admin/posts/new')
  await page.getByLabel('Title', { exact: true }).fill('Changed response creation')
  await page.getByLabel('Body', { exact: true }).fill('# Actually committed first text')
  drop = true
  await page.route(`${runtime.origin}/**`, async route => {
    if (drop && actionRequest(route)) {
      drop = false
      const response = await route.fetch()
      await response.body()
      await route.abort('failed')
    } else await route.continue()
  })
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByRole('form', { name: 'Draft' }).getByRole('alert')).toContainText('Could not confirm')
  const changed = await withStore(runtime, store => store.listPosts().filter(post => post.title === 'Changed response creation'))
  expect(changed).toHaveLength(1)
  const committed = snapshot(runtime, changed[0].id)
  expect(committed.revisions).toHaveLength(1)
  await page.getByLabel('Body', { exact: true }).fill('# Keep these different local edits')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByRole('form', { name: 'Draft' }).getByRole('alert')).toContainText('already exists for this request')
  expect(snapshot(runtime, changed[0].id)).toEqual(committed)
  const [review] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('link', { name: 'Check saved draft in a new tab' }).click(),
  ])
  await expect(review.getByLabel('Body', { exact: true })).toHaveValue('# Actually committed first text')
  await expect(page.getByLabel('Body', { exact: true })).toHaveValue('# Keep these different local edits')
  expect(await withStore(runtime, store => store.listPosts().filter(post => post.title === 'Changed response creation'))).toHaveLength(1)
})

test('多语言两端原文与高亮一致，预览资源按需且所有网络类型均无 WASM 请求', async ({ page, context, login }, testInfo) => {
  const scripts: Promise<{ url: string; body: string; failure?: string }>[] = []
  const requests: { url: string; type: string }[] = []
  const contentTypes: string[] = []
  context.on('request', request => requests.push({ url: request.url(), type: request.resourceType() }))
  context.on('response', response => {
    const type = response.headers()['content-type']
    if (type) contentTypes.push(type)
    if (response.request().resourceType() === 'script') {
      scripts.push(response.text().then(
        body => ({ url: response.url(), body }),
        error => ({ url: response.url(), body: '', failure: String(error) }),
      ))
    }
  })
  await login()
  const source = '# 中文标题\n\n```rust\nfn main() {}\n```\n\n```sql\nSELECT title FROM posts;\n```\n\n```bash\necho "$HOME"\n```\n\n```unknown-language\n<Widget />\n```\n\n<script>globalThis.__nimMarkdownExecuted = true</script>\n'
  const id = await createDraft(page, 'Multilingual article', source)
  await publish(page)
  const publicPage = await context.newPage()
  await publicPage.goto(`/blog/${id}`)
  await publicPage.waitForLoadState('networkidle')
  await page.waitForLoadState('networkidle')
  const initial = await Promise.all(scripts)
  expect(initial.filter(script => script.failure)).toEqual([])
  expect(initial.some(script => script.body.includes(MARKDOWN_CODE_THEME))).toBe(false)

  const expectedCode = ['fn main() {}', 'SELECT title FROM posts;', 'echo "$HOME"', '<Widget />']
  expect(await publicPage.locator('pre code').allTextContents()).toEqual(expectedCode)
  await expect(publicPage.locator('.prose script, .prose widget')).toHaveCount(0)
  expect(await publicPage.evaluate(() => Object.hasOwn(globalThis, '__nimMarkdownExecuted'))).toBe(false)
  const samples = [{ index: 0, keyword: 'fn' }, { index: 1, keyword: 'SELECT' }, { index: 2, keyword: 'echo' }]
  const publicColors: string[] = []
  for (const sample of samples) {
    const block = publicPage.locator('pre code').nth(sample.index)
    const token = block.locator('span[style]').filter({ hasText: new RegExp(`^${sample.keyword}$`) })
    const color = await token.evaluate(element => getComputedStyle(element).color)
    expect(color).not.toBe(await block.evaluate(element => getComputedStyle(element).color))
    publicColors.push(color)
  }

  await page.getByRole('button', { name: 'Preview', exact: true }).click()
  const preview = page.getByRole('region', { name: 'Markdown preview' })
  await expect(preview.locator('pre code')).toHaveCount(4)
  expect(await preview.locator('pre code').allTextContents()).toEqual(expectedCode)
  for (const [index, sample] of samples.entries()) {
    const token = preview.locator('pre code').nth(sample.index).locator('span[style]')
      .filter({ hasText: new RegExp(`^${sample.keyword}$`) })
    expect(await token.evaluate(element => getComputedStyle(element).color)).toBe(publicColors[index])
  }
  await expect(preview.locator('script, widget')).toHaveCount(0)
  expect(await page.evaluate(() => Object.hasOwn(globalThis, '__nimMarkdownExecuted'))).toBe(false)
  await page.waitForLoadState('networkidle')
  const loaded = await Promise.all(scripts)
  expect(loaded.filter(script => script.failure)).toEqual([])
  expect(loaded.some(script => script.body.includes(MARKDOWN_CODE_THEME))).toBe(true)
  expect(requests.some(request => /\.wasm(?:\?|$)/i.test(request.url))).toBe(false)
  expect(contentTypes.some(type => /application\/wasm/i.test(type))).toBe(false)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: testInfo.outputPath('multilingual-preview-mobile.png'), fullPage: true })
  await testInfo.attach('preview-network.json', {
    body: JSON.stringify({
      initialScripts: initial.map(script => ({ url: script.url, bytes: Buffer.byteLength(script.body) })),
      openedScripts: loaded.map(script => ({ url: script.url, bytes: Buffer.byteLength(script.body) })),
      requests, contentTypes,
    }, null, 2),
    contentType: 'application/json',
  })
})

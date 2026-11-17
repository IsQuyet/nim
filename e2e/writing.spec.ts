import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type BrowserContext, type Dialog, type Download, type Page, type Request } from '@playwright/test'
import { postIdSchema } from '../modules/posts/model'
import { recoveryCopySchema, writingCommandSchema } from '../modules/posts/writing'
import { createTestDraft } from '../test/post-commands'
import { test, expect, signIn, snapshot, withStore, withWritingStore } from './fixtures'

const emptyServer = { posts: [], revisions: [], drafts: [], publications: [], published: [], receipts: [] }

async function rawCopies(page: Page) {
  return page.evaluate(async () => {
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
}

async function copies(page: Page) { return recoveryCopySchema.array().parse(await rawCopies(page)) }
async function localSaved(page: Page) { await expect(page.getByText('Recovery copy saved on this browser.', { exact: true })).toBeVisible() }
async function unsaved(page: Page) { await expect(page.getByText('Unsaved changes. Not saved to the server.', { exact: true })).toBeVisible() }
async function noUnsaved(page: Page) { await expect(page.getByText('No unsaved changes.', { exact: true })).toBeVisible() }

async function existing(page: Page, draft: { id: string }) {
  const checked = page.waitForResponse(response => isRead(response.request()))
  await page.goto(`/admin/posts/${draft.id}`)
  expect((await checked).ok()).toBe(true)
  await noUnsaved(page)
}

async function openNew(page: Page) {
  const checked = page.waitForResponse(response => isRead(response.request()))
  await page.goto('/admin/posts/new')
  expect((await checked).ok()).toBe(true)
  await expect(page.getByText('Ready to write.', { exact: true })).toBeVisible()
}

async function newDraftId(page: Page) {
  await expect(page).toHaveURL(/\/admin\/posts\/new\?draft=[0-9a-f-]{36}$/)
  return postIdSchema.parse(new URL(page.url()).searchParams.get('draft'))
}

function isAction(request: Request) {
  return request.method() === 'POST' && Boolean(request.headers()['next-action'])
}

function isWrite(request: Request) {
  return isAction(request) && Boolean(request.postData()?.includes('"intent"'))
}

function isInspection(request: Request) {
  return isAction(request) && !isWrite(request) && Boolean(request.postData()?.includes('"operationId"'))
}

function isRead(request: Request) {
  return isAction(request) && !isWrite(request) && !isInspection(request)
}

function observeActions(context: BrowserContext) {
  const writes: Request[] = []
  const inspections: Request[] = []
  context.on('request', request => {
    if (isWrite(request)) writes.push(request)
    else if (isInspection(request)) inspections.push(request)
  })
  return { writes, inspections }
}

function commandOf(request: Request) {
  const payload: unknown = JSON.parse(request.postData() ?? 'null')
  const commands = writingCommandSchema.array().length(1).parse(payload)
  return commands[0]
}

async function checkPrevious(page: Page) {
  const checked = page.waitForResponse(response => isInspection(response.request()))
  await page.getByRole('button', { name: 'Check previous operation', exact: true }).click()
  expect((await checked).ok()).toBe(true)
}

async function downloadText(download: Download) {
  const stream = await download.createReadStream()
  assert.ok(stream)
  let text = ''
  for await (const chunk of stream) text += chunk.toString()
  return text
}

test('手机宽度下 Markdown 编辑、离开和明确发布保持原有写作契约', async ({ page, context, login, runtime }) => {
  const { writes } = observeActions(context)
  await page.setViewportSize({ width: 390, height: 844 })
  await login()
  await openNew(page)
  const id = await newDraftId(page)
  await page.getByLabel('Body', { exact: true }).fill('正文尚未有标题\n')
  await localSaved(page)
  await unsaved(page)
  // 真实跨过原停笔窗口，数据库和写请求同时证明这里没有服务器自动保存。
  await page.waitForTimeout(1500)
  const local = (await copies(page)).find(copy => copy.postId === id)
  assert.ok(local)
  expect(local).toMatchObject({ format: 'nim-recovery/v2', content: { title: '', body: '正文尚未有标题\n' }, remote: null, pending: null })
  expect(snapshot(runtime, id)).toEqual(emptyServer)
  expect(writes).toHaveLength(0)
  expect((await page.request.get(`/blog/${id}`)).status()).toBe(404)
  expect((await page.request.get(`/admin/posts/${id}/export`)).status()).toBe(404)

  await page.getByLabel('Title', { exact: true }).fill('Explicitly saved article')
  await localSaved(page)
  await page.waitForTimeout(1500)
  expect(snapshot(runtime, id)).toEqual(emptyServer)
  expect(writes).toHaveLength(0)
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByText('Draft saved.', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(`${runtime.origin}/admin/posts/${id}`)
  await noUnsaved(page)
  const checkpoint = snapshot(runtime, id)
  expect(checkpoint.posts).toHaveLength(1)
  expect(checkpoint.revisions).toHaveLength(1)
  expect(checkpoint.drafts).toHaveLength(1)
  expect(checkpoint.receipts).toHaveLength(1)
  expect(Object.keys(checkpoint.receipts[0]).sort()).toEqual(['operationId', 'postId', 'publicationId', 'requestHash', 'revisionId'])
  expect(writes).toHaveLength(1)

  for (const text of ['First unsubmitted continuation', 'Second unsubmitted continuation']) {
    await page.getByLabel('Body', { exact: true }).fill(text)
    await localSaved(page)
    await page.waitForTimeout(1500)
    expect(snapshot(runtime, id)).toEqual(checkpoint)
    expect(writes).toHaveLength(1)
  }
  const liveMarkdown = '# Preview heading\n\n**Strong formatting** stays in the editing surface.'
  await page.getByLabel('Body', { exact: true }).fill(liveMarkdown)
  await expect(page.locator('.cm-md-heading-1')).toContainText('Preview heading')
  await expect(page.locator('.cm-md-strong')).toContainText('Strong formatting')
  const dimensions = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }))
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width)
  await localSaved(page)
  const localDraft = (await copies(page)).find(copy => copy.postId === id)
  expect(localDraft?.content.body).toBe(liveMarkdown)
  await page.waitForTimeout(1500)
  expect(snapshot(runtime, id)).toEqual(checkpoint)
  expect(writes).toHaveLength(1)
  const download = await page.request.get(`/admin/posts/${id}/export`)
  expect(download.ok()).toBe(true)
  const exported = await download.text()
  expect(exported).toContain(local.content.body)
  expect(exported).not.toContain('unsubmitted continuation')

  await page.getByLabel('Body', { exact: true }).fill('Visible publish snapshot')
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByText('Post published.', { exact: true })).toBeVisible()
  const after = snapshot(runtime, id)
  expect(after.revisions).toHaveLength(2)
  expect(after.publications).toHaveLength(1)
  expect(after.published).toHaveLength(1)
  expect(after.receipts).toHaveLength(2)
  expect(after.revisions.at(-1)?.body).toBe('Visible publish snapshot')
  expect(after.publications[0].revisionId).toBe(after.revisions.at(-1)?.id)
  expect(writes).toHaveLength(2)
  expect(commandOf(writes[1])).toMatchObject({ intent: 'publish', expectedRevisionId: checkpoint.revisions[0].id, content: { body: 'Visible publish snapshot' } })
})

test('保存后从列表再次新建产生独立 UUID 和空表单，不复用前一篇编辑会话', async ({ page, context, login, runtime }) => {
  const { writes } = observeActions(context)
  await login()
  const firstCheck = page.waitForResponse(response => isRead(response.request()))
  await page.getByRole('link', { name: 'New draft', exact: true }).click()
  expect((await firstCheck).ok()).toBe(true)
  await expect(page.getByText('Ready to write.', { exact: true })).toBeVisible()
  const intendedId = await newDraftId(page)
  await page.getByLabel('Title', { exact: true }).fill('First navigation intent')
  await page.getByLabel('Body', { exact: true }).fill('First document text')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  // replace 完成后才从路径读取已保存身份，不能把 new 当成文章 ID。
  await expect(page).toHaveURL(/\/admin\/posts\/[0-9a-f-]{36}$/)
  const firstId = postIdSchema.parse(new URL(page.url()).pathname.split('/').at(-1))
  expect(firstId).toBe(intendedId)
  await localSaved(page)
  await noUnsaved(page)
  const first = snapshot(runtime, firstId)
  await page.getByRole('link', { name: 'Back to posts', exact: true }).click()
  const secondCheck = page.waitForResponse(response => isRead(response.request()))
  await page.getByRole('link', { name: 'New draft', exact: true }).click()
  expect((await secondCheck).ok()).toBe(true)
  await expect(page.getByText('Ready to write.', { exact: true })).toBeVisible()
  const secondId = await newDraftId(page)
  expect(secondId).not.toBe(firstId)
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Body', { exact: true })).toHaveText('')
  expect(snapshot(runtime, secondId)).toEqual(emptyServer)
  expect(writes).toHaveLength(1)
  await page.getByLabel('Title', { exact: true }).fill('Second navigation intent')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page).toHaveURL(`${runtime.origin}/admin/posts/${secondId}`)
  await noUnsaved(page)
  expect(snapshot(runtime, firstId)).toEqual(first)
  expect(snapshot(runtime, secondId).revisions).toHaveLength(1)
  expect(writes).toHaveLength(2)
})

test('离线未提交新稿经历真实刷新和关页后恢复原身份，明确保存前服务器仍为空', async ({ page, context, login, runtime }, testInfo) => {
  const { writes } = observeActions(context)
  await login()
  await openNew(page)
  const id = await newDraftId(page)
  await context.setOffline(true)
  await page.getByLabel('Body', { exact: true }).fill('离线未完成的新稿\n')
  await localSaved(page)
  await unsaved(page)
  const original = (await copies(page)).find(copy => copy.postId === id)
  assert.ok(original)
  expect(original.remote).toBeNull()
  expect(original.pending).toBeNull()
  expect(snapshot(runtime, id)).toEqual(emptyServer)
  expect(writes).toHaveLength(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: testInfo.outputPath('offline-new-draft-mobile.png'), fullPage: true })
  await page.getByLabel('Body', { exact: true }).click()
  const warning = page.waitForEvent('dialog')
  const reload = page.reload({ timeout: 10_000 }).then(() => null, error => error)
  const leaving = await warning
  expect(leaving.type()).toBe('beforeunload')
  await leaving.accept()
  const failedReload: unknown = await reload
  if (failedReload !== null) expect(String(failedReload)).toContain('ERR_INTERNET_DISCONNECTED')
  await page.close()
  await context.setOffline(false)
  const reopened = await context.newPage()
  await reopened.goto('/admin/posts/new')
  // 源页已经关闭。此刻才建立全等基线，排除关闭前合法本机 put 更新时间的影响。
  const retainedBeforeRecovery = (await copies(reopened)).find(copy => copy.sessionId === original.sessionId)
  assert.ok(retainedBeforeRecovery)
  expect(retainedBeforeRecovery).toMatchObject({ postId: id, content: original.content, remote: null, pending: null })
  const recovery = reopened.getByRole('region', { name: 'Local recovery copies' })
  await expect(recovery).toContainText('Untitled draft')
  await recovery.getByRole('button', { name: 'Recover this copy', exact: true }).click()
  await expect(reopened.getByLabel('Body', { exact: true })).toHaveText(original.content.body)
  await expect(reopened).toHaveURL(`${runtime.origin}/admin/posts/new?draft=${id}`)
  await localSaved(reopened)
  await unsaved(reopened)
  await reopened.waitForTimeout(1500)
  expect(snapshot(runtime, id)).toEqual(emptyServer)
  expect(writes).toHaveLength(0)
  expect((await copies(reopened)).find(copy => copy.sessionId === original.sessionId)).toEqual(retainedBeforeRecovery)
  expect((await copies(reopened)).filter(copy => copy.postId === id).every(copy => copy.pending === null)).toBe(true)
  await reopened.getByLabel('Title', { exact: true }).fill('Recovered new draft')
  await reopened.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(reopened).toHaveURL(`${runtime.origin}/admin/posts/${id}`)
  await expect(reopened.getByText('Draft saved.', { exact: true })).toBeVisible()
  expect(snapshot(runtime, id).posts).toHaveLength(1)
  expect(snapshot(runtime, id).revisions).toHaveLength(1)
  expect(writes).toHaveLength(1)
})

test('自有 Chrome 进程真实重启后，磁盘中的未提交副本仍可恢复而不写服务器', async ({ runtime }, testInfo) => {
  test.setTimeout(90_000)
  const directory = mkdtempSync(join(tmpdir(), 'nim-writing-profile-'))
  let persistent: BrowserContext | undefined
  let browserClosed = true
  const errors: string[] = []
  const failures: unknown[] = []
  async function launch() {
    // launch 若失败且无法确认进程退出，也保留 profile，不推定它已安全释放。
    browserClosed = false
    const opened = await chromium.launchPersistentContext(directory, { channel: 'chrome', headless: true, baseURL: runtime.origin })
    persistent = opened
    const tracked = new Set<Page>()
    const observe = (page: Page) => {
      if (tracked.has(page)) return
      tracked.add(page)
      page.on('pageerror', error => errors.push(error.message))
    }
    opened.on('page', observe)
    for (const page of opened.pages()) observe(page)
    await opened.setExtraHTTPHeaders({ 'x-forwarded-for': runtime.nextAddress() })
    return opened
  }
  try {
    const firstContext = await launch()
    const firstActions = observeActions(firstContext)
    const first = firstContext.pages()[0] ?? await firstContext.newPage()
    await signIn(first, runtime.origin)
    await openNew(first)
    const id = await newDraftId(first)
    await firstContext.setOffline(true)
    await first.getByLabel('Body', { exact: true }).fill('Survives a real browser restart')
    await localSaved(first)
    const before = (await copies(first)).find(copy => copy.postId === id)
    assert.ok(before)
    expect(before.pending).toBeNull()
    expect(snapshot(runtime, id)).toEqual(emptyServer)
    expect(firstActions.writes).toHaveLength(0)
    await firstContext.close()
    persistent = undefined
    browserClosed = true

    const reopenedContext = await launch()
    const reopenedActions = observeActions(reopenedContext)
    const reopened = reopenedContext.pages()[0] ?? await reopenedContext.newPage()
    await signIn(reopened, runtime.origin)
    await reopened.goto('/admin/posts/new')
    const retained = (await copies(reopened)).find(copy => copy.sessionId === before.sessionId)
    assert.ok(retained)
    expect(retained).toMatchObject({ postId: id, content: before.content, remote: null, pending: null })
    const recovery = reopened.getByRole('region', { name: 'Local recovery copies' })
    await expect(recovery).toBeVisible()
    await recovery.getByRole('button', { name: 'Recover this copy', exact: true }).click()
    await expect(reopened.getByLabel('Body', { exact: true })).toHaveText(before.content.body)
    await expect(reopened).toHaveURL(`${runtime.origin}/admin/posts/new?draft=${id}`)
    await localSaved(reopened)
    await unsaved(reopened)
    await reopened.waitForTimeout(1500)
    expect(snapshot(runtime, id)).toEqual(emptyServer)
    expect(reopenedActions.writes).toHaveLength(0)
    expect((await copies(reopened)).find(copy => copy.sessionId === before.sessionId)).toEqual(retained)
  } catch (error) {
    failures.push(error)
  } finally {
    try {
      if (persistent) {
        await persistent.close()
        persistent = undefined
        browserClosed = true
      }
    } catch (error) { failures.push(error) }
    // 仅在自有浏览器明确退出后删除它的磁盘 profile，关闭失败则保留。
    if (browserClosed) {
      try { rmSync(directory, { recursive: true }) } catch (error) { failures.push(error) }
    }
    if (errors.length) failures.push(new Error(`Persistent Chrome pageerror: ${errors.join('\n')}`))
    await testInfo.attach('persistent-profile-cleanup.json', {
      body: JSON.stringify({ browserClosed, profileRemoved: !existsSync(directory), retainedProfile: existsSync(directory) ? directory : null, errors }),
      contentType: 'application/json',
    })
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length > 1) throw new AggregateError(failures, 'Chrome 持久化恢复或清理失败。')
})

test('同一文章两个离线标签保留独立 session，恢复 A 不删除 B，明确保存前服务器不变', async ({ page, context, login, runtime }) => {
  const { writes } = observeActions(context)
  await login()
  const draft = await withWritingStore(runtime, writer => createTestDraft(writer, { title: 'Two local sessions', description: '', body: 'Baseline' }))
  const baseline = snapshot(runtime, draft.id)
  await existing(page, draft)
  const other = await context.newPage()
  await existing(other, draft)
  await context.setOffline(true)
  await page.getByLabel('Body', { exact: true }).fill('Local tab A')
  await other.getByLabel('Body', { exact: true }).fill('Local tab B')
  await localSaved(page)
  await localSaved(other)
  const stored = (await copies(page)).filter(copy => copy.postId === draft.id)
  expect(stored.map(copy => copy.content.body).sort()).toEqual(['Local tab A', 'Local tab B'])
  expect(new Set(stored.map(copy => copy.sessionId)).size).toBe(2)
  expect(stored.every(copy => copy.pending === null && copy.remote?.revisionId === draft.revisionId)).toBe(true)
  expect(snapshot(runtime, draft.id)).toEqual(baseline)
  expect(writes).toHaveLength(0)
  await page.close()
  await other.close()
  await context.setOffline(false)
  const reopened = await context.newPage()
  await reopened.goto(`/admin/posts/${draft.id}`)
  const retainedB = (await copies(reopened)).find(copy => copy.content.body === 'Local tab B')
  assert.ok(retainedB)
  const recovery = reopened.getByRole('region', { name: 'Local recovery copies' })
  await expect(recovery.getByRole('button', { name: 'Recover this copy', exact: true })).toHaveCount(2)
  await recovery.getByRole('listitem').filter({ hasText: 'Local tab A' }).getByRole('button', { name: 'Recover this copy', exact: true }).click()
  await expect(reopened.getByLabel('Body', { exact: true })).toHaveText('Local tab A')
  await localSaved(reopened)
  await unsaved(reopened)
  await reopened.waitForTimeout(1500)
  expect((await copies(reopened)).find(copy => copy.sessionId === retainedB.sessionId)).toEqual(retainedB)
  expect(snapshot(runtime, draft.id)).toEqual(baseline)
  expect(writes).toHaveLength(0)
  await reopened.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(reopened.getByText('Draft saved.', { exact: true })).toBeVisible()
  expect(snapshot(runtime, draft.id).revisions).toHaveLength(2)
  expect(snapshot(runtime, draft.id).revisions.at(-1)?.body).toBe('Local tab A')
  expect((await copies(reopened)).find(copy => copy.sessionId === retainedB.sessionId)).toEqual(retainedB)
  expect(writes).toHaveLength(1)
})

test('离线期间远端 import 推进，重连只读发现冲突，选择服务器仍保留原本机分支', async ({ page, context, login, runtime }, testInfo) => {
  const { writes } = observeActions(context)
  await login()
  const draft = await withWritingStore(runtime, writer => createTestDraft(writer, { title: 'Reconnect conflict', description: '', body: 'Baseline' }))
  await existing(page, draft)
  await context.setOffline(true)
  await page.getByLabel('Body', { exact: true }).fill('Offline branch that must remain')
  await localSaved(page)
  const oldCopy = (await copies(page)).find(copy => copy.content.body === 'Offline branch that must remain')
  assert.ok(oldCopy)
  expect(oldCopy.pending).toBeNull()
  await withStore(runtime, store => store.importDraft({ id: draft.id, title: 'Remote import', description: '', body: 'Remote branch must remain' }))
  const remote = snapshot(runtime, draft.id)
  await context.setOffline(false)
  const conflict = page.getByRole('region', { name: 'Draft conflict' })
  await expect(conflict).toBeVisible()
  await expect(page.getByLabel('Body', { exact: true })).toHaveText(oldCopy.content.body)
  await conflict.getByText('Review server text', { exact: true }).click()
  await expect(conflict).toContainText('Remote branch must remain')
  expect(snapshot(runtime, draft.id)).toEqual(remote)
  expect(writes).toHaveLength(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: testInfo.outputPath('reconnect-conflict-mobile.png'), fullPage: true })
  await conflict.getByRole('button', { name: 'Use server draft', exact: true }).click()
  await noUnsaved(page)
  await localSaved(page)
  await expect(page.getByLabel('Body', { exact: true })).toHaveText('Remote branch must remain')
  await page.waitForTimeout(1500)
  const retained = (await copies(page)).find(copy => copy.sessionId === oldCopy.sessionId)
  assert.ok(retained)
  expect(retained).toMatchObject({ postId: draft.id, content: oldCopy.content, remote: oldCopy.remote, pending: null })
  expect(snapshot(runtime, draft.id)).toEqual(remote)
  expect(writes).toHaveLength(0)
})

test('冲突另存只产生新的本机 UUID，点击 Save 后才建新文章且原文章不变', async ({ page, context, login, runtime }) => {
  const { writes } = observeActions(context)
  await login()
  const draft = await withWritingStore(runtime, writer => createTestDraft(writer, { title: 'Fork conflict', description: '', body: 'Baseline' }))
  await existing(page, draft)
  await context.setOffline(true)
  await page.getByLabel('Body', { exact: true }).fill('Local fork content')
  await localSaved(page)
  await withStore(runtime, store => store.importDraft({ id: draft.id, title: draft.title, description: draft.description, body: 'Remote replacement' }))
  const original = snapshot(runtime, draft.id)
  await context.setOffline(false)
  const conflict = page.getByRole('region', { name: 'Draft conflict' })
  await expect(conflict).toBeVisible()
  await conflict.getByRole('button', { name: 'Keep local text as a new draft', exact: true }).click()
  const newId = await newDraftId(page)
  expect(newId).not.toBe(draft.id)
  await localSaved(page)
  await unsaved(page)
  await expect(page.getByLabel('Body', { exact: true })).toHaveText('Local fork content')
  await page.waitForTimeout(1500)
  expect(snapshot(runtime, newId)).toEqual(emptyServer)
  expect(snapshot(runtime, draft.id)).toEqual(original)
  expect(writes).toHaveLength(0)
  const fork = (await copies(page)).find(copy => copy.postId === newId)
  assert.ok(fork)
  expect(fork.remote).toBeNull()
  expect(fork.pending).toBeNull()
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByText('Draft saved.', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(`${runtime.origin}/admin/posts/${newId}`)
  expect(snapshot(runtime, draft.id)).toEqual(original)
  expect(snapshot(runtime, newId).posts).toHaveLength(1)
  expect(snapshot(runtime, newId).revisions).toHaveLength(1)
  expect(snapshot(runtime, newId).revisions[0].body).toBe('Local fork content')
  expect(writes).toHaveLength(1)
  expect(commandOf(writes[0])).toMatchObject({ postId: newId, expectedRevisionId: null, intent: 'save' })
})

test('原生 IDB put success 后事务 abort 显示本机失败，明确服务器保存和本机重试互不冒充', async ({ page, context, login, runtime }) => {
  const { writes } = observeActions(context)
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      const request = put.apply(this, args)
      if (this.transaction.db.name === 'nim-writing-recovery' && sessionStorage.getItem('nim-test-abort') === '1') {
        const transaction = this.transaction
        request.addEventListener('success', () => {
          sessionStorage.setItem('nim-test-put-succeeded', '1')
          transaction.abort()
        }, { once: true })
        transaction.addEventListener('abort', () => sessionStorage.setItem('nim-test-transaction-aborted', '1'), { once: true })
      }
      return request
    }
  })
  await login()
  const draft = await withWritingStore(runtime, writer => createTestDraft(writer, { title: 'IDB abort', description: '', body: 'Baseline' }))
  const baseline = snapshot(runtime, draft.id)
  await existing(page, draft)
  await page.evaluate(() => sessionStorage.setItem('nim-test-abort', '1'))
  await page.getByLabel('Body', { exact: true }).fill('Explicit save despite aborted local transaction')
  const unavailable = page.getByText('Local recovery is unavailable. Keep this page open or explicitly save to the server.', { exact: true })
  await expect(unavailable).toBeVisible()
  expect(await page.evaluate(() => [sessionStorage.getItem('nim-test-put-succeeded'), sessionStorage.getItem('nim-test-transaction-aborted')])).toEqual(['1', '1'])
  await expect(page.getByText('Recovery copy saved on this browser.', { exact: true })).toHaveCount(0)
  expect(await copies(page)).toEqual([])
  await page.waitForTimeout(1500)
  expect(snapshot(runtime, draft.id)).toEqual(baseline)
  expect(writes).toHaveLength(0)
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByText('Draft saved.', { exact: true })).toBeVisible()
  await expect(unavailable).toBeVisible()
  const saved = snapshot(runtime, draft.id)
  expect(saved.revisions).toHaveLength(2)
  expect(saved.revisions.at(-1)?.body).toBe('Explicit save despite aborted local transaction')
  expect(writes).toHaveLength(1)
  expect(await copies(page)).toEqual([])
  await page.evaluate(() => sessionStorage.removeItem('nim-test-abort'))
  await page.getByRole('button', { name: 'Retry local recovery', exact: true }).click()
  await localSaved(page)
  expect((await copies(page))[0]).toMatchObject({ content: { body: 'Explicit save despite aborted local transaction' }, pending: null, remote: { revisionId: saved.revisions.at(-1)?.id } })
  expect(snapshot(runtime, draft.id)).toEqual(saved)
  expect(writes).toHaveLength(1)
})

test('原始未来 v99 副本完整保留，恢复闸门及 Continue without restoring 均不授权自动写入', async ({ page, context, login, runtime }) => {
  const { writes } = observeActions(context)
  await login()
  const draft = await withWritingStore(runtime, writer => createTestDraft(writer, { title: 'Corrupt recovery', description: '', body: 'Baseline' }))
  await existing(page, draft)
  const damaged = { sessionId: randomUUID(), postId: draft.id, format: 'nim-recovery/v99', futureData: { text: 'must remain', nested: ['unknown', { keep: true }] } }
  await page.evaluate(async value => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('nim-writing-recovery')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('copies', 'readwrite')
        transaction.objectStore('copies').put(value)
        transaction.oncomplete = () => resolve()
        transaction.onabort = () => reject(transaction.error)
      })
    } finally { database.close() }
  }, damaged)
  await page.reload()
  const recovery = page.getByRole('region', { name: 'Local recovery copies' })
  await expect(recovery).toBeVisible()
  await expect(page.getByRole('form', { name: 'Draft' }).getByRole('alert')).toContainText('原有数据已保留')
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeDisabled()
  const before = snapshot(runtime, draft.id)
  await page.getByLabel('Body', { exact: true }).fill('Do not submit through failed recovery check')
  await expect(page.getByText('Local recovery is unavailable. Keep this page open or explicitly save to the server.', { exact: true })).toBeVisible()
  await page.waitForTimeout(1500)
  expect(snapshot(runtime, draft.id)).toEqual(before)
  expect(writes).toHaveLength(0)
  expect(await rawCopies(page)).toContainEqual(damaged)
  await recovery.getByRole('button', { name: 'Continue without restoring', exact: true }).click()
  await expect(recovery).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeEnabled()
  await page.waitForTimeout(1500)
  expect(snapshot(runtime, draft.id)).toEqual(before)
  expect(writes).toHaveLength(0)
  expect(await rawCopies(page)).toContainEqual(damaged)
})

test('从列表 Next Link 进入后真实 history.back 可取消，历史长度不增且在线未保存文本不上传', async ({ page, context, login, runtime }) => {
  const { writes } = observeActions(context)
  await login()
  const draft = await withWritingStore(runtime, writer => createTestDraft(writer, { title: 'Browser back guard', description: '', body: 'Baseline' }))
  const baseline = snapshot(runtime, draft.id)
  await page.goto('/admin')
  const documentToken = randomUUID()
  await page.evaluate(token => { Object.defineProperty(window, '__nimWritingDocument', { value: token }) }, documentToken)
  const listLength = await page.evaluate(() => history.length)
  const checked = page.waitForResponse(response => isRead(response.request()))
  await page.getByRole('link', { name: 'Browser back guard', exact: true }).click()
  expect((await checked).ok()).toBe(true)
  await noUnsaved(page)
  expect(await page.evaluate(() => Reflect.get(window, '__nimWritingDocument'))).toBe(documentToken)
  const length = await page.evaluate(() => history.length)
  expect(length).toBe(listLength + 1)
  await page.getByLabel('Body', { exact: true }).fill('Must remain after canceled Back')
  await localSaved(page)
  await page.waitForTimeout(1500)
  await page.evaluate(() => history.back())
  const warning = page.getByRole('alertdialog')
  await expect(warning).toBeVisible()
  const surfaceColor = await warning.evaluate(element => getComputedStyle(element).backgroundColor)
  const actionColor = await warning.getByRole('button', { name: 'Leave page', exact: true }).evaluate(element => getComputedStyle(element).backgroundColor)
  expect(surfaceColor).not.toBe('rgba(0, 0, 0, 0)')
  expect(actionColor).not.toBe('rgba(0, 0, 0, 0)')
  await page.keyboard.press('Escape')
  await expect(warning).toHaveCount(0)
  await expect(page).toHaveURL(`${runtime.origin}/admin/posts/${draft.id}`)
  await expect(page.getByLabel('Body', { exact: true })).toHaveText('Must remain after canceled Back')
  expect(await page.evaluate(() => history.length)).toBe(length)
  expect(await page.evaluate(() => Reflect.get(window, '__nimWritingDocument'))).toBe(documentToken)
  expect(snapshot(runtime, draft.id)).toEqual(baseline)
  expect(writes).toHaveLength(0)

  await page.evaluate(() => history.back())
  await expect(warning).toBeVisible()
  await warning.getByRole('button', { name: 'Leave page', exact: true }).click()
  await expect(page).toHaveURL(`${runtime.origin}/admin`)
  expect(await page.evaluate(() => history.length)).toBe(length)
  expect(await page.evaluate(() => Reflect.get(window, '__nimWritingDocument'))).toBe(documentToken)
  expect(snapshot(runtime, draft.id)).toEqual(baseline)
  expect(writes).toHaveLength(0)
})

test('未保存时当前链接离开可取消，下载只取已保存正文，真正新标签链接不触发离开确认', async ({ page, context, login, runtime }) => {
  const { writes } = observeActions(context)
  await login()
  const draft = await withWritingStore(runtime, writer => createTestDraft(writer, { title: 'Leave guard', description: '', body: 'Last explicitly saved body' }))
  const baseline = snapshot(runtime, draft.id)
  await existing(page, draft)
  await page.getByLabel('Body', { exact: true }).fill('Protected unsubmitted local text')
  await localSaved(page)
  const warning = page.getByRole('alertdialog')
  await page.getByRole('link', { name: 'Back to posts', exact: true }).click()
  await expect(warning).toBeVisible()
  await warning.getByRole('button', { name: 'Stay on page', exact: true }).click()
  await expect(warning).toHaveCount(0)
  await expect(page).toHaveURL(`${runtime.origin}/admin/posts/${draft.id}`)
  await expect(page.getByLabel('Body', { exact: true })).toHaveText('Protected unsubmitted local text')
  expect(snapshot(runtime, draft.id)).toEqual(baseline)

  const unexpectedDialogs: string[] = []
  const dismissUnexpected = (opened: Dialog) => {
    unexpectedDialogs.push(opened.type())
    void opened.dismiss()
  }
  page.on('dialog', dismissUnexpected)
  try {
    const downloading = page.waitForEvent('download')
    await page.getByRole('link', { name: 'Download saved draft', exact: true }).click()
    const download = await downloading
    expect(download.suggestedFilename()).toBe(`${draft.id}.md`)
    const source = await downloadText(download)
    expect(source).toContain('Last explicitly saved body')
    expect(source).not.toContain('Protected unsubmitted local text')
    expect(snapshot(runtime, draft.id)).toEqual(baseline)
    expect(writes).toHaveLength(0)

    await context.setOffline(true)
    await withStore(runtime, store => store.importDraft({ id: draft.id, title: draft.title, description: draft.description, body: 'Separate server update' }))
    const remote = snapshot(runtime, draft.id)
    await context.setOffline(false)
    const conflict = page.getByRole('region', { name: 'Draft conflict' })
    await expect(conflict).toBeVisible()
    const opening = page.waitForEvent('popup')
    await conflict.getByRole('link', { name: 'Review server draft in a new tab', exact: true }).click()
    const popup = await opening
    await expect(popup).toHaveURL(`${runtime.origin}/admin/posts/${draft.id}`)
    await expect(popup.getByRole('form', { name: 'Draft' })).toBeVisible()
    await popup.close()
    expect(unexpectedDialogs).toEqual([])
    await expect(page.getByLabel('Body', { exact: true })).toHaveText('Protected unsubmitted local text')
    expect(snapshot(runtime, draft.id)).toEqual(remote)
    expect(writes).toHaveLength(0)
    await page.getByRole('link', { name: 'Back to posts', exact: true }).click()
    await expect(warning).toBeVisible()
    await warning.getByRole('button', { name: 'Leave page', exact: true }).click()
    await expect(page).toHaveURL(`${runtime.origin}/admin`)
    expect(snapshot(runtime, draft.id)).toEqual(remote)
    expect(writes).toHaveLength(0)
  } finally { page.off('dialog', dismissUnexpected) }
})

test('离线明确 Save 的 pending 只能由 Retry previous save 重发原快照，重连检查和恢复均不重发', async ({ page, context, login, runtime }) => {
  const { writes, inspections } = observeActions(context)
  await login()
  await openNew(page)
  const id = await newDraftId(page)
  await page.getByLabel('Title', { exact: true }).fill('Pending explicit save')
  await page.getByLabel('Body', { exact: true }).fill('Original submitted snapshot')
  await localSaved(page)
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Unconfirmed operation' })).toBeVisible()
  await localSaved(page)
  const original = (await copies(page)).find(copy => copy.postId === id && copy.pending !== null)
  assert.ok(original?.pending)
  expect(original.pending).toMatchObject({ postId: id, intent: 'save', expectedRevisionId: null, content: { body: 'Original submitted snapshot' } })
  expect(original.remote).toBeNull()
  expect(writes).toHaveLength(1)
  expect(commandOf(writes[0])).toEqual(original.pending)
  expect(snapshot(runtime, id)).toEqual(emptyServer)
  await page.getByLabel('Body', { exact: true }).fill('Newer input not submitted by retry')
  await localSaved(page)
  const onlineCheck = page.waitForResponse(response => isInspection(response.request()))
  await context.setOffline(false)
  expect((await onlineCheck).ok()).toBe(true)
  await expect(page.getByRole('button', { name: 'Check previous operation', exact: true })).toBeVisible()
  await checkPrevious(page)
  await expect(page.getByText('The previous operation is not confirmed. Your input is preserved.', { exact: true })).toBeVisible()
  await page.waitForTimeout(1500)
  expect(inspections).toHaveLength(2)
  expect(writes).toHaveLength(1)
  expect(snapshot(runtime, id)).toEqual(emptyServer)
  const edited = (await copies(page)).find(copy => copy.sessionId === original.sessionId)
  assert.ok(edited)
  expect(edited.content.body).toBe('Newer input not submitted by retry')
  expect(edited.pending).toEqual(original.pending)
  await page.close()

  const reopened = await context.newPage()
  await reopened.goto('/admin/posts/new')
  const retained = (await copies(reopened)).find(copy => copy.sessionId === original.sessionId)
  assert.ok(retained)
  const recoveredCheck = reopened.waitForResponse(response => isInspection(response.request()))
  await reopened.getByRole('region', { name: 'Local recovery copies' }).getByRole('button', { name: 'Recover this copy', exact: true }).click()
  expect((await recoveredCheck).ok()).toBe(true)
  await expect(reopened).toHaveURL(`${runtime.origin}/admin/posts/new?draft=${id}`)
  await expect(reopened.getByLabel('Body', { exact: true })).toHaveText(edited.content.body)
  await expect(reopened.getByRole('region', { name: 'Unconfirmed operation' })).toBeVisible()
  await expect(reopened.getByText('The previous operation is not confirmed. Your input is preserved.', { exact: true })).toBeVisible()
  await reopened.waitForTimeout(1500)
  expect(inspections).toHaveLength(3)
  expect(writes).toHaveLength(1)
  expect(snapshot(runtime, id)).toEqual(emptyServer)
  expect((await copies(reopened)).find(copy => copy.sessionId === original.sessionId)).toEqual(retained)

  await reopened.getByRole('button', { name: 'Retry previous save', exact: true }).click()
  await expect(reopened).toHaveURL(`${runtime.origin}/admin/posts/${id}`)
  await expect(reopened.getByRole('region', { name: 'Unconfirmed operation' })).toHaveCount(0)
  await unsaved(reopened)
  await localSaved(reopened)
  await expect(reopened.getByLabel('Body', { exact: true })).toHaveText(edited.content.body)
  const retried = snapshot(runtime, id)
  expect(retried.posts).toHaveLength(1)
  expect(retried.revisions).toHaveLength(1)
  expect(retried.revisions[0].body).toBe('Original submitted snapshot')
  expect(retried.receipts.map(receipt => receipt.operationId)).toEqual([original.pending.operationId])
  expect(writes).toHaveLength(2)
  expect(commandOf(writes[1])).toEqual(original.pending)
  await reopened.waitForTimeout(1500)
  expect(snapshot(runtime, id)).toEqual(retried)
  expect(writes).toHaveLength(2)
  await reopened.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(reopened.getByText('Draft saved.', { exact: true })).toBeVisible()
  const savedNewer = snapshot(runtime, id)
  expect(savedNewer.revisions).toHaveLength(2)
  expect(savedNewer.revisions.at(-1)?.body).toBe(edited.content.body)
  expect(savedNewer.receipts).toHaveLength(2)
  expect(writes).toHaveLength(3)
  expect(commandOf(writes[2])).toMatchObject({ postId: id, expectedRevisionId: retried.revisions[0].id, intent: 'save', content: edited.content })
  expect(commandOf(writes[2]).operationId).not.toBe(original.pending.operationId)
})

test('明确 Save 已提交但响应丢失，关页恢复只 inspect 原回执，不重复写且较新输入仍保留', async ({ page, context, login, runtime }) => {
  const { writes, inspections } = observeActions(context)
  let responseLost = false
  await context.route('**/admin/**', async route => {
    if (isWrite(route.request()) && !responseLost) {
      responseLost = true
      const response = await route.fetch()
      expect(response.ok()).toBe(true)
      await route.abort('failed')
    } else await route.continue()
  })
  await login()
  await openNew(page)
  const id = await newDraftId(page)
  await page.getByLabel('Title', { exact: true }).fill('Committed without response')
  await page.getByLabel('Body', { exact: true }).fill('Server committed original snapshot')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Unconfirmed operation' })).toBeVisible()
  expect(responseLost).toBe(true)
  expect(writes).toHaveLength(1)
  const submitted = commandOf(writes[0])
  const committed = snapshot(runtime, id)
  expect(committed.revisions).toHaveLength(1)
  expect(committed.revisions[0].body).toBe(submitted.content.body)
  expect(committed.receipts.map(receipt => receipt.operationId)).toEqual([submitted.operationId])
  await page.getByLabel('Body', { exact: true }).fill('Newer local text after lost response')
  await localSaved(page)
  const original = (await copies(page)).find(copy => copy.postId === id && copy.pending?.operationId === submitted.operationId)
  assert.ok(original)
  expect(original.remote).toBeNull()
  expect(original.pending).toEqual(submitted)
  await page.close()

  const reopened = await context.newPage()
  await reopened.goto('/admin/posts/new')
  const retained = (await copies(reopened)).find(copy => copy.sessionId === original.sessionId)
  assert.ok(retained)
  const checked = reopened.waitForResponse(response => isInspection(response.request()))
  await reopened.getByRole('region', { name: 'Local recovery copies' }).getByRole('button', { name: 'Recover this copy', exact: true }).click()
  expect((await checked).ok()).toBe(true)
  await expect(reopened).toHaveURL(`${runtime.origin}/admin/posts/${id}`)
  await expect(reopened.getByRole('region', { name: 'Unconfirmed operation' })).toHaveCount(0)
  await expect(reopened.getByLabel('Body', { exact: true })).toHaveText('Newer local text after lost response')
  await localSaved(reopened)
  await unsaved(reopened)
  expect(inspections).toHaveLength(1)
  expect(writes).toHaveLength(1)
  await expect.poll(async () => (await copies(reopened)).some(copy => copy.sessionId !== original.sessionId && copy.postId === id
    && copy.content.body === original.content.body && copy.pending === null && copy.remote?.revisionId === committed.revisions[0].id)).toBe(true)
  await reopened.waitForTimeout(1500)
  expect(snapshot(runtime, id)).toEqual(committed)
  expect(writes).toHaveLength(1)
  expect((await copies(reopened)).find(copy => copy.sessionId === original.sessionId)).toEqual(retained)
})

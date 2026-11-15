import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium, type BrowserContext, type Page } from '@playwright/test'
import { recoveryCopySchema } from '../lib/writing'
import { test, expect, signIn, snapshot, withStore } from './fixtures'

async function copies(page: Page) {
  const values = await page.evaluate(async () => {
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
  return recoveryCopySchema.array().parse(values)
}

async function synced(page: Page) { await expect(page.getByText('Synced to server.', { exact: true })).toBeVisible() }
async function localSaved(page: Page) { await expect(page.getByText('Recovery copy saved on this browser.', { exact: true })).toBeVisible() }

async function existing(page: Page, draft: { id: string }) {
  await page.goto(`/admin/posts/${draft.id}`)
  await synced(page)
}

test('自动工作稿保留未完成标题，停笔多次不铺进明确历史，发布只取可见内容', async ({ page, login, runtime }) => {
  await login()
  await page.goto('/admin/posts/new')
  await expect(page.getByText('Ready to write.', { exact: true })).toBeVisible()
  await page.getByLabel('Body', { exact: true }).fill('正文尚未有标题\n')
  await localSaved(page)
  await synced(page)
  const local = (await copies(page)).find(copy => copy.content.body === '正文尚未有标题\n')
  assert.ok(local)
  expect(local.isNew).toBe(true)
  expect(snapshot(runtime, local.postId).revisions).toHaveLength(0)
  expect(snapshot(runtime, local.postId).workingCopies[0].title).toBe('')
  expect((await page.request.get(`/blog/${local.postId}`)).status()).toBe(404)
  expect((await page.request.get(`/admin/posts/${local.postId}/export`)).status()).toBe(422)
  await page.getByLabel('Title', { exact: true }).fill('Autosaved article')
  await synced(page)
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByText('Draft saved.', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(`${runtime.origin}/admin/posts/${local.postId}`)
  const checkpoint = snapshot(runtime, local.postId)
  expect(checkpoint.revisions).toHaveLength(1)
  for (const text of ['First automatic continuation', 'Second automatic continuation']) {
    await page.getByLabel('Body', { exact: true }).fill(text)
    await synced(page)
  }
  expect(snapshot(runtime, local.postId).revisions).toEqual(checkpoint.revisions)
  expect(snapshot(runtime, local.postId).publications).toEqual([])
  const download = await page.request.get(`/admin/posts/${local.postId}/export`)
  expect(await download.text()).toContain('Second automatic continuation')
  await page.getByLabel('Body', { exact: true }).fill('Visible publish snapshot')
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByText('Post published.', { exact: true })).toBeVisible()
  const after = snapshot(runtime, local.postId)
  expect(after.revisions).toHaveLength(2)
  expect(after.publications).toHaveLength(1)
  expect(after.revisions.at(-1)?.body).toBe('Visible publish snapshot')
})

test('保存后从列表再次新建产生独立身份，不复用前一篇编辑会话', async ({ page, login, runtime }) => {
  await login()
  await page.getByRole('link', { name: 'New draft', exact: true }).click()
  await expect(page.getByText('Ready to write.', { exact: true })).toBeVisible()
  await page.getByLabel('Title', { exact: true }).fill('First navigation intent')
  await page.getByLabel('Body', { exact: true }).fill('First document text')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page).toHaveURL(/\/admin\/posts\/[0-9a-f-]{36}$/)
  await localSaved(page)
  await synced(page)
  const firstId = new URL(page.url()).pathname.split('/').at(-1)
  assert.ok(firstId)
  await page.getByRole('link', { name: 'Back to posts', exact: true }).click()
  await page.getByRole('link', { name: 'New draft', exact: true }).click()
  await expect(page.getByText('Ready to write.', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Body', { exact: true })).toHaveValue('')
  const secondId = new URL(page.url()).searchParams.get('draft')
  assert.ok(secondId && secondId !== firstId)
  await page.getByLabel('Title', { exact: true }).fill('Second navigation intent')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page).toHaveURL(`${runtime.origin}/admin/posts/${secondId}`)
  expect(snapshot(runtime, firstId).workingCopies[0].body).toBe('First document text')
  expect(snapshot(runtime, secondId).revisions).toHaveLength(1)
})

test('离线新稿关页后从 IndexedDB 恢复原身份和未确认请求，不重复创建', async ({ page, context, login, runtime }, testInfo) => {
  await login()
  await page.goto('/admin/posts/new')
  await expect(page.getByText('Ready to write.', { exact: true })).toBeVisible()
  await context.setOffline(true)
  await page.getByLabel('Body', { exact: true }).fill('离线未完成的新稿\n')
  await localSaved(page)
  await expect(page.getByText('Server sync is not confirmed. Your input is preserved.', { exact: true })).toBeVisible()
  const original = (await copies(page)).find(copy => copy.content.body === '离线未完成的新稿\n')
  assert.ok(original?.pending)
  expect(snapshot(runtime, original.postId).posts).toEqual([])
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
  const retainedBeforeRecovery = (await copies(reopened)).find(copy => copy.sessionId === original.sessionId)
  assert.ok(retainedBeforeRecovery)
  expect(retainedBeforeRecovery).toEqual({ ...original, updatedAt: retainedBeforeRecovery.updatedAt })
  const recovery = reopened.getByRole('region', { name: 'Local recovery copies' })
  await expect(recovery).toContainText('Untitled draft')
  await recovery.getByRole('button', { name: 'Recover this copy', exact: true }).click()
  await expect(reopened.getByLabel('Body', { exact: true })).toHaveValue(original.content.body)
  await synced(reopened)
  const restored = snapshot(runtime, original.postId)
  expect(restored.posts).toHaveLength(1)
  expect(restored.revisions).toHaveLength(0)
  expect(restored.receipts.map(receipt => receipt.operationId)).toContain(original.pending.operationId)
  expect((await copies(reopened)).find(copy => copy.sessionId === original.sessionId)).toEqual(retainedBeforeRecovery)
  await reopened.getByLabel('Title', { exact: true }).fill('Recovered new draft')
  await reopened.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(reopened.getByText('Draft saved.', { exact: true })).toBeVisible()
  await expect(reopened).toHaveURL(`${runtime.origin}/admin/posts/${original.postId}`)
  expect(snapshot(runtime, original.postId).revisions).toHaveLength(1)
  expect(await withStore(runtime, store => store.listPosts().filter(post => post.title === 'Recovered new draft'))).toHaveLength(1)
})

test('浏览器进程重启后，磁盘中的新稿副本仍可恢复', async ({ runtime }, testInfo) => {
  const directory = mkdtempSync(join(tmpdir(), 'nim-writing-profile-'))
  let persistent: BrowserContext | undefined
  const errors: string[] = []
  try {
    persistent = await chromium.launchPersistentContext(directory, { channel: 'chrome', headless: true, baseURL: runtime.origin })
    await persistent.setExtraHTTPHeaders({ 'x-forwarded-for': runtime.nextAddress() })
    const first = persistent.pages()[0] ?? await persistent.newPage()
    first.on('pageerror', error => errors.push(error.message))
    await signIn(first, runtime.origin)
    await first.goto('/admin/posts/new')
    await expect(first.getByText('Ready to write.', { exact: true })).toBeVisible()
    await persistent.setOffline(true)
    await first.getByLabel('Body', { exact: true }).fill('Survives a real browser restart')
    await localSaved(first)
    await expect(first.getByText('Server sync is not confirmed. Your input is preserved.', { exact: true })).toBeVisible()
    const before = (await copies(first)).find(copy => copy.content.body === 'Survives a real browser restart')
    assert.ok(before?.pending)
    await persistent.close()
    persistent = undefined
    persistent = await chromium.launchPersistentContext(directory, { channel: 'chrome', headless: true, baseURL: runtime.origin })
    await persistent.setExtraHTTPHeaders({ 'x-forwarded-for': runtime.nextAddress() })
    const reopened = persistent.pages()[0] ?? await persistent.newPage()
    reopened.on('pageerror', error => errors.push(error.message))
    await signIn(reopened, runtime.origin)
    await reopened.goto('/admin/posts/new')
    const recovery = reopened.getByRole('region', { name: 'Local recovery copies' })
    await expect(recovery).toBeVisible()
    await recovery.getByRole('button', { name: 'Recover this copy', exact: true }).click()
    await synced(reopened)
    await expect(reopened.getByLabel('Body', { exact: true })).toHaveValue(before.content.body)
    expect(snapshot(runtime, before.postId).receipts.map(receipt => receipt.operationId)).toContain(before.pending.operationId)
    expect(snapshot(runtime, before.postId).revisions).toEqual([])
    expect(errors).toEqual([])
  } finally {
    // close 确认自有浏览器退出后才删除它的 profile，失败时保留供检查。
    await persistent?.close()
    rmSync(directory, { recursive: true })
    await testInfo.attach('persistent-profile-cleanup.json', { body: JSON.stringify({ browserClosed: true, profileRemoved: true }), contentType: 'application/json' })
  }
})

test('同一文章两个离线标签各存独立副本，重开可选择且不删除另一个分支', async ({ page, context, login, runtime }) => {
  await login()
  const draft = await withStore(runtime, store => store.createDraft({ title: 'Two local sessions', description: '', body: 'Baseline' }))
  await existing(page, draft)
  const other = await context.newPage()
  await existing(other, draft)
  await context.setOffline(true)
  await page.getByLabel('Body', { exact: true }).fill('Local tab A')
  await other.getByLabel('Body', { exact: true }).fill('Local tab B')
  await localSaved(page)
  await localSaved(other)
  const stored = await copies(page)
  expect(stored.filter(copy => copy.postId === draft.id).map(copy => copy.content.body).sort()).toEqual(['Local tab A', 'Local tab B'])
  expect(new Set(stored.map(copy => copy.sessionId)).size).toBe(2)
  await page.close()
  await other.close()
  await context.setOffline(false)
  const reopened = await context.newPage()
  await reopened.goto(`/admin/posts/${draft.id}`)
  const recovery = reopened.getByRole('region', { name: 'Local recovery copies' })
  await expect(recovery.getByRole('button', { name: 'Recover this copy', exact: true })).toHaveCount(2)
  const chosen = recovery.getByRole('listitem').filter({ hasText: 'Local tab A' })
  await chosen.getByRole('button', { name: 'Recover this copy', exact: true }).click()
  await synced(reopened)
  await expect(reopened.getByLabel('Body', { exact: true })).toHaveValue('Local tab A')
  expect((await copies(reopened)).filter(copy => copy.content.body === 'Local tab B')).toHaveLength(1)
  expect(snapshot(runtime, draft.id).revisions).toHaveLength(1)
})

test('重连先检查远端，冲突不覆盖，选择服务器后本机旧分支仍可回溯', async ({ page, context, login, runtime }, testInfo) => {
  await login()
  const draft = await withStore(runtime, store => store.createDraft({ title: 'Reconnect conflict', description: '', body: 'Baseline' }))
  await existing(page, draft)
  await context.setOffline(true)
  await page.getByLabel('Body', { exact: true }).fill('Offline branch that must remain')
  await localSaved(page)
  await expect(page.getByText('Server sync is not confirmed. Your input is preserved.', { exact: true })).toBeVisible()
  const oldCopy = (await copies(page)).find(copy => copy.content.body === 'Offline branch that must remain')
  assert.ok(oldCopy)
  await withStore(runtime, store => store.importDraft({ id: draft.id, title: 'Remote import', description: '', body: 'Remote branch must remain' }))
  const remote = snapshot(runtime, draft.id)
  await context.setOffline(false)
  const conflict = page.getByRole('region', { name: 'Draft conflict' })
  await expect(conflict).toBeVisible()
  await expect(page.getByLabel('Body', { exact: true })).toHaveValue('Offline branch that must remain')
  await expect(conflict).toContainText('Remote branch must remain')
  expect(snapshot(runtime, draft.id)).toEqual(remote)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: testInfo.outputPath('reconnect-conflict-mobile.png'), fullPage: true })
  await conflict.getByRole('button', { name: 'Use server draft', exact: true }).click()
  await synced(page)
  await expect(page.getByLabel('Body', { exact: true })).toHaveValue('Remote branch must remain')
  expect((await copies(page)).find(copy => copy.sessionId === oldCopy.sessionId)?.content.body).toBe(oldCopy.content.body)
  expect(snapshot(runtime, draft.id)).toEqual(remote)
})

test('冲突时可以保留本机文本为新文章，不覆盖原文章或复用旧请求身份', async ({ page, login, runtime }) => {
  await login()
  const draft = await withStore(runtime, store => store.createDraft({ title: 'Fork conflict', description: '', body: 'Baseline' }))
  await existing(page, draft)
  await withStore(runtime, store => store.importDraft({ ...draft, body: 'Remote replacement' }))
  await page.getByLabel('Body', { exact: true }).fill('Local fork content')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  const conflict = page.getByRole('region', { name: 'Draft conflict' })
  await expect(conflict).toBeVisible()
  const original = snapshot(runtime, draft.id)
  await conflict.getByRole('button', { name: 'Keep local text as a new draft', exact: true }).click()
  await synced(page)
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByText('Draft saved.', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/posts\/[0-9a-f-]{36}$/)
  const newId = new URL(page.url()).pathname.split('/').at(-1)
  assert.ok(newId && newId !== draft.id)
  expect(snapshot(runtime, draft.id)).toEqual(original)
  expect(snapshot(runtime, newId).workingCopies[0].body).toBe('Local fork content')
  expect(snapshot(runtime, newId).revisions).toHaveLength(1)
})

test('真实 IDB 请求成功后事务中止也必须显示失败，不能误报本机保存', async ({ page, login, runtime }) => {
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function(this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      const request = put.apply(this, args)
      if (this.transaction.db.name === 'nim-writing-recovery' && sessionStorage.getItem('nim-test-abort') === '1') {
        const transaction = this.transaction
        request.addEventListener('success', () => transaction.abort(), { once: true })
      }
      return request
    }
  })
  await login()
  const draft = await withStore(runtime, store => store.createDraft({ title: 'IDB abort', description: '', body: 'Baseline' }))
  await existing(page, draft)
  await page.evaluate(() => sessionStorage.setItem('nim-test-abort', '1'))
  await page.getByLabel('Body', { exact: true }).fill('Server saved but local transaction aborted')
  await expect(page.getByText('Local recovery is unavailable. Keep this page open or save to the server.', { exact: true })).toBeVisible()
  await synced(page)
  await expect(page.getByText('Recovery copy saved on this browser.', { exact: true })).toHaveCount(0)
  expect(await copies(page)).toEqual([])
  expect(snapshot(runtime, draft.id).workingCopies[0].body).toBe('Server saved but local transaction aborted')
  await page.evaluate(() => sessionStorage.removeItem('nim-test-abort'))
  await page.getByRole('button', { name: 'Retry sync', exact: true }).click()
  await localSaved(page)
  expect((await copies(page))[0].content.body).toBe('Server saved but local transaction aborted')
})

test('未知本机格式不被剥离或覆盖，恢复检查失败时自动同步保持关闭', async ({ page, login, runtime }) => {
  await login()
  const draft = await withStore(runtime, store => store.createDraft({ title: 'Corrupt recovery', description: '', body: 'Baseline' }))
  await existing(page, draft)
  const damagedId = randomUUID()
  await page.evaluate(async ({ sessionId, postId }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('nim-writing-recovery')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('copies', 'readwrite')
        transaction.objectStore('copies').put({ sessionId, postId, format: 'nim-recovery/v99', futureData: 'must remain' })
        transaction.oncomplete = () => resolve()
        transaction.onabort = () => reject(transaction.error)
      })
    } finally { database.close() }
  }, { sessionId: damagedId, postId: draft.id })
  await page.reload()
  await expect(page.getByRole('region', { name: 'Local recovery copies' })).toBeVisible()
  await expect(page.getByRole('form', { name: 'Draft' }).getByRole('alert')).toContainText('原有数据已保留')
  const before = snapshot(runtime, draft.id)
  await page.getByLabel('Body', { exact: true }).fill('Do not sync through failed recovery check')
  await expect(page.getByText('Local recovery is unavailable. Keep this page open or save to the server.', { exact: true })).toBeVisible()
  // 经过停笔窗口后仍应被恢复闸门挡住，不只是检查某个瞬间没有请求。
  await page.waitForTimeout(1500)
  expect(snapshot(runtime, draft.id)).toEqual(before)
  const remains = await page.evaluate(async sessionId => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('nim-writing-recovery')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const transaction = database.transaction('copies', 'readonly')
        const request = transaction.objectStore('copies').get(sessionId)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    } finally { database.close() }
  }, damagedId)
  expect(remains).toEqual({ sessionId: damagedId, postId: draft.id, format: 'nim-recovery/v99', futureData: 'must remain' })
})

test('同文档后退在未同步时可以取消，不向历史栈插入占位记录', async ({ page, context, login, runtime }) => {
  await login()
  const draft = await withStore(runtime, store => store.createDraft({ title: 'Browser back guard', description: '', body: 'Baseline' }))
  await page.goto('/admin')
  await page.getByRole('link', { name: 'Browser back guard', exact: true }).click()
  await synced(page)
  const length = await page.evaluate(() => history.length)
  await context.setOffline(true)
  await page.getByLabel('Body', { exact: true }).fill('Must remain after canceled Back')
  await localSaved(page)
  const dialog = page.waitForEvent('dialog')
  const back = page.evaluate(() => history.back())
  const warning = await dialog
  expect(warning.type()).toBe('confirm')
  await warning.dismiss()
  await back
  await expect(page).toHaveURL(`${runtime.origin}/admin/posts/${draft.id}`)
  await expect(page.getByLabel('Body', { exact: true })).toHaveValue('Must remain after canceled Back')
  expect(await page.evaluate(() => history.length)).toBe(length)
  await context.setOffline(false)
  await synced(page)
})

test('未同步时当前标签离开可取消，下载不拦截，刷新关闭仍有本机副本', async ({ page, context, login, runtime }) => {
  await login()
  const draft = await withStore(runtime, store => store.createDraft({ title: 'Leave guard', description: '', body: 'Baseline' }))
  await existing(page, draft)
  await context.setOffline(true)
  await page.getByLabel('Body', { exact: true }).fill('Protected local text')
  await localSaved(page)
  const dialog = page.waitForEvent('dialog')
  const leaving = page.getByRole('link', { name: 'Back to posts', exact: true }).click()
  const warning = await dialog
  expect(warning.type()).toBe('confirm')
  await warning.dismiss()
  await leaving
  await expect(page).toHaveURL(`${runtime.origin}/admin/posts/${draft.id}`)
  await expect(page.getByLabel('Body', { exact: true })).toHaveValue('Protected local text')
  expect((await copies(page)).some(copy => copy.content.body === 'Protected local text')).toBe(true)
  await context.setOffline(false)
  await synced(page)
  const download = page.waitForEvent('download')
  await page.getByRole('link', { name: 'Download server draft', exact: true }).click()
  expect((await download).suggestedFilename()).toBe(`${draft.id}.md`)
})

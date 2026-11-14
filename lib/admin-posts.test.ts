// @vitest-environment node
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAdminSession } from './auth'
import { initializeDatabase, openDatabase } from './database'
import * as databaseModule from './database'
import { getAdminDraft, getAdminPosts, getAdminRevisionHistory, withAdminPostStore } from './admin-posts'

vi.mock('server-only', () => ({}))
vi.mock('./auth', () => ({ getAdminSession: vi.fn() }))

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'nim-admin-posts-'))
  vi.stubEnv('DATABASE_PATH', join(directory, 'nim.sqlite'))
  vi.mocked(getAdminSession).mockReset()
  vi.mocked(getAdminSession).mockResolvedValue({
    session: {
      id: 'session-id',
      userId: 'admin-id',
      token: 'session-token',
      expiresAt: new Date('2099-01-01'),
      createdAt: new Date('2026-11-14'),
      updatedAt: new Date('2026-11-14'),
    },
    user: {
      id: 'admin-id',
      name: 'Admin',
      email: 'admin@example.test',
      emailVerified: true,
      createdAt: new Date('2026-11-14'),
      updatedAt: new Date('2026-11-14'),
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  if (directory) rmSync(directory, { recursive: true })
})

describe('管理端文章访问', () => {
  it('未通过身份验证时返回拒绝结果，不打开文章存储或执行内容操作', async () => {
    vi.mocked(getAdminSession).mockResolvedValue(null)
    const operation = vi.fn()

    expect(await withAdminPostStore(operation)).toEqual({ authorized: false })
    expect(operation).not.toHaveBeenCalled()
    expect(existsSync(join(directory, 'nim.sqlite'))).toBe(false)
  })

  it('未登录读取页面数据仍交给框架导航，不提前判断文章是否存在', async () => {
    vi.mocked(getAdminSession).mockResolvedValue(null)

    for (const read of [
      () => getAdminPosts(),
      () => getAdminDraft('missing'),
      () => getAdminRevisionHistory('missing', { page: '0' }),
    ]) {
      await expect(read()).rejects.toMatchObject({ digest: expect.stringMatching(/^NEXT_REDIRECT;/) })
    }
    expect(existsSync(join(directory, 'nim.sqlite'))).toBe(false)
  })

  it('认证存储故障向上传播，不当作未登录', async () => {
    const error = new Error('Session storage unavailable')
    vi.mocked(getAdminSession).mockRejectedValue(error)
    const operation = vi.fn()

    await expect(withAdminPostStore(operation)).rejects.toBe(error)
    expect(operation).not.toHaveBeenCalled()
    expect(existsSync(join(directory, 'nim.sqlite'))).toBe(false)
  })

  it('数据库无法打开时传播错误，不执行内容操作', async () => {
    const operation = vi.fn()

    await expect(withAdminPostStore(operation)).rejects.toThrow()
    expect(operation).not.toHaveBeenCalled()
  })

  it('经过验证后可以创建、读取和保存同一草稿，管理列表保持最新内容', async () => {
    await initializeDatabase()
    const first = {
      title: 'First title',
      description: 'Description.',
      body: '# First body',
    }
    const created = await withAdminPostStore(store => store.createDraft(first))
    assert.ok(created.authorized)
    const draft = created.value
    expect(await getAdminDraft(draft.id)).toEqual(draft)
    expect(await getAdminDraft('missing')).toBeNull()

    const saved = await withAdminPostStore(store =>
      store.saveDraft(draft.id, { ...first, body: '# Edited body' }, draft.revisionId),
    )
    assert.ok(saved.authorized && saved.value.status === 'success')
    const edited = saved.value.value
    expect(await getAdminDraft(draft.id)).toEqual(edited)
    expect(await getAdminPosts()).toEqual([
      {
        id: draft.id,
        title: first.title,
        description: first.description,
        updatedAt: edited.updatedAt,
        status: 'draft',
      },
    ])
    expect(await withAdminPostStore(store => store.getPublishedPost(draft.id)))
      .toEqual({ authorized: true, value: null })
  })

  it('历史查询返回同一快照的草稿、公开指针和选中修订，列表仅含摘要', async () => {
    await initializeDatabase()
    const first = { title: 'Initial title', description: 'Original summary', body: '# Original body' }
    const result = await withAdminPostStore(store => {
      const draft = store.createDraft(first)
      const edited = store.saveDraft(draft.id, { ...first, body: '# Changed body' }, draft.revisionId)
      assert.ok(edited.status === 'success')
      const published = store.publishDraft(draft.id, edited.value, edited.value.revisionId)
      assert.ok(published.status === 'success')
      return { draft, edited: edited.value, published: published.value }
    })
    assert.ok(result.authorized)
    const { draft, edited, published } = result.value
    const history = await getAdminRevisionHistory(draft.id, {
      page: '1', revisionId: String(draft.revisionId),
    })

    assert.ok(history)
    expect(history.draft).toEqual(edited)
    expect(history.published).toEqual(published)
    expect(history.selectedRevision).toMatchObject({ id: draft.revisionId, ...first })
    expect(history.revisionCount).toBe(2)
    expect(history.page).toBe(1)
    for (const revision of history.revisions) {
      expect(revision).not.toHaveProperty('body')
      expect(revision).not.toHaveProperty('description')
    }
  })

  it('历史页只接受共享schema定义的查询，非法查询或不存在的选择返回缺失结果', async () => {
    await initializeDatabase()
    const result = await withAdminPostStore(store => store.createDraft({
      title: 'History query', description: '', body: '# Body',
    }))
    assert.ok(result.authorized)
    const id = result.value.id
    for (const query of [
      null,
      { page: ['1', '2'] },
      { revisionId: ['1', '2'] },
      { page: '0' },
      { page: '1.5' },
      { page: '2e0' },
      { revisionId: '0' },
      { page: '99' },
      { revisionId: String(Number.MAX_SAFE_INTEGER) },
    ]) {
      expect(await getAdminRevisionHistory(id, query)).toBeNull()
    }
    expect(await getAdminRevisionHistory(id)).toMatchObject({ page: 1, revisionCount: 1 })
    expect(await getAdminRevisionHistory('missing')).toBeNull()
  })

  it('异步操作等待期间保持连接打开，完成后返回已解析值并关闭连接', async () => {
    await initializeDatabase()
    const database = openDatabase()
    vi.spyOn(databaseModule, 'openDatabase').mockReturnValue(database)
    const close = vi.spyOn(database.$client, 'close')
    const entered = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    const content = { title: 'Async draft', description: '', body: '# Async body' }
    const pending = withAdminPostStore(async store => {
      entered.resolve()
      await resume.promise
      expect(database.$client.open).toBe(true)
      return store.createDraft(content)
    })

    await entered.promise
    expect(database.$client.open).toBe(true)
    expect(close).not.toHaveBeenCalled()
    resume.resolve()
    const result = await pending

    assert.ok(result.authorized)
    expect(result.value.title).toBe(content.title)
    expect(result.value.revisionId).toBeGreaterThan(0)
    expect(close).toHaveBeenCalledTimes(1)
    expect(database.$client.open).toBe(false)
  })

  it('异步操作拒绝时也等待结束再关闭连接，并原样传播错误', async () => {
    await initializeDatabase()
    const database = openDatabase()
    vi.spyOn(databaseModule, 'openDatabase').mockReturnValue(database)
    const close = vi.spyOn(database.$client, 'close')
    const entered = Promise.withResolvers<void>()
    const resume = Promise.withResolvers<void>()
    const error = new Error('Async operation failed')
    const pending = withAdminPostStore(async () => {
      entered.resolve()
      await resume.promise
      throw error
    })

    await entered.promise
    expect(database.$client.open).toBe(true)
    expect(close).not.toHaveBeenCalled()
    const rejected = expect(pending).rejects.toBe(error)
    resume.resolve()
    await rejected
    expect(close).toHaveBeenCalledTimes(1)
    expect(database.$client.open).toBe(false)
  })
})

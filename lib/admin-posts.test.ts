// @vitest-environment node
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAdminSession } from './auth'
import { initializeDatabase } from './database'
import { getAdminDraft, getAdminPosts, withAdminPostStore } from './admin-posts'

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

    for (const read of [() => getAdminPosts(), () => getAdminDraft('missing')]) {
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
      store.saveDraft(draft.id, { ...first, body: '# Edited body' }),
    )
    assert.ok(saved.authorized && saved.value)
    const edited = saved.value
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
})

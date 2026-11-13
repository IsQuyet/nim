// @vitest-environment node
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requireAdminSession } from './auth'
import { initializeDatabase } from './database'
import { getAdminDraft, getAdminPosts, withAdminPostStore } from './admin-posts'

vi.mock('server-only', () => ({}))
vi.mock('./auth', () => ({ requireAdminSession: vi.fn() }))

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'nim-admin-posts-'))
  vi.stubEnv('DATABASE_PATH', join(directory, 'nim.sqlite'))
  vi.mocked(requireAdminSession).mockReset()
  vi.mocked(requireAdminSession).mockResolvedValue({
    githubId: '1234',
    expires: '2099-01-01T00:00:00Z',
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  if (directory) rmSync(directory, { recursive: true })
})

describe('管理端文章访问', () => {
  it('未通过身份验证时不创建或读取数据库，也不执行存储操作', async () => {
    const denied = new Error('Redirect to sign-in')
    vi.mocked(requireAdminSession).mockRejectedValue(denied)
    const operation = vi.fn()

    await expect(withAdminPostStore(operation)).rejects.toBe(denied)
    expect(operation).not.toHaveBeenCalled()
    expect(existsSync(join(directory, 'nim.sqlite'))).toBe(false)
  })

  it('数据库无法打开时归类为存储错误，不执行内容操作', async () => {
    const operation = vi.fn()

    await expect(withAdminPostStore(operation)).rejects.toMatchObject({
      name: 'AdminPostStoreError',
      cause: expect.any(Error),
    })
    expect(operation).not.toHaveBeenCalled()
  })

  it('经过验证后可以创建、读取和保存同一草稿，管理列表保持最新内容', async () => {
    initializeDatabase()
    const first = {
      title: 'First title',
      description: 'Description.',
      body: '# First body',
    }
    const draft = await withAdminPostStore((store) => store.createDraft(first))
    expect(await getAdminDraft(draft.id)).toEqual(draft)

    const edited = await withAdminPostStore((store) =>
      store.saveDraft(draft.id, { ...first, body: '# Edited body' }),
    )
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
    expect(
      await withAdminPostStore((store) => store.getPublishedPost(draft.id)),
    ).toBeNull()
  })
})

// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { redirect } from 'next/navigation'
import { withAdminPostStore } from '@/modules/posts/server/admin'
import type { PostStore, PublishedPost } from '@/modules/posts/model'
import { readPublishedPostAction } from './comparison-actions'

vi.mock('@/modules/posts/server/admin', () => ({ withAdminPostStore: vi.fn() }))

const published: PublishedPost = {
  id: randomUUID(), title: 'Published title', description: 'Published summary', body: '# Published body',
  revisionId: 4, publicationId: 3,
  createdAt: '2026-11-15T01:00:00.000Z', publishedAt: '2026-11-15T02:00:00.000Z',
}
const getPublishedPost = vi.fn<PostStore['getPublishedPost']>()
const store = {
  createImportedDraftOnce: vi.fn<PostStore['createImportedDraftOnce']>(),
  restoreRevision: vi.fn<PostStore['restoreRevision']>(),
  importDraft: vi.fn<PostStore['importDraft']>(),
  getDraft: vi.fn<PostStore['getDraft']>(),
  getPublishedPost,
  getRevision: vi.fn<PostStore['getRevision']>(),
  getRevisionHistory: vi.fn<PostStore['getRevisionHistory']>(),
  listRevisions: vi.fn<PostStore['listRevisions']>(),
  listPublications: vi.fn<PostStore['listPublications']>(),
  listPosts: vi.fn<PostStore['listPosts']>(),
  listPublishedPosts: vi.fn<PostStore['listPublishedPosts']>(),
} satisfies PostStore

beforeEach(() => {
  vi.resetAllMocks()
  store.getPublishedPost.mockReturnValue(published)
  vi.mocked(withAdminPostStore).mockImplementation(async operation => ({
    authorized: true,
    value: await operation(store),
  }))
})

describe('发布版本只读比较入口', () => {
  it('鉴权失败时不读取输入或数据库', async () => {
    vi.mocked(withAdminPostStore).mockResolvedValue({ authorized: false })
    const read = vi.fn(() => { throw new Error('Must not parse before auth') })
    const input = Object.defineProperty({}, 'id', { get: read })

    expect(await readPublishedPostAction(input)).toEqual({
      status: 'error', message: 'Sign in to compare with the published version.', signInRequired: true,
    })
    expect(read).not.toHaveBeenCalled()
    expect(store.getPublishedPost).not.toHaveBeenCalled()
  })

  it('校验文章身份后只读读取当前公开版本或未发布状态', async () => {
    expect(await readPublishedPostAction(published.id)).toEqual({ status: 'success', value: published })
    expect(store.getPublishedPost).toHaveBeenCalledExactlyOnceWith(published.id)
    store.getPublishedPost.mockReturnValue(null)
    expect(await readPublishedPostAction(published.id)).toEqual({ status: 'success', value: null })
    expect(store.getPublishedPost).toHaveBeenCalledTimes(2)
  })

  it('拒绝非法文章身份，不访问存储', async () => {
    for (const input of [null, '', 'not-a-uuid']) {
      expect(await readPublishedPostAction(input)).toEqual({ status: 'error', message: 'Invalid post ID.' })
    }
    expect(store.getPublishedPost).not.toHaveBeenCalled()
  })

  it('存储故障返回可见错误且不冒充未发布', async () => {
    const error = new Error('database unavailable')
    store.getPublishedPost.mockImplementation(() => { throw error })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await readPublishedPostAction(published.id)).toEqual({
      status: 'error', message: 'Could not load the published version.',
    })
    expect(log).toHaveBeenCalledWith('读取文章发布版本失败。', error)
    log.mockRestore()
  })

  it('Next 控制流原样传播', async () => {
    store.getPublishedPost.mockImplementation(() => redirect('/admin/login'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(readPublishedPostAction(published.id)).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;/),
    })
    expect(log).not.toHaveBeenCalled()
    log.mockRestore()
  })
})

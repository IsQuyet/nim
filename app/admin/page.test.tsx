import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostSummary } from '@/lib/posts'
import AdminPage from './page'

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  openDatabase: vi.fn(),
  createPostStore: vi.fn(),
  listPosts: vi.fn(),
  close: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAdminSession: mocks.requireAdminSession }))
vi.mock('@/lib/database', () => ({ openDatabase: mocks.openDatabase }))
vi.mock('@/lib/posts', () => ({ createPostStore: mocks.createPostStore }))

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.requireAdminSession.mockResolvedValue({ githubId: '1234' })
  mocks.openDatabase.mockReturnValue({ close: mocks.close })
  mocks.createPostStore.mockReturnValue({ listPosts: mocks.listPosts })
  mocks.listPosts.mockReturnValue([])
})

describe('管理员文章列表', () => {
  it('未通过管理员验证时不读取数据库', async () => {
    const denied = new Error('Redirect to sign-in')
    mocks.requireAdminSession.mockRejectedValue(denied)

    await expect(AdminPage()).rejects.toBe(denied)
    expect(mocks.openDatabase).not.toHaveBeenCalled()
  })

  it('没有文章时显示空状态', async () => {
    render(await AdminPage())

    expect(screen.getByText('No posts yet.')).toBeDefined()
    expect(screen.queryByRole('list', { name: 'Posts' })).toBeNull()
    expect(mocks.close).toHaveBeenCalledOnce()
  })

  it('展示草稿摘要与发布状态，仅为已有发布版本提供公开阅读链接', async () => {
    const posts: PostSummary[] = [
      {
        id: '3f4229bc-e848-47fc-88b0-358c90b111b5',
        title: 'Draft title',
        description: 'Private description.',
        updatedAt: '2026-11-13T12:00:00Z',
        status: 'draft',
      },
      {
        id: '68767e8c-c86e-4b97-bb15-356c2553f49c',
        title: 'Published title',
        description: 'Published description.',
        updatedAt: '2026-11-12T12:00:00Z',
        status: 'published',
      },
      {
        id: '9ea8d4be-4b45-46d2-954c-3e1da354d33f',
        title: 'Edited title',
        description: 'Edited description.',
        updatedAt: '2026-11-11T12:00:00Z',
        status: 'modified',
      },
    ]
    mocks.listPosts.mockReturnValue(posts)

    render(await AdminPage())

    const items = within(screen.getByRole('list', { name: 'Posts' })).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    const labels = ['Draft', 'Published', 'Unpublished changes']
    for (const [index, item] of items.entries()) {
      expect(within(item).getByRole('heading', { name: posts[index].title })).toBeDefined()
      expect(within(item).getByText(posts[index].description)).toBeDefined()
      expect(within(item).getByText(labels[index])).toBeDefined()
      expect(within(item).getByText(`/blog/${posts[index].id}`)).toBeDefined()
      expect(item.querySelector('time')?.getAttribute('datetime')).toBe(posts[index].updatedAt)
    }
    expect(within(items[0]).queryByRole('link', { name: 'View published' })).toBeNull()
    expect(within(items[1]).getByRole('link', { name: 'View published' }).getAttribute('href'))
      .toBe(`/blog/${posts[1].id}`)
    expect(within(items[2]).getByRole('link', { name: 'View published' }).getAttribute('href'))
      .toBe(`/blog/${posts[2].id}`)
    expect(mocks.close).toHaveBeenCalledOnce()
  })
})

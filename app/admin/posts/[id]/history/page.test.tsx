import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostRevisionHistory } from '@/modules/posts/history'
import type { PostRevision } from '@/modules/posts/model'
import RevisionHistoryPage from './page'

const mocks = vi.hoisted(() => ({
  getAdminRevisionHistory: vi.fn(),
  restoreRevisionAction: vi.fn(),
}))
vi.mock('@/modules/posts/server/admin', () => ({ getAdminRevisionHistory: mocks.getAdminRevisionHistory }))
vi.mock('@/modules/posts/server/actions/history', () => ({ restoreRevisionAction: mocks.restoreRevisionAction }))

const id = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'

function createHistory(): PostRevisionHistory {
  const publishedRevision: PostRevision = {
    id: 4, postId: id, title: 'Published title', description: 'Public summary',
    body: 'PUBLIC_BODY_NOT_SELECTED', createdAt: '2026-11-15T01:00:00.000Z',
    source: 'publish', restoredFromRevisionId: null,
  }
  const draftRevision: PostRevision = {
    id: 7, postId: id, title: 'Current draft title', description: 'Current draft summary',
    body: 'DRAFT_BODY_NOT_SELECTED', createdAt: '2026-11-14T01:00:00.000Z',
    source: 'save', restoredFromRevisionId: null,
  }
  const selectedRevision: PostRevision = {
    id: 6, postId: id, title: 'Selected title', description: 'Selected description',
    body: '# Selected snapshot\n\n| Name | Value |\n| --- | --- |\n| Selected | 1 |',
    createdAt: '2026-11-13T01:00:00.000Z', source: 'restore', restoredFromRevisionId: 4,
  }
  return {
    draft: {
      id, revisionId: draftRevision.id, title: draftRevision.title,
      description: draftRevision.description, body: draftRevision.body,
      createdAt: '2026-11-01T00:00:00.000Z', updatedAt: draftRevision.createdAt,
    },
    published: {
      id, revisionId: publishedRevision.id, publicationId: 3,
      title: publishedRevision.title, description: publishedRevision.description, body: publishedRevision.body,
      createdAt: '2026-11-01T00:00:00.000Z', publishedAt: '2026-11-15T02:00:00.000Z',
    },
    selectedRevision,
    revisions: [publishedRevision, draftRevision, selectedRevision],
    page: 2, pageCount: 3, revisionCount: 45,
  }
}

// 预览模块按需加载，首次加载耗时不属于各用例等待渲染结果的时限。
beforeAll(async () => { await import('@/modules/markdown/ui/preview') })

beforeEach(() => {
  mocks.getAdminRevisionHistory.mockReset()
  mocks.getAdminRevisionHistory.mockResolvedValue(createHistory())
  mocks.restoreRevisionAction.mockReset()
  mocks.restoreRevisionAction.mockResolvedValue({ status: 'error', message: 'Restore result in test.' })
})

async function renderHistory(query: Record<string, string | string[] | undefined> = {}) {
  const result = render(await RevisionHistoryPage({
    params: Promise.resolve({ id }), searchParams: Promise.resolve(query),
  }))
  await waitFor(() => {
    expect(screen.queryByText('Loading preview…')).toBeNull()
    expect(screen.queryByText('Rendering preview…')).toBeNull()
  })
  return result
}

describe('管理员修订历史页', () => {
  it('权限检查失败时不渲染历史，即使查询参数也无效', async () => {
    const denied = new Error('Redirect to sign-in')
    mocks.getAdminRevisionHistory.mockRejectedValue(denied)
    await expect(RevisionHistoryPage({
      params: Promise.resolve({ id }), searchParams: Promise.resolve({ page: '0' }),
    })).rejects.toBe(denied)
    expect(mocks.getAdminRevisionHistory).toHaveBeenCalledExactlyOnceWith(id, { page: '0' })
    expect(screen.queryByRole('list', { name: 'Revisions' })).toBeNull()
  })

  it.each([
    { page: ['1', '2'] },
    { page: '0' },
    { revisionId: '999' },
    { page: '99' },
  ])('查询层拒绝非法、缺失或超范围选择时返回notFound：%j', async query => {
    mocks.getAdminRevisionHistory.mockResolvedValue(null)
    await expect(RevisionHistoryPage({
      params: Promise.resolve({ id }), searchParams: Promise.resolve(query),
    })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' })
    expect(mocks.getAdminRevisionHistory).toHaveBeenCalledExactlyOnceWith(id, query)
  })

  it('按查询层提供的时间顺序显示摘要、真实时间和来源，并标识草稿及公开版本', async () => {
    await renderHistory({ page: '2', revisionId: '6' })
    const list = screen.getByRole('list', { name: 'Revisions' })
    const items = within(list).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items.map(item => within(item).getAllByRole('link')[0].textContent))
      .toEqual(['Published title', 'Current draft title', 'Selected title'])
    expect(items.map(item => item.querySelector('time')?.getAttribute('datetime'))).toEqual([
      '2026-11-15T01:00:00.000Z', '2026-11-14T01:00:00.000Z', '2026-11-13T01:00:00.000Z',
    ])
    expect(within(items[0]).getByText('Currently published')).toBeDefined()
    expect(within(items[1]).getByText('Last saved revision')).toBeDefined()
    expect(within(items[0]).getByText('Published')).toBeDefined()
    expect(within(items[1]).getByText('Saved')).toBeDefined()
    expect(within(items[2]).getByText('Restored')).toBeDefined()
    expect(within(items[2]).getByRole('link', { name: 'Selected title' }).getAttribute('aria-current'))
      .toBe('true')
    expect(within(items[2]).getByRole('link', { name: 'Restored from revision 4' }).getAttribute('href'))
      .toBe(`/admin/posts/${id}/history?page=2&revisionId=4`)
  })

  it('并排渲染发布版与选中修订，排除当前草稿指针正文', async () => {
    const { container } = await renderHistory()
    const comparison = screen.getByRole('region', { name: 'Rendered version comparison' })
    const published = within(comparison).getByRole('article', { name: 'Published version' })
    const selected = within(comparison).getByRole('article', { name: 'Selected revision' })
    expect(within(published).getByText('Published title')).toBeDefined()
    expect(within(published).getByText('Public summary')).toBeDefined()
    expect(within(published).getByText('PUBLIC_BODY_NOT_SELECTED')).toBeDefined()
    expect(within(selected).getByText('Selected title')).toBeDefined()
    expect(within(selected).getByText('Selected description')).toBeDefined()
    expect(within(selected).getByRole('heading', { name: /Selected snapshot/ })).toBeDefined()
    expect(within(selected).getByRole('table')).toBeDefined()
    expect(container.textContent).not.toContain('DRAFT_BODY_NOT_SELECTED')
  })

  it('没有发布版时明确说明，并只显示选中修订的阅读预览', async () => {
    mocks.getAdminRevisionHistory.mockResolvedValue({ ...createHistory(), published: null })
    await renderHistory()
    const comparison = screen.getByRole('region', { name: 'Rendered version comparison' })
    expect(within(comparison).getByRole('status').textContent).toBe('This post has not been published yet.')
    expect(within(comparison).queryByRole('article', { name: 'Published version' })).toBeNull()
    expect(within(comparison).getByRole('article', { name: 'Selected revision' })).toBeDefined()
  })

  it('分页保留当前选择，摘要链接保留当前页', async () => {
    await renderHistory({ page: '2', revisionId: '6' })
    const nav = screen.getByRole('navigation', { name: 'Revision pages' })
    expect(within(nav).getByText('Page 2 of 3')).toBeDefined()
    expect(within(nav).getByRole('link', { name: 'Previous page' }).getAttribute('href'))
      .toBe(`/admin/posts/${id}/history?page=1&revisionId=6`)
    expect(within(nav).getByRole('link', { name: 'Next page' }).getAttribute('href'))
      .toBe(`/admin/posts/${id}/history?page=3&revisionId=6`)
    expect(within(screen.getByRole('list', { name: 'Revisions' }))
      .getByRole('link', { name: 'Current draft title' }).getAttribute('href'))
      .toBe(`/admin/posts/${id}/history?page=2&revisionId=7`)
  })

  it.each([1, 3])('第%d页不提供越界分页链接', async page => {
    mocks.getAdminRevisionHistory.mockResolvedValue({ ...createHistory(), page })
    await renderHistory({ page: String(page) })
    const nav = screen.getByRole('navigation', { name: 'Revision pages' })
    expect(within(nav).queryByRole('link', { name: page === 1 ? 'Previous page' : 'Next page' })).toBeNull()
  })

  it('内容与草稿相同但修订身份不同时也禁用恢复', async () => {
    const history = createHistory()
    history.selectedRevision = {
      ...history.selectedRevision, title: history.draft.title,
      description: history.draft.description, body: history.draft.body,
    }
    mocks.getAdminRevisionHistory.mockResolvedValue(history)
    await renderHistory()
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Restore draft' })
    expect(button.disabled).toBe(true)
    expect(screen.getByText('This revision matches the current draft.')).toBeDefined()
    fireEvent.click(button)
    expect(mocks.restoreRevisionAction).not.toHaveBeenCalled()
  })

  it('恢复操作绑定文章、选中修订和当前草稿基线，而不是列表行或公开指针', async () => {
    await renderHistory()
    fireEvent.click(screen.getByRole('button', { name: 'Restore draft' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Restore result in test.')
    expect(mocks.restoreRevisionAction).toHaveBeenCalledTimes(1)
    expect(mocks.restoreRevisionAction.mock.calls[0].slice(0, 3)).toEqual([
      id, { revisionId: 6, expectedRevisionId: 7 }, { status: 'idle' },
    ])
  })
})

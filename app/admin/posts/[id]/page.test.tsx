import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EditDraftPage from './page'

const mocks = vi.hoisted(() => ({ getAdminDraft: vi.fn() }))
vi.mock('@/lib/admin-posts', () => ({ getAdminDraft: mocks.getAdminDraft }))
vi.mock('../../actions', () => ({ saveDraftAction: vi.fn(), publishDraftAction: vi.fn() }))
vi.mock('../../post-editor', () => ({ PostEditor: () => null }))

const id = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'

beforeEach(() => {
  mocks.getAdminDraft.mockReset()
  mocks.getAdminDraft.mockResolvedValue({
    id, revisionId: 3, title: 'Saved title', description: '', body: '# Saved body',
    createdAt: '2026-11-15T00:00:00Z', updatedAt: '2026-11-15T01:00:00Z',
  })
})

describe('编辑页面的已保存文件下载入口', () => {
  it('仅在权限检查成功后显示原生下载链接，明确下载已保存草稿', async () => {
    render(await EditDraftPage({ params: Promise.resolve({ id }) }))
    const link = screen.getByRole('link', { name: 'Download saved draft' })
    expect(link.tagName).toBe('A')
    expect(link.hasAttribute('download')).toBe(true)
    expect(link.getAttribute('href')).toBe(`/admin/posts/${id}/export`)
  })

  it('未通过权限检查时不生成下载入口', async () => {
    const denied = new Error('Redirect to sign-in')
    mocks.getAdminDraft.mockRejectedValue(denied)
    await expect(EditDraftPage({ params: Promise.resolve({ id }) })).rejects.toBe(denied)
    expect(screen.queryByRole('link', { name: 'Download saved draft' })).toBeNull()
  })
})

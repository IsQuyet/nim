import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EditDraftPage from './page'

const mocks = vi.hoisted(() => ({ getAdminDraft: vi.fn(), editor: vi.fn() }))
vi.mock('@/lib/admin-posts', () => ({ getAdminDraft: mocks.getAdminDraft }))
vi.mock('../../post-editor', () => ({ PostEditor: mocks.editor }))
const id = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'
const draft = {
  id, revisionId: 3, title: 'Saved title', description: '', body: 'Saved body',
  createdAt: '2026-11-15T00:00:00Z', updatedAt: '2026-11-15T01:00:00Z',
}

beforeEach(() => {
  mocks.getAdminDraft.mockReset().mockResolvedValue(draft)
  mocks.editor.mockReset().mockReturnValue(null)
})

describe('明确保存的草稿编辑页面', () => {
  it('读取当前草稿，把身份和修订基线交给编辑器', async () => {
    render(await EditDraftPage({ params: Promise.resolve({ id }) }))
    expect(screen.getByRole('heading', { name: 'Edit draft' })).toBeDefined()
    expect(mocks.editor.mock.calls[0][0]).toEqual({ postId: id, initial: draft })
  })

  it('未通过权限检查时不生成编辑器', async () => {
    const denied = new Error('Redirect to sign-in')
    mocks.getAdminDraft.mockRejectedValue(denied)
    await expect(EditDraftPage({ params: Promise.resolve({ id }) })).rejects.toBe(denied)
    expect(mocks.editor).not.toHaveBeenCalled()
  })

  it('不存在的草稿返回 notFound，不凭本机输入创建文章', async () => {
    mocks.getAdminDraft.mockResolvedValue(null)
    await expect(EditDraftPage({ params: Promise.resolve({ id }) })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' })
  })
})

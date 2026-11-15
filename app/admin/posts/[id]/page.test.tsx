import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EditDraftPage from './page'

const mocks = vi.hoisted(() => ({ getAdminWorkingCopy: vi.fn(), editor: vi.fn() }))
vi.mock('@/lib/admin-posts', () => ({ getAdminWorkingCopy: mocks.getAdminWorkingCopy }))
vi.mock('../../post-editor', () => ({ PostEditor: mocks.editor }))
const id = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'
const working = {
  id, version: 'working-version', checkpointRevisionId: null,
  title: '', description: '', body: 'Automatically saved without a title',
  createdAt: '2026-11-15T00:00:00Z', updatedAt: '2026-11-15T01:00:00Z',
}

beforeEach(() => {
  mocks.getAdminWorkingCopy.mockReset().mockResolvedValue(working)
  mocks.editor.mockReset().mockReturnValue(null)
})

describe('工作稿编辑页面', () => {
  it('未有明确修订的新工作稿也能打开，把身份和工作版本完整交给编辑器', async () => {
    render(await EditDraftPage({ params: Promise.resolve({ id }) }))
    expect(screen.getByRole('heading', { name: 'Edit draft' })).toBeDefined()
    expect(mocks.editor.mock.calls[0][0]).toEqual({ postId: id, initial: working })
  })

  it('未通过权限检查时不生成编辑器', async () => {
    const denied = new Error('Redirect to sign-in')
    mocks.getAdminWorkingCopy.mockRejectedValue(denied)
    await expect(EditDraftPage({ params: Promise.resolve({ id }) })).rejects.toBe(denied)
    expect(mocks.editor).not.toHaveBeenCalled()
  })

  it('不存在的工作稿返回 notFound', async () => {
    mocks.getAdminWorkingCopy.mockResolvedValue(null)
    await expect(EditDraftPage({ params: Promise.resolve({ id }) })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' })
  })
})

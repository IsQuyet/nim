import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import NewDraftPage from './page'

const mocks = vi.hoisted(() => ({ requireAdminSession: vi.fn(), getAdminDraft: vi.fn(), editor: vi.fn() }))
vi.mock('@/modules/auth/server/auth', () => ({ requireAdminSession: mocks.requireAdminSession }))
vi.mock('@/modules/posts/server/admin', () => ({ getAdminDraft: mocks.getAdminDraft }))
vi.mock('../../post-editor', () => ({ PostEditor: mocks.editor }))
const id = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAdminSession.mockResolvedValue({})
  mocks.getAdminDraft.mockResolvedValue(null)
  mocks.editor.mockReturnValue(null)
})

describe('新稿入口身份', () => {
  it('无身份时导航到带 UUID 的稳定新稿入口，不提前建立数据库稿件', async () => {
    await expect(NewDraftPage({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({
      digest: expect.stringMatching(/^NEXT_REDIRECT;replace;\/admin\/posts\/new\?draft=[0-9a-f-]{36};307;$/),
    })
    expect(mocks.editor).not.toHaveBeenCalled()
    expect(mocks.getAdminDraft).not.toHaveBeenCalled()
  })

  it('显式身份跨 RSC 请求稳定，已有明确草稿完整传入', async () => {
    const initial = { id, revisionId: 2, title: 'Saved title', description: '', body: 'Saved body', createdAt: '2026-11-15T00:00:00Z', updatedAt: '2026-11-15T00:00:00Z' }
    mocks.getAdminDraft.mockResolvedValue(initial)
    render(await NewDraftPage({ searchParams: Promise.resolve({ draft: id }) }))
    expect(mocks.getAdminDraft).toHaveBeenCalledExactlyOnceWith(id)
    expect(mocks.editor.mock.calls[0][0]).toEqual({ postId: id, initial })
  })

  it.each(['invalid', ['one', 'two']])('非法身份不静默换成另一篇新稿：%j', async draft => {
    await expect(NewDraftPage({ searchParams: Promise.resolve({ draft }) })).rejects.toMatchObject({ digest: 'NEXT_HTTP_ERROR_FALLBACK;404' })
    expect(mocks.getAdminDraft).not.toHaveBeenCalled()
  })

  it('鉴权先于读取显式身份', async () => {
    const denied = new Error('Unauthorized')
    mocks.requireAdminSession.mockRejectedValue(denied)
    const read = vi.fn(() => id)
    await expect(NewDraftPage({ searchParams: Promise.resolve({ get draft() { return read() } }) })).rejects.toBe(denied)
    expect(read).not.toHaveBeenCalled()
    expect(mocks.getAdminDraft).not.toHaveBeenCalled()
  })
})

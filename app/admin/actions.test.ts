import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDraftAction, saveDraftAction } from './actions'

const { AdminPostStoreError, mocks } = vi.hoisted(() => ({
  AdminPostStoreError: class extends Error {
    constructor(cause: unknown) {
      super('文章存储访问失败。', { cause })
      this.name = 'AdminPostStoreError'
    }
  },
  mocks: {
    withAdminPostStore: vi.fn(),
    createDraft: vi.fn(),
    saveDraft: vi.fn(),
    revalidatePath: vi.fn(),
    redirect: vi.fn(),
  },
}))

vi.mock('@/lib/admin-posts', () => ({
  AdminPostStoreError,
  withAdminPostStore: mocks.withAdminPostStore,
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }))

const id = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'
const content = {
  title: 'A draft',
  description: '',
  body: '# Body\r\n\n  indented content\n',
}
const draft = {
  ...content,
  id,
  createdAt: '2026-11-14T00:00:00Z',
  updatedAt: '2026-11-14T00:00:00Z',
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.withAdminPostStore.mockImplementation(async (operation) => {
    try {
      return operation({
        createDraft: mocks.createDraft,
        saveDraft: mocks.saveDraft,
      })
    } catch (error) {
      throw new AdminPostStoreError(error)
    }
  })
  mocks.createDraft.mockReturnValue(draft)
  mocks.saveDraft.mockReturnValue(draft)
  mocks.redirect.mockImplementation((path) => {
    throw new Error(`Redirect: ${path}`)
  })
})

describe('草稿保存入口', () => {
  it('身份验证失败时不校验或保存内容，并将登录控制交回框架', async () => {
    const denied = new Error('Redirect to sign-in')
    mocks.withAdminPostStore.mockRejectedValue(denied)

    await expect(createDraftAction({ status: 'idle' }, null)).rejects.toBe(
      denied,
    )
    expect(mocks.createDraft).not.toHaveBeenCalled()
    expect(mocks.saveDraft).not.toHaveBeenCalled()
  })

  it('拒绝空白标题和非文本内容，不执行写入', async () => {
    const blank = await createDraftAction(
      { status: 'idle' },
      { ...content, title: '  ' },
    )
    expect(blank).toEqual({ status: 'error', message: 'Enter a title.' })
    const invalid = await createDraftAction(
      { status: 'idle' },
      { ...content, body: 123 },
    )
    expect(invalid.status).toBe('error')
    expect(mocks.createDraft).not.toHaveBeenCalled()
  })

  it('创建时只传内容，并跳转到系统返回 ID 对应的编辑页', async () => {
    await expect(
      createDraftAction({ status: 'idle' }, content),
    ).rejects.toThrow(`Redirect: /admin/posts/${id}`)

    expect(mocks.createDraft).toHaveBeenCalledExactlyOnceWith(content)
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith('/admin')
    expect(mocks.saveDraft).not.toHaveBeenCalled()
  })

  it('保存保留正文原文并刷新管理页面，不刷新公开页面', async () => {
    expect(await saveDraftAction(id, { status: 'idle' }, content)).toEqual({
      status: 'saved',
      content,
    })

    expect(mocks.saveDraft).toHaveBeenCalledExactlyOnceWith(id, content)
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ['/admin'],
      [`/admin/posts/${id}`],
    ])
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('不存在的草稿返回明确反馈，不刷新页面', async () => {
    mocks.saveDraft.mockReturnValue(null)
    expect(await saveDraftAction(id, { status: 'idle' }, content)).toEqual({
      status: 'error',
      message: 'This draft does not exist.',
    })
    expect(mocks.saveDraft).toHaveBeenCalledExactlyOnceWith(id, content)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('数据库连接失败时同样返回表单错误，而不让操作抛出到编辑器', async () => {
    const error = new AdminPostStoreError(new Error('Unable to open database'))
    mocks.withAdminPostStore.mockRejectedValue(error)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await saveDraftAction(id, { status: 'idle' }, content)).toEqual({
      status: 'error',
      message: 'Could not save the draft. Please try again.',
    })
    expect(log).toHaveBeenCalledWith('保存草稿失败。', error)
    expect(mocks.saveDraft).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('存储失败时记录错误并返回保存失败反馈', async () => {
    const error = new Error('Storage unavailable')
    mocks.saveDraft.mockImplementation(() => {
      throw error
    })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await saveDraftAction(id, { status: 'idle' }, content)).toEqual({
      status: 'error',
      message: 'Could not save the draft. Please try again.',
    })
    expect(log).toHaveBeenCalledWith(
      '保存草稿失败。',
      expect.objectContaining({ cause: error }),
    )
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})

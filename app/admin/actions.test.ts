// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDraftAction, publishDraftAction, restoreRevisionAction, saveDraftAction } from './actions'

const mocks = vi.hoisted(() => ({
  withAdminPostStore: vi.fn(),
  createDraftOnce: vi.fn(),
  saveDraft: vi.fn(),
  publishDraft: vi.fn(),
  restoreRevision: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock('@/lib/admin-posts', () => ({ withAdminPostStore: mocks.withAdminPostStore }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/navigation', async importOriginal => ({
  ...await importOriginal<typeof import('next/navigation')>(),
  redirect: mocks.redirect,
}))

const id = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'
const content = {
  title: 'A draft',
  description: '',
  body: '# Body\r\n\n  indented content\n',
}
const input = { content, expectedRevisionId: 1 }
const draft = {
  ...content,
  id,
  revisionId: 2,
  createdAt: '2026-11-14T00:00:00Z',
  updatedAt: '2026-11-14T00:00:00Z',
}

const published = {
  ...content,
  id,
  revisionId: 3,
  publicationId: 1,
  createdAt: draft.createdAt,
  publishedAt: '2026-11-15T00:00:00Z',
}

const adminPaths = [['/admin'], [`/admin/posts/${id}`], [`/admin/posts/${id}/history`]]

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.withAdminPostStore.mockImplementation(async operation => ({
    authorized: true,
    value: await operation({
      createDraftOnce: mocks.createDraftOnce,
      saveDraft: mocks.saveDraft,
      publishDraft: mocks.publishDraft,
      restoreRevision: mocks.restoreRevision,
    }),
  }))
  mocks.createDraftOnce.mockReturnValue({ status: 'success', value: draft })
  mocks.saveDraft.mockReturnValue({ status: 'success', value: draft })
  mocks.publishDraft.mockReturnValue({ status: 'success', value: published })
  mocks.restoreRevision.mockReturnValue({ status: 'success', value: draft })
  mocks.redirect.mockImplementation(path => {
    throw new Error(`Redirect: ${path}`)
  })
})

describe('草稿保存入口', () => {
  it('身份失效时先返回重登提示，不读取或保存内容', async () => {
    mocks.withAdminPostStore.mockResolvedValue({ authorized: false })
    const readContent = vi.fn(() => { throw new Error('Input must not be read') })
    const untrustedInput = Object.defineProperty({}, 'content', { get: readContent })

    const expected = {
      status: 'error', message: 'Sign in to save this draft.', signInRequired: true,
    }
    expect(await createDraftAction({ status: 'idle' }, untrustedInput)).toEqual(expected)
    expect(await saveDraftAction(id, { status: 'idle' }, untrustedInput)).toEqual(expected)
    expect(readContent).not.toHaveBeenCalled()
    expect(mocks.createDraftOnce).not.toHaveBeenCalled()
    expect(mocks.saveDraft).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('框架控制流原样向上传递，不误报成保存错误', async () => {
    const navigation = await vi.importActual<typeof import('next/navigation')>('next/navigation')
    let signal: unknown
    try { navigation.redirect('/admin/login') } catch (error) { signal = error }
    mocks.withAdminPostStore.mockRejectedValue(signal)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(saveDraftAction(id, { status: 'idle' }, input)).rejects.toBe(signal)
    expect(log).not.toHaveBeenCalled()
  })

  it('拒绝空白标题和非文本内容，不执行写入', async () => {
    const blank = await createDraftAction({ status: 'idle' }, {
      content: { ...content, title: '  ' }, expectedRevisionId: null, creationId: id,
    })
    expect(blank).toEqual({ status: 'error', message: 'Enter a title.' })
    const invalid = await createDraftAction({ status: 'idle' }, {
      content: { ...content, body: 123 }, expectedRevisionId: null, creationId: id,
    })
    expect(invalid.status).toBe('error')
    expect(mocks.createDraftOnce).not.toHaveBeenCalled()
  })

  it.each([null, undefined, 'text', [], {}, { content: null }])(
    '拒绝未知创建输入，不执行写入：%j',
    async unknownInput => {
      expect((await createDraftAction({ status: 'idle' }, unknownInput)).status)
        .toBe('error')
      expect(mocks.createDraftOnce).not.toHaveBeenCalled()
      expect(mocks.redirect).not.toHaveBeenCalled()
      expect(mocks.revalidatePath).not.toHaveBeenCalled()
    },
  )

  it.each([null, undefined, 'text', [], {}, { content: null }, { content }])(
    '拒绝未知或缺失保存输入，不执行写入：%j',
    async unknownInput => {
      expect((await saveDraftAction(id, { status: 'idle' }, unknownInput)).status)
        .toBe('error')
      expect(mocks.saveDraft).not.toHaveBeenCalled()
      expect(mocks.revalidatePath).not.toHaveBeenCalled()
    },
  )

  it.each([null, 0, -1, 1.5, '1', Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    '拒绝无效保存基线，不执行写入：%j',
    async expectedRevisionId => {
      expect((await saveDraftAction(id, { status: 'idle' }, { content, expectedRevisionId })).status)
        .toBe('error')
      expect(mocks.saveDraft).not.toHaveBeenCalled()
      expect(mocks.revalidatePath).not.toHaveBeenCalled()
    },
  )

  it('保存正文校验失败时不执行写入', async () => {
    const invalid = { content: { ...content, body: false }, expectedRevisionId: 1 }
    expect((await saveDraftAction(id, { status: 'idle' }, invalid)).status).toBe('error')
    expect(mocks.saveDraft).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('创建使用同一系统标识，并跳转到已提交的草稿', async () => {
    await expect(createDraftAction({ status: 'idle' }, { content, expectedRevisionId: null, creationId: id }))
      .rejects.toThrow(`Redirect: /admin/posts/${id}`)

    expect(mocks.createDraftOnce).toHaveBeenCalledExactlyOnceWith(id, content)
    expect(mocks.revalidatePath.mock.calls).toEqual([['/admin'], ['/admin/posts/new']])
    expect(mocks.saveDraft).not.toHaveBeenCalled()
  })

  it('创建不使用客户端传来的保存基线', async () => {
    await expect(createDraftAction({ status: 'idle' }, { content, expectedRevisionId: 'ignored', creationId: id }))
      .rejects.toThrow(`Redirect: /admin/posts/${id}`)
    expect(mocks.createDraftOnce).toHaveBeenCalledExactlyOnceWith(id, content)
  })

  it.each([undefined, null, '', 'not-a-uuid', 123])('创建拒绝无效操作标识 %j', async creationId => {
    expect((await createDraftAction({ status: 'idle' }, { content, creationId })).status).toBe('error')
    expect(mocks.createDraftOnce).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('创建请求冲突时提供检查入口，不覆盖已有稿件或导航', async () => {
    mocks.createDraftOnce.mockReturnValue({ status: 'conflict' })
    expect(await createDraftAction({ status: 'idle' }, { content, creationId: id })).toEqual({
      status: 'error',
      message: 'A draft already exists for this request. Your input is preserved. Review the saved draft before continuing.',
      reviewPostId: id,
    })
    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('保存原文及预期修订并返回新基线，只刷新管理页面', async () => {
    expect(await saveDraftAction(id, { status: 'idle' }, input)).toEqual({
      status: 'saved', content, revisionId: 2,
    })
    expect(mocks.saveDraft).toHaveBeenCalledExactlyOnceWith(id, content, 1)
    expect(mocks.revalidatePath.mock.calls).toEqual(adminPaths)
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('不存在的草稿返回明确反馈，不刷新页面', async () => {
    mocks.saveDraft.mockReturnValue({ status: 'missing' })
    expect(await saveDraftAction(id, { status: 'idle' }, input)).toEqual({
      status: 'error', message: 'This draft does not exist.',
    })
    expect(mocks.saveDraft).toHaveBeenCalledExactlyOnceWith(id, content, 1)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('修订冲突提示保留输入，不刷新或导航，也不尝试强制覆盖', async () => {
    mocks.saveDraft.mockReturnValue({ status: 'conflict' })
    const result = await saveDraftAction(id, { status: 'idle' }, input)
    expect(result).toEqual({
      status: 'error',
      message: 'This draft changed since you opened it. Your input is preserved. Review the latest draft before saving again.',
    })
    expect(mocks.saveDraft).toHaveBeenCalledExactlyOnceWith(id, content, 1)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('数据库连接失败返回表单错误，而不让操作抛出到编辑器', async () => {
    const error = new Error('Unable to open database')
    mocks.withAdminPostStore.mockRejectedValue(error)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await saveDraftAction(id, { status: 'idle' }, input)).toEqual({
      status: 'error', message: 'Could not save the draft. Please try again.',
    })
    expect(log).toHaveBeenCalledWith('保存草稿失败。', error)
    expect(mocks.saveDraft).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('存储失败时记录原始错误并返回保存失败反馈', async () => {
    const error = new Error('Storage unavailable')
    mocks.saveDraft.mockImplementation(() => { throw error })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await saveDraftAction(id, { status: 'idle' }, input)).toEqual({
      status: 'error', message: 'Could not save the draft. Please try again.',
    })
    expect(log).toHaveBeenCalledWith('保存草稿失败。', error)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})

describe('文章发布入口', () => {
  it('先鉴权再读取发布输入，身份失效使用准确发布提示', async () => {
    mocks.withAdminPostStore.mockResolvedValue({ authorized: false })
    const readContent = vi.fn(() => { throw new Error('Must not parse before auth') })
    const untrustedInput = Object.defineProperty({}, 'content', { get: readContent })

    expect(await publishDraftAction(id, { status: 'idle' }, untrustedInput)).toEqual({
      status: 'error', message: 'Sign in to publish this post.', signInRequired: true,
    })
    expect(readContent).not.toHaveBeenCalled()
    expect(mocks.publishDraft).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it.each([
    null,
    { content, expectedRevisionId: null },
    { content: { ...content, title: ' ' }, expectedRevisionId: 1 },
    { content: { ...content, body: false }, expectedRevisionId: 1 },
  ])('发布输入无效时不写入或刷新：%j', async invalid => {
    expect((await publishDraftAction(id, { status: 'idle' }, invalid)).status).toBe('error')
    expect(mocks.publishDraft).not.toHaveBeenCalled()
    expect(mocks.saveDraft).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('把当前内容直接交给原子发布，不先保存或补读草稿，返回发布基线并刷新所有相关页面', async () => {
    expect(await publishDraftAction(id, { status: 'idle' }, input)).toEqual({
      status: 'published', content, revisionId: 3,
    })
    expect(mocks.publishDraft).toHaveBeenCalledExactlyOnceWith(id, content, 1)
    expect(mocks.saveDraft).not.toHaveBeenCalled()
    expect(mocks.createDraftOnce).not.toHaveBeenCalled()
    expect(mocks.restoreRevision).not.toHaveBeenCalled()
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ...adminPaths, ['/'], [`/blog/${id}`], ['/sitemap.xml'],
    ])
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', 'This draft does not exist.'],
    ['conflict', 'This draft changed since you opened it. Your input is preserved. Review the latest draft before publishing again.'],
  ])('发布%s时明确反馈，不刷新、不强制覆盖', async (status, message) => {
    mocks.publishDraft.mockReturnValue({ status })
    expect(await publishDraftAction(id, { status: 'idle' }, input)).toEqual({ status: 'error', message })
    expect(mocks.publishDraft).toHaveBeenCalledExactlyOnceWith(id, content, 1)
    expect(mocks.saveDraft).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('数据库写入异常使用发布错误文案并保留原始日志', async () => {
    const error = new Error('Publication transaction failed')
    mocks.publishDraft.mockImplementation(() => { throw error })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await publishDraftAction(id, { status: 'idle' }, input)).toEqual({
      status: 'error', message: 'Could not publish the post. Please try again.',
    })
    expect(log).toHaveBeenCalledWith('发布文章失败。', error)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})

describe('修订恢复入口', () => {
  const restoreInput = { revisionId: 4, expectedRevisionId: 1, expectedWorkingVersion: 'working-version' }

  it('恢复前先鉴权，身份失效不解析目标或写入', async () => {
    mocks.withAdminPostStore.mockResolvedValue({ authorized: false })
    const readRevision = vi.fn(() => { throw new Error('Must not parse before auth') })
    const untrustedInput = Object.defineProperty({}, 'revisionId', { get: readRevision })
    expect(await restoreRevisionAction(id, untrustedInput, { status: 'idle' })).toEqual({
      status: 'error', message: 'Sign in to restore this revision.', signInRequired: true,
    })
    expect(readRevision).not.toHaveBeenCalled()
    expect(mocks.restoreRevision).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it.each([
    null,
    {},
    { revisionId: 4, expectedRevisionId: null },
    { revisionId: '4', expectedRevisionId: 1 },
    { revisionId: 0, expectedRevisionId: 1 },
    { revisionId: 4, expectedRevisionId: 1.5 },
  ])('服务端验证绑定的恢复参数，无效时拒绝写入：%j', async invalid => {
    expect((await restoreRevisionAction(id, invalid, { status: 'idle' })).status).toBe('error')
    expect(mocks.restoreRevision).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('只恢复目标修订，刷新管理历史后跳转编辑页，不发布或刷新公开页面', async () => {
    await expect(restoreRevisionAction(id, restoreInput, { status: 'idle' }))
      .rejects.toThrow(`Redirect: /admin/posts/${id}`)
    expect(mocks.restoreRevision).toHaveBeenCalledExactlyOnceWith(id, 4, 1, 'working-version')
    expect(mocks.saveDraft).not.toHaveBeenCalled()
    expect(mocks.publishDraft).not.toHaveBeenCalled()
    expect(mocks.revalidatePath.mock.calls).toEqual(adminPaths)
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith(`/admin/posts/${id}`)
  })

  it.each([
    ['missing', 'This draft or revision does not exist.'],
    ['conflict', 'This draft changed while you were viewing history. Reload the history page before restoring.'],
  ])('恢复%s时保留历史页，不刷新或导航', async (status, message) => {
    mocks.restoreRevision.mockReturnValue({ status })
    expect(await restoreRevisionAction(id, restoreInput, { status: 'idle' })).toEqual({ status: 'error', message })
    expect(mocks.restoreRevision).toHaveBeenCalledExactlyOnceWith(id, 4, 1, 'working-version')
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('数据库异常返回恢复错误，不当作保存失败或触发导航', async () => {
    const error = new Error('Restore transaction failed')
    mocks.restoreRevision.mockImplementation(() => { throw error })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await restoreRevisionAction(id, restoreInput, { status: 'idle' })).toEqual({
      status: 'error', message: 'Could not restore the revision. Please try again.',
    })
    expect(log).toHaveBeenCalledWith('恢复草稿修订失败。', error)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })
})

describe('发布与恢复的框架控制流', () => {
  it.each(['publish', 'restore'])('%s原样传播Next导航，不记录为数据库故障', async kind => {
    const navigation = await vi.importActual<typeof import('next/navigation')>('next/navigation')
    let signal: unknown
    try { navigation.redirect('/admin/login') } catch (error) { signal = error }
    mocks.withAdminPostStore.mockRejectedValue(signal)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const operation = kind === 'publish'
      ? publishDraftAction(id, { status: 'idle' }, input)
      : restoreRevisionAction(id, { revisionId: 4, expectedRevisionId: 1 }, { status: 'idle' })
    await expect(operation).rejects.toBe(signal)
    expect(log).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})

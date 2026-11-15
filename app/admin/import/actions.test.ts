// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_MARKDOWN_UPLOAD_BYTES } from '@/lib/post-file-policy'
import { importMarkdownAction } from './actions'

const mocks = vi.hoisted(() => ({
  withAdminPostStore: vi.fn(),
  importDraft: vi.fn(),
  createImportedDraftOnce: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}))
vi.mock('@/lib/admin-posts', () => ({ withAdminPostStore: mocks.withAdminPostStore }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/navigation', async actual => ({
  ...await actual<typeof import('next/navigation')>(), redirect: mocks.redirect,
}))

const newPostId = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'
const targetId = '68767e8c-c86e-4b97-bb15-356c2553f49c'
const body = '\r\n    indented\r\n\r\nlast line  \r\n'
const source = `---\ntitle: Imported title\n---\n${body}`
const draft = {
  id: newPostId, revisionId: 3, title: 'Imported title', description: '', body,
  createdAt: '2026-11-15T00:00:00Z', updatedAt: '2026-11-15T01:00:00Z',
}

function upload(file = new File([source], 'not-an-identity.md'), identity = newPostId) {
  const input = new FormData()
  input.append('file', file)
  input.append('newPostId', identity)
  return input
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.withAdminPostStore.mockImplementation(async operation => ({
    authorized: true,
    value: await operation({ importDraft: mocks.importDraft, createImportedDraftOnce: mocks.createImportedDraftOnce }),
  }))
  mocks.importDraft.mockReturnValue(draft)
  mocks.createImportedDraftOnce.mockReturnValue({ status: 'success', value: draft })
  mocks.redirect.mockImplementation(path => { throw new Error(`Redirect: ${path}`) })
})

describe('Markdown 文件上传入口', () => {
  it('身份检查先于FormData或文件访问，失效时不读取文件', async () => {
    const file = new File([source], 'draft.md')
    const read = vi.spyOn(file, 'arrayBuffer')
    const input = upload(file)
    const fields = vi.spyOn(input, 'getAll')
    mocks.withAdminPostStore.mockResolvedValue({ authorized: false })
    expect(await importMarkdownAction({ status: 'idle' }, input)).toEqual({
      status: 'error', message: 'Sign in to import Markdown.', signInRequired: true,
    })
    expect(fields).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
    expect(mocks.importDraft).not.toHaveBeenCalled()
    expect(mocks.createImportedDraftOnce).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it.each([null, {}, 'fake', { file: { name: 'draft.md', arrayBuffer: vi.fn() } }])(
    '拒绝非FormData输入：%j', async input => {
      expect(await importMarkdownAction({ status: 'idle' }, input)).toEqual({
        status: 'error', message: 'Choose exactly one Markdown file.',
      })
      expect(mocks.createImportedDraftOnce).not.toHaveBeenCalled()
      expect(mocks.importDraft).not.toHaveBeenCalled()
    },
  )

  it.each(['missing', 'multiple', 'text', 'unnamed'])('拒绝%s文件，不执行存储或刷新', async kind => {
    const input = upload()
    if (kind === 'missing') input.delete('file')
    if (kind === 'multiple') input.append('file', new File([source], 'second.md'))
    if (kind === 'text') input.set('file', 'fake-file.md')
    if (kind === 'unnamed') input.set('file', new File([source], ''))
    expect(await importMarkdownAction({ status: 'idle' }, input)).toEqual({
      status: 'error', message: 'Choose exactly one Markdown file.',
    })
    expect(mocks.createImportedDraftOnce).not.toHaveBeenCalled()
    expect(mocks.importDraft).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it.each(['invalid', 'missing', 'duplicate'])('%s导入会话ID在读取文件前被拒绝', async kind => {
    const file = new File([source], 'draft.md')
    const input = upload(file, kind === 'invalid' ? 'not-a-uuid' : newPostId)
    if (kind === 'missing') input.delete('newPostId')
    if (kind === 'duplicate') input.append('newPostId', targetId)
    const read = vi.spyOn(file, 'arrayBuffer')
    expect((await importMarkdownAction({ status: 'idle' }, input)).status).toBe('error')
    expect(read).not.toHaveBeenCalled()
    expect(mocks.createImportedDraftOnce).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('超过文件字节上限时不调用arrayBuffer', async () => {
    const file = new File([new Uint8Array(MAX_MARKDOWN_UPLOAD_BYTES + 1)], 'large.md')
    const read = vi.spyOn(file, 'arrayBuffer')
    expect(await importMarkdownAction({ status: 'idle' }, upload(file))).toEqual({
      status: 'error', message: `The Markdown file exceeds the ${MAX_MARKDOWN_UPLOAD_BYTES / 1024 / 1024} MiB limit.`,
    })
    expect(read).not.toHaveBeenCalled()
    expect(mocks.createImportedDraftOnce).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('严格拒绝无效UTF-8，不替换字符或执行写入', async () => {
    const input = upload(new File([new Uint8Array([0xc3, 0x28])], 'invalid-encoding.md'))
    expect(await importMarkdownAction({ status: 'idle' }, input)).toEqual({
      status: 'error', message: 'Save the Markdown file with UTF-8 encoding.',
    })
    expect(mocks.createImportedDraftOnce).not.toHaveBeenCalled()
    expect(mocks.importDraft).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('格式错误反馈沿用codec原文，不刷新或跳转', async () => {
    const input = upload(new File(['# Missing front matter'], 'draft.md'))
    expect(await importMarkdownAction({ status: 'idle' }, input)).toEqual({
      status: 'error', message: 'Start the file with YAML front matter containing a title.',
    })
    expect(mocks.createImportedDraftOnce).not.toHaveBeenCalled()
    expect(mocks.importDraft).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('无文件ID时以同一会话ID创建草稿，保留正文，成功只刷新管理页面', async () => {
    await expect(importMarkdownAction({ status: 'idle' }, upload()))
      .rejects.toThrow(`Redirect: /admin/posts/${newPostId}`)
    expect(mocks.createImportedDraftOnce).toHaveBeenCalledExactlyOnceWith(
      newPostId, { title: 'Imported title', description: '', body },
    )
    expect(mocks.importDraft).not.toHaveBeenCalled()
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ['/admin'], [`/admin/posts/${newPostId}`], [`/admin/posts/${newPostId}/history`], ['/admin/import'],
    ])
  })

  it('文件内ID独立选择目标，既不使用文件名也不使用无ID会话ID覆盖目标', async () => {
    mocks.importDraft.mockReturnValue({ ...draft, id: targetId })
    const input = upload(new File([`---\nid: ${targetId}\ntitle: Imported title\n---\n${body}`], `${newPostId}.md`))
    await expect(importMarkdownAction({ status: 'idle' }, input))
      .rejects.toThrow(`Redirect: /admin/posts/${targetId}`)
    expect(mocks.importDraft).toHaveBeenCalledExactlyOnceWith({
      id: targetId, title: 'Imported title', description: '', body,
    })
    expect(mocks.createImportedDraftOnce).not.toHaveBeenCalled()
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ['/admin'], [`/admin/posts/${targetId}`], [`/admin/posts/${targetId}/history`], ['/admin/import'],
    ])
  })

  it('同次无ID导入内容冲突给检查链接，不刷新或重建另一篇', async () => {
    mocks.createImportedDraftOnce.mockReturnValue({ status: 'conflict' })
    expect(await importMarkdownAction({ status: 'idle' }, upload())).toEqual({
      status: 'error',
      message: 'A draft already exists for this import attempt with different content. Your file selection is preserved. Check the saved draft or start a new import.',
      reviewPostId: newPostId,
    })
    expect(mocks.createImportedDraftOnce).toHaveBeenCalledTimes(1)
    expect(mocks.importDraft).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it.each(['open', 'write', 'read'])('%s故障记录原始异常并返回安全反馈，不刷新', async kind => {
    const error = new Error('Private storage detail')
    const input = upload()
    if (kind === 'open') mocks.withAdminPostStore.mockRejectedValue(error)
    if (kind === 'write') mocks.createImportedDraftOnce.mockImplementation(() => { throw error })
    if (kind === 'read') {
      const file = input.get('file')
      if (!(file instanceof File)) throw new Error('Invalid test fixture')
      vi.spyOn(file, 'arrayBuffer').mockRejectedValue(error)
    }
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await importMarkdownAction({ status: 'idle' }, input)).toEqual({
      status: 'error', message: 'Could not import the Markdown file. Please try again.',
    })
    expect(log).toHaveBeenCalledWith('导入 Markdown 文件失败。', error)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('Next控制流信号原样放行，不误报导入失败', async () => {
    const navigation = await vi.importActual<typeof import('next/navigation')>('next/navigation')
    let signal: unknown
    try { navigation.redirect('/admin/login') } catch (error) { signal = error }
    mocks.withAdminPostStore.mockRejectedValue(signal)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(importMarkdownAction({ status: 'idle' }, upload())).rejects.toBe(signal)
    expect(log).not.toHaveBeenCalled()
  })
})

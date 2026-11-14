import { redirect } from 'next/navigation'
import { Component, type ReactNode } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftEditorInput, DraftFormState } from '@/lib/content'
import { PostEditor } from './post-editor'

class EditorBoundary extends Component<{ children: ReactNode; onError?: (error: Error) => void }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error)
  }

  render() {
    return this.state.failed ? <p>Editor unavailable</p> : this.props.children
  }
}

const action =
  vi.fn<
    (state: DraftFormState, input: DraftEditorInput) => Promise<DraftFormState>
  >()
const publishAction = vi.fn<
  (state: DraftFormState, input: DraftEditorInput) => Promise<DraftFormState>
>()
const content = {
  title: 'A draft',
  description: 'Description.',
  body: '# First body',
}

const creationId = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'

beforeEach(() => {
  action.mockReset()
  publishAction.mockReset()
})

describe('Markdown 草稿编辑', () => {
  it('请求拒绝时不卸载编辑器，保留原文和最后成功的基线并允许重试', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const saved = { ...content, body: '# Second revision' }
    const unsaved = { ...content, body: '# Kept after interrupted response' }
    action
      .mockResolvedValueOnce({ status: 'saved', content: saved, revisionId: 2 })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ status: 'saved', content: unsaved, revisionId: 3 })
    render(<EditorBoundary><PostEditor initialContent={content} initialRevisionId={1} action={action} /></EditorBoundary>)
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: saved.body } })
    fireEvent.submit(screen.getByRole('form', { name: 'Draft' }))
    await screen.findByRole('status')
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: unsaved.body } })
    fireEvent.submit(screen.getByRole('form', { name: 'Draft' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Could not confirm')
    expect(screen.queryByText('Editor unavailable')).toBeNull()
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Body' }).value).toBe(unsaved.body)
    fireEvent.submit(screen.getByRole('form', { name: 'Draft' }))
    await screen.findByRole('status')
    expect(action.mock.calls.map(([, input]) => input.expectedRevisionId)).toEqual([1, 2, 2])
  })

  it('客户端错误处理不吞掉真实 Next 跳转信号', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let signal: unknown
    try { redirect('/admin') } catch (error) { signal = error }
    action.mockRejectedValueOnce(signal)
    const caught = vi.fn()
    render(
      <EditorBoundary onError={caught}>
        <PostEditor initialContent={content} initialRevisionId={1} action={action} />
      </EditorBoundary>,
    )
    fireEvent.submit(screen.getByRole('form', { name: 'Draft' }))
    await screen.findByText('Editor unavailable')
    expect(caught).toHaveBeenCalledExactlyOnceWith(signal)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('发布请求拒绝时保留文字与基线，重试仍发布同一内容', async () => {
    publishAction.mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ status: 'published', content, revisionId: 2 })
    render(<EditorBoundary><PostEditor initialContent={content} initialRevisionId={1} action={action} publishAction={publishAction} /></EditorBoundary>)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await screen.findByRole('alert')
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Body' }).value).toBe(content.body)
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await screen.findByRole('status')
    expect(publishAction.mock.calls.map(([, input]) => input)).toEqual([
      { content, expectedRevisionId: 1 }, { content, expectedRevisionId: 1 },
    ])
  })

  it('创建请求拒绝后保留同一创建标识，检查入口不替换原页', async () => {
    action.mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ status: 'saved', content, revisionId: 1 })
    const { rerender } = render(<PostEditor initialContent={content} initialRevisionId={null} creationId={creationId} action={action} />)
    fireEvent.submit(screen.getByRole('form', { name: 'Draft' }))
    const link = await screen.findByRole('link', { name: 'Check saved draft in a new tab' })
    expect(link.getAttribute('href')).toBe(`/admin/posts/${creationId}`)
    expect(link.getAttribute('target')).toBe('_blank')
    rerender(<PostEditor initialContent={content} initialRevisionId={null} creationId="9ea8d4be-4b45-46d2-954c-3e1da354d33f" action={action} />)
    fireEvent.submit(screen.getByRole('form', { name: 'Draft' }))
    await screen.findByRole('status')
    expect(action.mock.calls.map(([, input]) => input)).toEqual([
      { content, expectedRevisionId: null, creationId }, { content, expectedRevisionId: null, creationId },
    ])
  })

  it('切换编辑与预览保留输入，并使用正文的 Markdown 和 GFM 渲染', async () => {
    render(<PostEditor initialContent={content} initialRevisionId={1} action={action} />)
    const source =
      '# Preview heading\n\n| Name | Value |\n| --- | --- |\n| Example | 1 |'
    fireEvent.change(screen.getByLabelText('Body'), {
      target: { value: source },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    const preview = screen.getByRole('region', { name: 'Markdown preview' })
    expect(
      await within(preview).findByText('Preview heading', { selector: 'h1' }, { timeout: 5000 }),
    ).toBeDefined()
    expect(within(preview).getByRole('table')).toBeDefined()
    expect(screen.queryByRole('textbox', { name: 'Body' })).toBeNull()
    expect(action).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toBe(
      source,
    )
  })

  it('保存提交同一内容快照与修订基线，成功后继续编辑会显示未保存状态', async () => {
    const pending = Promise.withResolvers<DraftFormState>()
    action.mockReturnValue(pending.promise)
    render(<PostEditor initialContent={content} initialRevisionId={1} action={action} />)
    const edited = { ...content, body: '# Edited body\n\nText.' }
    fireEvent.change(screen.getByLabelText('Body'), {
      target: { value: edited.body },
    })
    expect(screen.getByText('Unsaved changes.')).toBeDefined()
    const button = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Save draft',
    })

    fireEvent.submit(screen.getByRole('form', { name: 'Draft' }))
    expect(button.disabled).toBe(true)
    expect(action).toHaveBeenCalledExactlyOnceWith(
      { status: 'idle' },
      { content: edited, expectedRevisionId: 1 },
    )
    await act(async () => pending.resolve({ status: 'saved', content: edited, revisionId: 2 }))

    expect((await screen.findByRole('status')).textContent).toBe('Draft saved.')
    expect(button.disabled).toBe(false)
    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toBe(
      edited.body,
    )
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Another title' },
    })
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText('Unsaved changes.')).toBeDefined()
  })

  it('连续编辑使用上一次成功保存返回的修订基线', async () => {
    const firstEdit = { ...content, body: '# Second revision' }
    const secondEdit = { ...content, body: '# Third revision' }
    action
      .mockResolvedValueOnce({ status: 'saved', content: firstEdit, revisionId: 2 })
      .mockResolvedValueOnce({ status: 'saved', content: secondEdit, revisionId: 3 })
    render(<PostEditor initialContent={content} initialRevisionId={1} action={action} />)

    fireEvent.change(screen.getByLabelText('Body'), { target: { value: firstEdit.body } })
    fireEvent.submit(screen.getByRole('form', { name: 'Draft' }))
    await screen.findByRole('status')
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: secondEdit.body } })
    fireEvent.submit(screen.getByRole('form', { name: 'Draft' }))
    await screen.findByRole('status')

    expect(action.mock.calls.map(([, input]) => input)).toEqual([
      { content: firstEdit, expectedRevisionId: 1 },
      { content: secondEdit, expectedRevisionId: 2 },
    ])
    expect(screen.queryByText('Unsaved changes.')).toBeNull()
  })

  it('成功后保存失败不会丢失已保存快照，重试仍使用最后成功的修订', async () => {
    const firstEdit = { ...content, body: '# Saved second revision' }
    const nextEdit = { ...content, body: '# Unsaved third revision' }
    const error = { status: 'error', message: 'Could not save the draft. Please try again.' } as const
    action
      .mockResolvedValueOnce({ status: 'saved', content: firstEdit, revisionId: 2 })
      .mockResolvedValueOnce(error)
      .mockResolvedValueOnce({ status: 'saved', content: nextEdit, revisionId: 3 })
    render(<PostEditor initialContent={content} initialRevisionId={1} action={action} />)

    fireEvent.change(screen.getByLabelText('Body'), { target: { value: firstEdit.body } })
    fireEvent.submit(screen.getByRole('form', { name: 'Draft' }))
    await screen.findByRole('status')
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: nextEdit.body } })
    fireEvent.submit(screen.getByRole('form', { name: 'Draft' }))
    await screen.findByRole('alert')
    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toBe(nextEdit.body)

    fireEvent.change(screen.getByLabelText('Body'), { target: { value: firstEdit.body } })
    expect(screen.queryByText('Unsaved changes.')).toBeNull()
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: nextEdit.body } })
    fireEvent.submit(screen.getByRole('form', { name: 'Draft' }))
    await screen.findByRole('status')

    expect(action.mock.calls.map(([, input]) => input)).toEqual([
      { content: firstEdit, expectedRevisionId: 1 },
      { content: nextEdit, expectedRevisionId: 2 },
      { content: nextEdit, expectedRevisionId: 2 },
    ])
  })

  it('冲突与普通属性刷新都保留当前文字及原修订基线，不静默采用远端版本', async () => {
    const edited = { ...content, body: '# My unsaved text' }
    const conflict = {
      status: 'error',
      message: 'This draft changed since you opened it. Your input is preserved. Review the latest draft before saving again.',
    } as const
    action.mockResolvedValue(conflict)
    const { rerender } = render(
      <PostEditor initialContent={content} initialRevisionId={1} action={action} />,
    )
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: edited.body } })
    fireEvent.submit(screen.getByRole('form', { name: 'Draft' }))
    expect((await screen.findByRole('alert')).textContent).toBe(conflict.message)

    rerender(
      <PostEditor
        initialContent={{ ...content, body: '# Remote revision' }}
        initialRevisionId={9}
        action={action}
      />,
    )
    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toBe(edited.body)
    expect(screen.getByText('Unsaved changes.')).toBeDefined()
    await act(async () => {
      fireEvent.submit(screen.getByRole('form', { name: 'Draft' }))
    })
    expect(action.mock.calls.map(([, input]) => input)).toEqual([
      { content: edited, expectedRevisionId: 1 },
      { content: edited, expectedRevisionId: 1 },
    ])
  })

  it('保存成功后的属性刷新也不能升级本地基线或替换未保存输入', async () => {
    const saved = { ...content, body: '# Second revision' }
    const unsaved = { ...content, body: '# Local third revision' }
    action
      .mockResolvedValueOnce({ status: 'saved', content: saved, revisionId: 2 })
      .mockResolvedValueOnce({ status: 'error', message: 'Revision conflict.' })
    const { rerender } = render(
      <PostEditor initialContent={content} initialRevisionId={1} action={action} />,
    )
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: saved.body } })
    fireEvent.submit(screen.getByRole('form', { name: 'Draft' }))
    await screen.findByRole('status')
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: unsaved.body } })
    rerender(
      <PostEditor
        initialContent={{ ...content, body: '# Remote change' }}
        initialRevisionId={9}
        action={action}
      />,
    )
    fireEvent.submit(screen.getByRole('form', { name: 'Draft' }))
    await screen.findByRole('alert')

    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toBe(unsaved.body)
    expect(action).toHaveBeenLastCalledWith(
      { status: 'saved', content: saved, revisionId: 2 },
      { content: unsaved, expectedRevisionId: 2 },
    )
  })

  it('登录失效时保留输入，重登入口不替换当前页面，重试仍使用原基线', async () => {
    const edited = { ...content, body: 'Unsaved after sign-out' }
    action
      .mockResolvedValueOnce({
        status: 'error',
        message: 'Sign in to save this draft.',
        signInRequired: true,
      })
      .mockResolvedValueOnce({ status: 'saved', content: edited, revisionId: 2 })
    render(<PostEditor initialContent={content} initialRevisionId={1} action={action} />)
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: edited.body } })
    fireEvent.submit(screen.getByRole('form', { name: 'Draft' }))

    const link = await screen.findByRole('link', { name: 'Sign in in a new tab' })
    expect(link.getAttribute('href')).toBe('/admin/login')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toBe(edited.body)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save draft' }).disabled).toBe(false)
    fireEvent.submit(screen.getByRole('form', { name: 'Draft' }))
    await screen.findByRole('status')
    expect(action).toHaveBeenLastCalledWith(
      { status: 'error', message: 'Sign in to save this draft.', signInRequired: true },
      { content: edited, expectedRevisionId: 1 },
    )
  })

  it('保存失败时显示反馈，保留输入内容以便重试', async () => {
    action.mockResolvedValue({
      status: 'error',
      message: 'Could not save the draft. Please try again.',
    })
    render(<PostEditor initialContent={content} initialRevisionId={1} action={action} />)
    fireEvent.change(screen.getByLabelText('Body'), {
      target: { value: 'Unsaved text' },
    })

    fireEvent.submit(screen.getByRole('form', { name: 'Draft' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Could not save the draft. Please try again.',
    )
    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toBe(
      'Unsaved text',
    )
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Save draft' })
        .disabled,
    ).toBe(false)
  })

  it('新建草稿提交空修订基线', async () => {
    action.mockResolvedValue({ status: 'saved', content, revisionId: 1 })
    render(<PostEditor initialContent={content} initialRevisionId={null} creationId={creationId} action={action} />)
    fireEvent.submit(screen.getByRole('form', { name: 'Draft' }))
    await screen.findByRole('status')
    expect(action).toHaveBeenCalledExactlyOnceWith(
      { status: 'idle' },
      { content, expectedRevisionId: null, creationId },
    )
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
  })
})

describe('当前编辑内容发布', () => {
  it('发布发送未保存的当前可见内容，调用发布而非保存，并显示发布反馈', async () => {
    const edited = { title: 'Unpublished title', description: 'Unpublished summary', body: '# Current preview body' }
    publishAction.mockResolvedValue({ status: 'published', content: edited, revisionId: 2 })
    render(<PostEditor initialContent={content} initialRevisionId={1} action={action} publishAction={publishAction} />)
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: edited.title } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: edited.description } })
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: edited.body } })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(await within(screen.getByRole('region', { name: 'Markdown preview' }))
      .findByText('Current preview body', { selector: 'h1' }, { timeout: 5000 })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))

    expect((await screen.findByRole('status')).textContent).toBe('Post published.')
    expect(publishAction).toHaveBeenCalledExactlyOnceWith(
      { status: 'idle' },
      { content: edited, expectedRevisionId: 1 },
    )
    expect(action).not.toHaveBeenCalled()
    expect(screen.queryByText('Draft saved.')).toBeNull()
    expect(screen.queryByText('Unsaved changes.')).toBeNull()
  })

  it('发布成功推进保存基线，属性刷新不能替换未保存输入或偷偷采用远端修订', async () => {
    const published = { ...content, body: '# Newly published body' }
    const edited = { ...content, body: '# Next private edit' }
    publishAction.mockResolvedValue({ status: 'published', content: published, revisionId: 2 })
    action.mockResolvedValue({ status: 'saved', content: edited, revisionId: 3 })
    const { rerender } = render(
      <PostEditor initialContent={content} initialRevisionId={1} action={action} publishAction={publishAction} />,
    )
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: published.body } })
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    await screen.findByRole('status')
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: edited.body } })
    rerender(
      <PostEditor
        initialContent={{ ...content, body: '# Remote revision' }}
        initialRevisionId={9}
        action={action}
        publishAction={publishAction}
      />,
    )
    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toBe(edited.body)
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    expect((await screen.findByRole('status')).textContent).toBe('Draft saved.')
    expect(action).toHaveBeenCalledExactlyOnceWith(
      { status: 'published', content: published, revisionId: 2 },
      { content: edited, expectedRevisionId: 2 },
    )
  })

  it.each([
    { status: 'error', message: 'Revision conflict.' } as const,
    { status: 'error', message: 'Could not publish the post. Please try again.' } as const,
    { status: 'error', message: 'Sign in to publish this post.', signInRequired: true } as const,
  ])('发布失败保留输入与最后成功基线：$message', async error => {
    const saved = { ...content, body: '# Saved second revision' }
    const edited = { ...content, body: '# Unpublished third revision' }
    action.mockResolvedValue({ status: 'saved', content: saved, revisionId: 2 })
    publishAction
      .mockResolvedValueOnce(error)
      .mockResolvedValueOnce({ status: 'published', content: edited, revisionId: 3 })
    render(<PostEditor initialContent={content} initialRevisionId={1} action={action} publishAction={publishAction} />)
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: saved.body } })
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await screen.findByRole('status')
    fireEvent.change(screen.getByLabelText('Body'), { target: { value: edited.body } })
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect((await screen.findByRole('alert')).textContent).toContain(error.message)
    expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value).toBe(edited.body)
    expect(screen.getByText('Unsaved changes.')).toBeDefined()
    if ('signInRequired' in error) {
      const link = screen.getByRole('link', { name: 'Sign in in a new tab' })
      expect(link.getAttribute('target')).toBe('_blank')
    }
    fireEvent.click(screen.getByRole('button', { name: 'Publish' }))
    expect((await screen.findByRole('status')).textContent).toBe('Post published.')
    expect(publishAction.mock.calls.map(([, input]) => input)).toEqual([
      { content: edited, expectedRevisionId: 2 },
      { content: edited, expectedRevisionId: 2 },
    ])
  })

  it.each(['save', 'publish'] as const)('%s进行中共享pending，保存与发布都不能重复提交', async intent => {
    const pending = Promise.withResolvers<DraftFormState>()
    const selectedAction = intent === 'save' ? action : publishAction
    selectedAction.mockReturnValue(pending.promise)
    render(<PostEditor initialContent={content} initialRevisionId={1} action={action} publishAction={publishAction} />)
    const saveButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Save draft' })
    const publishButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Publish' })
    fireEvent.click(intent === 'save' ? saveButton : publishButton)
    expect(saveButton.disabled).toBe(true)
    expect(publishButton.disabled).toBe(true)
    fireEvent.click(saveButton)
    fireEvent.click(publishButton)
    fireEvent.submit(screen.getByRole('form', { name: 'Draft' }))
    expect(selectedAction).toHaveBeenCalledTimes(1)
    expect(intent === 'save' ? publishAction : action).not.toHaveBeenCalled()
    await act(async () => pending.resolve({
      status: intent === 'save' ? 'saved' : 'published', content, revisionId: 2,
    }))
    await screen.findByRole('status')
    expect(saveButton.disabled).toBe(false)
    expect(publishButton.disabled).toBe(false)
  })
})

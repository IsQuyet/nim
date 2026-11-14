import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftEditorInput, DraftFormState } from '@/lib/content'
import { PostEditor } from './post-editor'

const action =
  vi.fn<
    (state: DraftFormState, input: DraftEditorInput) => Promise<DraftFormState>
  >()
const content = {
  title: 'A draft',
  description: 'Description.',
  body: '# First body',
}

beforeEach(() => action.mockReset())

describe('Markdown 草稿编辑', () => {
  it('切换编辑与预览保留输入，并使用正文的 Markdown 和 GFM 渲染', () => {
    render(<PostEditor initialContent={content} initialRevisionId={1} action={action} />)
    const source =
      '# Preview heading\n\n| Name | Value |\n| --- | --- |\n| Example | 1 |'
    fireEvent.change(screen.getByLabelText('Body'), {
      target: { value: source },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))

    const preview = screen.getByRole('region', { name: 'Markdown preview' })
    expect(
      within(preview).getByText('Preview heading', { selector: 'h1' }),
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
    render(<PostEditor initialContent={content} initialRevisionId={null} action={action} />)
    fireEvent.submit(screen.getByRole('form', { name: 'Draft' }))
    await screen.findByRole('status')
    expect(action).toHaveBeenCalledExactlyOnceWith(
      { status: 'idle' },
      { content, expectedRevisionId: null },
    )
  })
})

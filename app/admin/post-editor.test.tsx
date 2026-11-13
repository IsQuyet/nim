import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostContent } from '@/lib/posts'
import type { DraftFormState } from './actions'
import { PostEditor } from './post-editor'

const action =
  vi.fn<
    (state: DraftFormState, input: PostContent) => Promise<DraftFormState>
  >()
const content = {
  title: 'A draft',
  description: 'Description.',
  body: '# First body',
}

beforeEach(() => action.mockReset())

describe('Markdown 草稿编辑', () => {
  it('切换编辑与预览保留输入，并使用正文的 Markdown 和 GFM 渲染', () => {
    render(<PostEditor initialContent={content} action={action} />)
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

  it('保存时提交当前内容并阻止重复操作，保存成功后继续编辑会显示未保存状态', async () => {
    const pending = Promise.withResolvers<DraftFormState>()
    action.mockReturnValue(pending.promise)
    render(<PostEditor initialContent={content} action={action} />)
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
    expect(action).toHaveBeenCalledExactlyOnceWith({ status: 'idle' }, edited)
    await act(async () => pending.resolve({ status: 'saved', content: edited }))

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

  it('保存失败时显示反馈，保留输入内容以便重试', async () => {
    action.mockResolvedValue({
      status: 'error',
      message: 'Could not save the draft. Please try again.',
    })
    render(<PostEditor initialContent={content} action={action} />)
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
})

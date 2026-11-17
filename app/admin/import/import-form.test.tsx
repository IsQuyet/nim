import { Component, type ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostFileFormState } from '@/modules/posts/files'
import { ImportForm } from './import-form'

const action = vi.fn<(state: PostFileFormState, input: FormData) => Promise<PostFileFormState>>()
const caught = vi.fn()
const newPostId = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'
const otherId = '68767e8c-c86e-4b97-bb15-356c2553f49c'
const file = new File(['---\ntitle: File title\n---\n\nBody\n'], 'draft.md', { type: 'text/markdown' })

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { caught(error) }
  render() { return this.state.failed ? <p>Boundary failed.</p> : this.props.children }
}

beforeEach(() => {
  action.mockReset()
  caught.mockReset()
})

function selectFile(selected = file) {
  const input = screen.getByLabelText<HTMLInputElement>('Markdown file')
  fireEvent.change(input, { target: { files: [selected] } })
  return input
}

function submit() {
  fireEvent.submit(screen.getByRole('form', { name: 'Import Markdown' }))
}

describe('Markdown 上传表单会话', () => {
  it('请求失败保留原File选择与表单，不触发错误边界卸载', async () => {
    action.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<ErrorBoundary><ImportForm newPostId={newPostId} action={action} /></ErrorBoundary>)
    const input = selectFile()
    submit()
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Could not confirm the import. Your file selection is preserved. Check your drafts before retrying.',
    )
    expect(screen.queryByText('Boundary failed.')).toBeNull()
    expect(caught).not.toHaveBeenCalled()
    expect(input.files?.[0]).toBe(file)
    expect(action.mock.calls[0][1].get('file')).toBe(file)
    expect(action.mock.calls[0][1].get('newPostId')).toBe(newPostId)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Import draft' }).disabled).toBe(false)
  })

  it('普通props刷新不改变导入会话ID，不清空文件；再次选择文件也不会静默另建身份', async () => {
    action.mockResolvedValue({ status: 'error', message: 'Retry this import.' })
    const { rerender } = render(<ImportForm newPostId={newPostId} action={action} />)
    const input = selectFile()
    submit()
    await screen.findByRole('alert')
    rerender(<ImportForm newPostId={otherId} action={action} />)
    expect(input.files?.[0]).toBe(file)
    await act(async () => submit())
    const changed = new File(['---\ntitle: Changed file\n---\nChanged body'], 'other.md')
    selectFile(changed)
    await act(async () => submit())

    expect(action.mock.calls.map(([, data]) => data.get('newPostId')))
      .toEqual([newPostId, newPostId, newPostId])
    expect(action.mock.calls.map(([, data]) => data.get('file'))).toEqual([file, file, changed])
  })

  it('pending阻止重复提交，结束后仍保留原文件以便重试', async () => {
    const pending = Promise.withResolvers<PostFileFormState>()
    action.mockReturnValue(pending.promise)
    render(<ImportForm newPostId={newPostId} action={action} />)
    const input = selectFile()
    submit()
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Importing…' })
    expect(button.disabled).toBe(true)
    expect(input.closest('fieldset')?.hasAttribute('disabled')).toBe(true)
    submit()
    expect(action).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve({ status: 'error', message: 'Try again.' }))
    await screen.findByRole('alert')
    expect(button.disabled).toBe(false)
    expect(input.files?.[0]).toBe(file)
  })

  it('冲突给出新标签检查与完整新导航入口，不自动清空当前选择', async () => {
    action.mockResolvedValue({ status: 'error', message: 'Import attempt already created a different draft.', reviewPostId: newPostId })
    render(<ImportForm newPostId={newPostId} action={action} />)
    const input = selectFile()
    submit()
    const review = await screen.findByRole('link', { name: 'Check saved draft in a new tab' })
    expect(review.getAttribute('href')).toBe(`/admin/posts/${newPostId}`)
    expect(review.getAttribute('target')).toBe('_blank')
    expect(review.getAttribute('rel')).toBe('noopener noreferrer')
    const restart = screen.getByRole('link', { name: 'Start new import' })
    expect(restart.tagName).toBe('A')
    expect(restart.getAttribute('href')).toBe('/admin/import')
    expect(input.files?.[0]).toBe(file)
  })

  it('另标签重登入口不替换文件选择，重试继续发送同一File和会话ID', async () => {
    const signIn = { status: 'error', message: 'Sign in to import Markdown.', signInRequired: true } as const
    action
      .mockResolvedValueOnce(signIn)
      .mockResolvedValueOnce({ status: 'error', message: 'Retry result.' })
    render(<ImportForm newPostId={newPostId} action={action} />)
    const input = selectFile()
    submit()
    const link = await screen.findByRole('link', { name: 'Sign in in a new tab' })
    expect(link.getAttribute('href')).toBe('/admin/login')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(input.files?.[0]).toBe(file)
    submit()
    expect((await screen.findByRole('alert')).textContent).toBe('Retry result.')
    expect(action.mock.calls[1][0]).toEqual(signIn)
    expect(action.mock.calls[1][1].get('newPostId')).toBe(newPostId)
    expect(action.mock.calls[1][1].get('file')).toBe(file)
  })

  it('真实Next导航信号继续交给框架，不伪装成网络失败', async () => {
    const navigation = await vi.importActual<typeof import('next/navigation')>('next/navigation')
    let signal: unknown
    try { navigation.redirect('/admin/posts/example') } catch (error) { signal = error }
    action.mockRejectedValue(signal)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ErrorBoundary><ImportForm newPostId={newPostId} action={action} /></ErrorBoundary>)
    selectFile()
    submit()
    await screen.findByText('Boundary failed.')
    expect(caught).toHaveBeenCalledWith(signal)
    expect(screen.queryByText(/Could not confirm the import/)).toBeNull()
  })
})

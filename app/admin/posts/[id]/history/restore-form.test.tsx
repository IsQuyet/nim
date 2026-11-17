import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RestoreFormState } from '@/modules/posts/history'
import { RestoreForm } from './restore-form'

const action = vi.fn<(state: RestoreFormState) => Promise<RestoreFormState>>()

beforeEach(() => action.mockReset())

describe('恢复修订表单', () => {
  it('与当前草稿相同时禁用恢复，并说明恢复不修改公开版本', () => {
    render(<RestoreForm action={action} disabled />)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Restore draft' }).disabled).toBe(true)
    expect(screen.getByText('This revision matches the current draft.')).toBeDefined()
    expect(screen.getByText('Restore this snapshot into the draft without changing the published version.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Restore draft' }))
    expect(action).not.toHaveBeenCalled()
  })

  it('恢复进行中阻止重复点击，冲突后仍留在表单并允许重试', async () => {
    const pending = Promise.withResolvers<RestoreFormState>()
    action.mockReturnValue(pending.promise)
    render(<RestoreForm action={action} disabled={false} />)
    const button = screen.getByRole<HTMLButtonElement>('button', { name: 'Restore draft' })
    fireEvent.click(button)
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('Restoring…')
    fireEvent.click(button)
    expect(action).toHaveBeenCalledTimes(1)
    const conflict = {
      status: 'error',
      message: 'This draft changed while you were viewing history. Reload the history page before restoring.',
    } as const
    await act(async () => pending.resolve(conflict))
    expect((await screen.findByRole('alert')).textContent).toBe(conflict.message)
    expect(button.disabled).toBe(false)
    expect(screen.getByRole('form', { name: 'Restore revision' })).toBeDefined()
  })

  it('身份失效提供另标签重登入口，重试沿用该表单绑定的恢复操作', async () => {
    const signIn = { status: 'error', message: 'Sign in to restore this revision.', signInRequired: true } as const
    action
      .mockResolvedValueOnce(signIn)
      .mockResolvedValueOnce({ status: 'error', message: 'The draft still changed.' })
    render(<RestoreForm action={action} disabled={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Restore draft' }))
    const link = await screen.findByRole('link', { name: 'Sign in in a new tab' })
    expect(link.getAttribute('href')).toBe('/admin/login')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByRole('form', { name: 'Restore revision' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Restore draft' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The draft still changed.')
    expect(action).toHaveBeenCalledTimes(2)
    expect(action.mock.calls[1][0]).toEqual(signIn)
  })
})

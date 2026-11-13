import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthButton } from './auth-button'

const auth = vi.hoisted(() => ({ signIn: vi.fn(), signOut: vi.fn() }))
vi.mock('next-auth/react', () => auth)

beforeEach(() => {
  auth.signIn.mockReset()
  auth.signOut.mockReset()
})

describe('管理员登录与退出操作', () => {
  it.each(['sign-in', 'sign-out'] as const)('执行 %s 时调用对应流程，等待期间不能重复提交', async action => {
    const pending = Promise.withResolvers<void>()
    auth.signIn.mockReturnValue(pending.promise)
    auth.signOut.mockReturnValue(pending.promise)
    render(<AuthButton action={action} />)
    const button = screen.getByRole<HTMLButtonElement>('button')

    fireEvent.click(button)
    expect(button.disabled).toBe(true)
    if (action === 'sign-in') {
      expect(auth.signIn).toHaveBeenCalledExactlyOnceWith('github', { callbackUrl: '/admin' })
      expect(auth.signOut).not.toHaveBeenCalled()
    } else {
      expect(auth.signOut).toHaveBeenCalledExactlyOnceWith({ callbackUrl: '/admin/login' })
      expect(auth.signIn).not.toHaveBeenCalled()
    }

    await act(async () => pending.resolve())
    expect(button.disabled).toBe(false)
  })

  it('请求失败时显示反馈，并允许重新尝试', async () => {
    auth.signIn.mockRejectedValue(new Error('Network unavailable'))
    render(<AuthButton action="sign-in" />)

    fireEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }))

    expect((await screen.findByRole('alert')).textContent)
      .toBe('Could not complete sign-in. Please try again.')
    expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(false)
  })
})

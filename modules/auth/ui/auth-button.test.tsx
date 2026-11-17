import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthButton } from './auth-button'

const mocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  getSession: vi.fn(),
  revokeSession: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}))
vi.mock('../client', () => ({
  authClient: {
    signIn: { social: mocks.signIn },
    getSession: mocks.getSession,
    revokeSession: mocks.revokeSession,
  },
}))
vi.mock('next/navigation', () => ({ useRouter: () => mocks }))

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getSession.mockResolvedValue({ data: { session: { token: 'session-token' } }, error: null })
})

describe('管理员登录与退出操作', () => {
  it.each(['sign-in', 'sign-out'] as const)('执行 %s 时调用对应流程，等待期间不能重复提交', async action => {
    const pending = Promise.withResolvers<{ error: null }>()
    mocks.signIn.mockReturnValue(pending.promise)
    mocks.revokeSession.mockReturnValue(pending.promise)
    render(<AuthButton action={action} />)
    const button = screen.getByRole<HTMLButtonElement>('button')

    await act(async () => fireEvent.click(button))
    expect(button.disabled).toBe(true)
    if (action === 'sign-in') {
      expect(mocks.signIn).toHaveBeenCalledExactlyOnceWith({
        provider: 'github',
        callbackURL: '/admin',
        errorCallbackURL: '/admin/login',
      })
      expect(mocks.getSession).not.toHaveBeenCalled()
      expect(mocks.revokeSession).not.toHaveBeenCalled()
    } else {
      expect(mocks.getSession).toHaveBeenCalledOnce()
      expect(mocks.revokeSession).toHaveBeenCalledExactlyOnceWith({ token: 'session-token' })
      expect(mocks.signIn).not.toHaveBeenCalled()
      expect(mocks.replace).not.toHaveBeenCalled()
    }

    await act(async () => pending.resolve({ error: null }))
    expect(button.disabled).toBe(false)
    if (action === 'sign-out') {
      expect(mocks.replace).toHaveBeenCalledExactlyOnceWith('/admin/login')
      expect(mocks.refresh).toHaveBeenCalledOnce()
    }
  })

  it.each(['sign-in', 'sign-out'] as const)('%s 被服务端拒绝时保留页面并提示重试', async action => {
    mocks.signIn.mockResolvedValue({ error: { message: 'Request rejected' } })
    mocks.revokeSession.mockResolvedValue({ error: { message: 'Request rejected' } })
    render(<AuthButton action={action} />)

    fireEvent.click(screen.getByRole('button'))

    expect((await screen.findByRole('alert')).textContent).toBe(action === 'sign-in'
      ? 'GitHub sign-in could not be completed. Please try signing in again.'
      : 'Could not complete sign-out. Please try again.')
    expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(false)
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('读取会话失败时不假装退出成功，保留页面供重试', async () => {
    mocks.getSession.mockResolvedValue({ error: { message: 'Storage unavailable' } })
    render(<AuthButton action="sign-out" />)

    fireEvent.click(screen.getByRole('button'))

    expect((await screen.findByRole('alert')).textContent)
      .toBe('Could not complete sign-out. Please try again.')
    expect(mocks.revokeSession).not.toHaveBeenCalled()
    expect(mocks.replace).not.toHaveBeenCalled()
  })

  it('会话已过期时直接回到登录页', async () => {
    mocks.getSession.mockResolvedValue({ data: null, error: null })
    render(<AuthButton action="sign-out" />)

    await act(async () => fireEvent.click(screen.getByRole('button')))

    expect(mocks.revokeSession).not.toHaveBeenCalled()
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith('/admin/login')
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('网络请求失败时显示反馈，并允许重新尝试', async () => {
    mocks.signIn.mockRejectedValue(new Error('Network unavailable'))
    render(<AuthButton action="sign-in" />)

    fireEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }))

    expect((await screen.findByRole('alert')).textContent)
      .toBe('GitHub sign-in could not be completed. Please try signing in again.')
    expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(false)
  })
})

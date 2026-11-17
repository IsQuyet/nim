import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LoginPage from './page'

const mocks = vi.hoisted(() => ({ getAdminSession: vi.fn(), getAuthOptions: vi.fn() }))
vi.mock('@/modules/auth/server/auth', () => mocks)
vi.mock('next/navigation', async importOriginal => ({
  ...await importOriginal<typeof import('next/navigation')>(),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}))

beforeEach(() => {
  mocks.getAdminSession.mockReset().mockResolvedValue(null)
  mocks.getAuthOptions.mockReset().mockReturnValue({})
})

describe('管理员登录提示', () => {
  it.each([
    ['access_denied', 'GitHub sign-in could not be completed. Please try signing in again.'],
    ['account_not_allowed', 'This GitHub account is not allowed to manage this site.'],
    ['internal_server_error', 'Sign-in is unavailable. Please check the server logs.'],
    ['invalid_code', 'GitHub sign-in could not be completed. Please try signing in again.'],
    ['UnexpectedFailure', 'GitHub sign-in could not be completed. Please try signing in again.'],
  ])('错误 %s 给出对应操作指引，保留 GitHub 登录入口', async (error, message) => {
    render(await LoginPage({ searchParams: Promise.resolve({ error }) }))

    expect(screen.getByRole('alert').textContent).toBe(message)
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeDefined()
    expect(screen.queryByText(error, { exact: true })).toBeNull()
  })

  it('没有错误时只显示正常登录入口', async () => {
    render(await LoginPage({ searchParams: Promise.resolve({}) }))

    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Continue with GitHub' })).toBeDefined()
  })
})

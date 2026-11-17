// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestAdminSession } from '@/test/admin-session'
import { getAdminSession } from './auth'
import { withAdmin } from './admin'

vi.mock('server-only', () => ({}))
vi.mock('./auth', () => ({ getAdminSession: vi.fn() }))

beforeEach(() => {
  vi.mocked(getAdminSession).mockReset().mockResolvedValue(createTestAdminSession())
})

describe('管理员操作入口', () => {
  it('未登录时返回拒绝结果，不执行操作', async () => {
    vi.mocked(getAdminSession).mockResolvedValue(null)
    const operation = vi.fn()
    expect(await withAdmin(operation)).toEqual({ authorized: false })
    expect(operation).not.toHaveBeenCalled()
  })

  it('会话检查故障原样抛出，不当作未登录，也不执行操作', async () => {
    const error = new Error('Session storage unavailable')
    vi.mocked(getAdminSession).mockRejectedValue(error)
    const operation = vi.fn()
    await expect(withAdmin(operation)).rejects.toBe(error)
    expect(operation).not.toHaveBeenCalled()
  })

  it('管理员的操作结果在完成后交还，操作的错误原样抛出', async () => {
    expect(await withAdmin(async () => 'done')).toEqual({ authorized: true, value: 'done' })
    const error = new Error('Operation failed')
    await expect(withAdmin(() => { throw error })).rejects.toBe(error)
  })
})

// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getServerSession, type Account } from 'next-auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAdminSession, getAuthOptions } from './auth'
import { getAuthSecret, initializeAuthSecret } from './auth-secret'
import { getAuthSecretPath } from './data-paths'

vi.mock('server-only', () => ({}))
vi.mock('next/server', () => ({ connection: async () => {} }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))

const environment = {
  NODE_ENV: 'production',
  SITE_URL: 'https://example.test',
  GITHUB_CLIENT_ID: 'test-client-id',
  GITHUB_CLIENT_SECRET: 'test-client-secret',
  ADMIN_GITHUB_ID: '1234',
}

function githubAccount(id: string, provider = 'github'): Account {
  return {
    provider,
    providerAccountId: id,
    type: 'oauth',
    access_token: 'provider-access-token',
  }
}

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'nim-auth-options-'))
  vi.stubEnv('DATABASE_PATH', join(directory, 'nim.sqlite'))
  for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value)
  vi.stubEnv('NEXTAUTH_URL', '')
  initializeAuthSecret()
  vi.mocked(getServerSession).mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
  if (directory) rmSync(directory, { recursive: true })
})

describe('管理员身份与认证配置', () => {
  it.each(['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'ADMIN_GITHUB_ID'])(
    '缺少 %s 时不启用认证，不授予管理员会话',
    async name => {
      vi.stubEnv(name, '')
      expect(getAuthOptions()).toBeNull()
      expect(await getAdminSession()).toBeNull()
      expect(getServerSession).not.toHaveBeenCalled()
    },
  )

  it('认证使用持久文件中的密钥，文件缺失时保持关闭', () => {
    expect(getAuthOptions()?.secret).toBe(getAuthSecret())
    expect(getAuthOptions()?.secret).toBeTruthy()

    rmSync(getAuthSecretPath())

    expect(getAuthOptions()).toBeNull()
  })

  it('只允许指定 GitHub 账号，名字、邮箱或其他身份来源不能替代账号 ID', async () => {
    const signIn = getAuthOptions()!.callbacks!.signIn!
    const user = { id: '1234', name: 'Same name', email: 'same@example.test' }

    expect(await signIn({ user, account: githubAccount('1234') })).toBe(true)
    expect(await signIn({ user, account: githubAccount('5678') })).toBe(false)
    expect(await signIn({ user, account: githubAccount('1234', 'other') })).toBe(false)
    expect(await signIn({ user, account: null })).toBe(false)
  })

  it('会话身份取自 OAuth 账号，客户端会话更新不能替换身份，也不向会话复制 GitHub 令牌', async () => {
    const callbacks = getAuthOptions()!.callbacks!
    const token = await callbacks.jwt!({
      token: {},
      user: { id: '1234' },
      account: githubAccount('1234'),
      trigger: 'signIn',
    })
    const updated = await callbacks.jwt!({
      token,
      user: { id: '5678' },
      account: null,
      trigger: 'update',
      session: { githubId: '5678' },
    })
    const session = await callbacks.session!({
      session: { expires: '2099-01-01T00:00:00Z' },
      token: updated,
      user: { id: '5678', email: 'unused@example.test', emailVerified: null },
      newSession: { githubId: '5678' },
      trigger: 'update',
    })

    expect(updated.githubId).toBe('1234')
    expect(updated).not.toHaveProperty('access_token')
    expect(session).toMatchObject({ githubId: '1234' })
    expect(session).not.toHaveProperty('access_token')
  })

  it('使用唯一的站点地址生成回调基址，只允许回到同一站点', async () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://unrelated.test')
    const options = getAuthOptions()!
    const redirect = options.callbacks!.redirect!

    expect(process.env.NEXTAUTH_URL).toBe('https://example.test')
    expect(await redirect({ url: '/admin', baseUrl: 'https://unrelated.test' }))
      .toBe('https://example.test/admin')
    expect(await redirect({ url: 'https://example.test/admin/login', baseUrl: 'https://unrelated.test' }))
      .toBe('https://example.test/admin/login')
    expect(await redirect({ url: 'https://unrelated.test/admin', baseUrl: 'https://example.test' }))
      .toBe('https://example.test/admin')
  })

  it('每次服务端检查都核对当前管理员，修改指定账号后旧身份不再有权限', async () => {
    const session = { githubId: '1234', expires: '2099-01-01T00:00:00Z' }
    vi.mocked(getServerSession).mockResolvedValue(session)
    expect(await getAdminSession()).toEqual(session)

    vi.stubEnv('ADMIN_GITHUB_ID', '5678')
    expect(await getAdminSession()).toBeNull()

    vi.mocked(getServerSession).mockResolvedValue({ expires: session.expires })
    expect(await getAdminSession()).toBeNull()
    vi.mocked(getServerSession).mockResolvedValue(null)
    expect(await getAdminSession()).toBeNull()
  })
})

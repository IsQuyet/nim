// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database } from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAuthSecret, initializeAuthSecret } from './auth-secret'
import { getAuthSecretPath } from './server/data-paths'
import { initializeDatabase, openDatabase } from './server/database'
import { session as sessions } from './schema'
import { createWritingStore } from './writing-store'
import { createTestDraft } from '../test/post-commands'

const next = vi.hoisted(() => ({ requestHeaders: new Headers() }))
vi.mock('server-only', () => ({}))
vi.mock('next/server', () => ({ connection: async () => {} }))
vi.mock('next/headers', () => ({ headers: async () => next.requestHeaders }))

const environment = {
  NODE_ENV: 'production',
  SITE_URL: 'https://example.test',
  GITHUB_CLIENT_ID: 'test-client-id',
  GITHUB_CLIENT_SECRET: 'test-client-secret',
  ADMIN_GITHUB_ID: '1234',
}

let directory: string
let app: typeof import('./auth')
let route: typeof import('../app/api/auth/[...all]/route')
let database: Database
let githubId: string
let githubRequests: Request[]
let cookies: Map<string, string>
let scenario = 0

function cookieHeader() {
  return Array.from(cookies, ([name, value]) => `${name}=${value}`).join('; ')
}

function captureCookies(response: Response) {
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(';')[0]
    const separator = pair.indexOf('=')
    const name = pair.slice(0, separator)
    const value = pair.slice(separator + 1)
    if (!value || /Max-Age=0/i.test(header)) cookies.delete(name)
    else cookies.set(name, value)
  }
  next.requestHeaders = new Headers({ cookie: cookieHeader() })
}

async function request(path: string, options: {
  method?: 'GET' | 'POST'
  body?: Record<string, unknown>
  origin?: string
  host?: string
} = {}) {
  const method = options.method ?? 'GET'
  const headers = new Headers({
    origin: options.origin ?? environment.SITE_URL,
    cookie: cookieHeader(),
    'x-forwarded-for': `192.0.2.${scenario}`,
  })
  if (options.body) headers.set('content-type', 'application/json')
  const input = new Request(`${options.host ?? environment.SITE_URL}/api/auth${path}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const response = await route[method](input)
  captureCookies(response)
  return response
}

async function beginSignIn(options: Record<string, unknown> = {}) {
  const response = await request('/sign-in/social', {
    method: 'POST',
    body: {
      provider: 'github',
      callbackURL: '/admin',
      errorCallbackURL: '/admin/login',
      ...options,
    },
  })
  expect(response.status).toBe(200)
  const data = await response.json() as { url: string }
  return new URL(data.url)
}

async function finishSignIn(authorization: URL) {
  const state = authorization.searchParams.get('state')!
  return request(`/callback/github?code=test-code&state=${encodeURIComponent(state)}`)
}

beforeEach(async () => {
  scenario += 1
  vi.resetModules()
  directory = mkdtempSync(join(tmpdir(), 'nim-auth-'))
  vi.stubEnv('DATABASE_PATH', join(directory, 'nim.sqlite'))
  for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value)
  await initializeDatabase()
  initializeAuthSecret()
  cookies = new Map()
  next.requestHeaders = new Headers()
  githubId = '1234'
  githubRequests = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input, init)
    githubRequests.push(request.clone())
    if (request.url === 'https://github.com/login/oauth/access_token') {
      return Response.json({
        access_token: 'provider-access-token',
        token_type: 'bearer',
        scope: 'read:user,user:email',
      })
    }
    if (request.url === 'https://api.github.com/user') {
      return Response.json({
        id: Number(githubId),
        login: 'admin',
        name: 'Same name',
        email: null,
        avatar_url: 'https://avatars.example.test/admin.png',
      })
    }
    if (request.url === 'https://api.github.com/user/emails') {
      return Response.json([{
        email: 'admin@example.test',
        primary: true,
        verified: true,
        visibility: 'private',
      }])
    }
    throw new Error(`Unexpected request: ${request.url}`)
  }))
  app = await import('./auth')
  route = await import('../app/api/auth/[...all]/route')
  const auth = app.getAuth()!
  await auth.$context
  database = auth.options.database as Database
})

afterEach(() => {
  if (database?.open) database.close()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  if (directory) rmSync(directory, { recursive: true })
})

describe('管理员认证与数据库会话', () => {
  it.each(['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'ADMIN_GITHUB_ID'])(
    '缺少 %s 时关闭认证入口，也不授予管理员权限',
    async name => {
      vi.stubEnv(name, '')
      expect(app.getAuthOptions()).toBeNull()
      expect(await app.getAdminSession()).toBeNull()
      expect((await request('/sign-in/social', {
        method: 'POST', body: { provider: 'github' },
      })).status).toBe(503)
      expect(githubRequests).toHaveLength(0)
    },
  )

  it('配置读取不创建密钥或数据库，缺少密钥时关闭认证', async () => {
    database.close()
    rmSync(getAuthSecretPath())
    rmSync(join(directory, 'nim.sqlite'))

    expect(app.getAuthOptions()).toBeNull()
    expect(await app.getAdminSession()).toBeNull()
    expect(existsSync(getAuthSecretPath())).toBe(false)
    expect(existsSync(join(directory, 'nim.sqlite'))).toBe(false)
  })

  it('GitHub 登录绑定站点地址和 PKCE，指定账号建立一天会话，不向客户端泄漏提供方令牌', async () => {
    const response = await request('/sign-in/social', {
      method: 'POST',
      host: 'https://unrelated.test',
      body: { provider: 'github', callbackURL: '/admin', errorCallbackURL: '/admin/login' },
    })
    expect(response.status).toBe(200)
    const authorization = new URL((await response.json()).url)
    expect(authorization.origin + authorization.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(authorization.searchParams.get('redirect_uri')).toBe('https://example.test/api/auth/callback/github')
    expect(authorization.searchParams.get('scope')?.split(' ').sort()).toEqual(['read:user', 'user:email'])
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorization.searchParams.get('state')).toBeTruthy()

    const completed = await finishSignIn(authorization)
    expect(completed.status).toBe(302)
    expect(new URL(completed.headers.get('location')!, environment.SITE_URL).pathname).toBe('/admin')
    const tokenRequest = githubRequests.find(request => request.url.includes('/access_token'))!
    const tokenBody = new URLSearchParams(await tokenRequest.text())
    expect(tokenBody.get('redirect_uri')).toBe('https://example.test/api/auth/callback/github')
    expect(createHash('sha256').update(tokenBody.get('code_verifier')!).digest('base64url'))
      .toBe(authorization.searchParams.get('code_challenge'))
    const sessionCookie = completed.headers.getSetCookie().find(cookie => cookie.includes('session_token='))!
    expect(sessionCookie).toContain('HttpOnly')
    expect(sessionCookie).toContain('Secure')
    expect(sessionCookie).toMatch(/SameSite=Lax/i)
    expect(sessionCookie).toContain('Max-Age=86400')
    expect(await app.getAdminSession()).not.toBeNull()

    const sessionResponse = await request('/get-session')
    const session = await sessionResponse.json()
    expect(session.user.email).toBe('admin@example.test')
    expect(sessionResponse.status).toBe(200)
    expect(JSON.stringify(session)).not.toContain('provider-access-token')
    expect(JSON.stringify(session)).not.toContain(getAuthSecret())
    const account = database.prepare('SELECT providerId, accountId, accessToken FROM account').get() as {
      providerId: string; accountId: string; accessToken: string
    }
    expect(account).toMatchObject({ providerId: 'github', accountId: '1234' })
    expect(account.accessToken).toBeTruthy()
    expect(account.accessToken).not.toBe('provider-access-token')
  })

  it.each(['/get-access-token', '/refresh-token'])('浏览器不能通过 %s 提取或刷新 GitHub 令牌', async path => {
    await finishSignIn(await beginSignIn())
    const accounts = await (await request('/list-accounts')).json() as { id: string }[]
    const response = await request(path, { method: 'POST', body: { accountId: accounts[0].id } })
    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain('provider-access-token')
  })

  it('账号关联存储故障保持为错误，不伪装成未登录', async () => {
    await finishSignIn(await beginSignIn())
    database.exec('ALTER TABLE account RENAME TO unavailable_account')
    try {
      await expect(app.getAdminSession()).rejects.toThrow()
    } finally {
      database.exec('ALTER TABLE unavailable_account RENAME TO account')
    }
    expect(await app.getAdminSession()).not.toBeNull()
  })

  it('认证与 Drizzle 对同一会话日期使用一致的查询和存储编码', async () => {
    await finishSignIn(await beginSignIn())
    const session = (await app.getAdminSession())!
    const orm = openDatabase()
    try {
      expect(orm.select({ id: sessions.id }).from(sessions)
        .where(eq(sessions.expiresAt, session.session.expiresAt)).get())
        .toEqual({ id: session.session.id })
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000)
      orm.update(sessions).set({ expiresAt }).where(eq(sessions.id, session.session.id)).run()
      expect((await app.getAdminSession())?.session.expiresAt).toEqual(expiresAt)
    } finally {
      orm.$client.close()
    }
  })

  it('账号关联写入失败时回滚用户登记，恢复存储后可以重新登录', async () => {
    database.exec(`
      CREATE TRIGGER reject_account BEFORE INSERT ON account
      BEGIN SELECT RAISE(ABORT, 'account unavailable'); END;
    `)
    const response = await finishSignIn(await beginSignIn())
    expect(response.status).toBe(302)
    expect(new URL(response.headers.get('location')!, environment.SITE_URL).pathname).toBe('/admin/login')
    expect(database.prepare('SELECT * FROM user').all()).toEqual([])
    expect(database.prepare('SELECT * FROM account').all()).toEqual([])
    expect(database.prepare('SELECT * FROM session').all()).toEqual([])

    database.exec('DROP TRIGGER reject_account')
    expect((await finishSignIn(await beginSignIn())).status).toBe(302)
    expect(await app.getAdminSession()).not.toBeNull()
  })

  it('其他 GitHub 账号即使姓名邮箱相同或提交管理员字段，也不能登记用户和会话', async () => {
    githubId = '5678'
    const authorization = await beginSignIn({ additionalData: { githubId: '1234' } })
    const response = await finishSignIn(authorization)

    expect(response.status).toBe(302)
    const target = new URL(response.headers.get('location')!, environment.SITE_URL)
    expect(target.pathname).toBe('/admin/login')
    expect(target.searchParams.get('error')).toBe('account_not_allowed')
    expect(database.prepare('SELECT * FROM user').all()).toEqual([])
    expect(database.prepare('SELECT * FROM account').all()).toEqual([])
    expect(database.prepare('SELECT * FROM session').all()).toEqual([])
    expect(await app.getAdminSession()).toBeNull()
  })

  it('取消 GitHub 授权不会登记用户，也不冒充站点账号准入错误', async () => {
    const authorization = await beginSignIn()
    const state = authorization.searchParams.get('state')!
    const response = await request(`/callback/github?error=access_denied&state=${encodeURIComponent(state)}`)

    const target = new URL(response.headers.get('location')!, environment.SITE_URL)
    expect(target.pathname).toBe('/admin/login')
    expect(target.searchParams.get('error')).toBe('access_denied')
    expect(githubRequests).toHaveLength(0)
    expect(database.prepare('SELECT * FROM user').all()).toEqual([])
  })

  it('无效 OAuth state 不能交换授权码或建立会话', async () => {
    const authorization = await beginSignIn()
    authorization.searchParams.set('state', 'unrelated-state')
    const response = await finishSignIn(authorization)

    expect(response.status).toBe(302)
    expect(new URL(response.headers.get('location')!, environment.SITE_URL).pathname).toBe('/admin/login')
    expect(githubRequests).toHaveLength(0)
    expect(await app.getAdminSession()).toBeNull()
  })

  it.each(['callbackURL', 'errorCallbackURL', 'newUserCallbackURL'])(
    '拒绝将 %s 指向其他站点',
    async field => {
      const response = await request('/sign-in/social', {
        method: 'POST',
        body: { provider: 'github', [field]: 'https://unrelated.test/admin' },
      })
      expect(response.status).toBe(403)
      expect(githubRequests).toHaveLength(0)
    },
  )

  it('跨站请求不能发起登录或退出已有会话', async () => {
    expect((await request('/sign-in/social', {
      method: 'POST', origin: 'https://unrelated.test', body: { provider: 'github' },
    })).status).toBe(403)
    await finishSignIn(await beginSignIn())
    const session = await (await request('/get-session')).json()
    expect((await request('/revoke-session', {
      method: 'POST', origin: 'https://unrelated.test', body: { token: session.session.token },
    })).status).toBe(403)
    expect(await app.getAdminSession()).not.toBeNull()
  })

  it('管理员配置变化立即取消旧身份权限，客户端更新资料不能替换 GitHub 身份', async () => {
    await finishSignIn(await beginSignIn())
    expect(await app.getAdminSession()).not.toBeNull()
    vi.stubEnv('ADMIN_GITHUB_ID', '5678')
    await request('/update-user', {
      method: 'POST', body: { name: 'Changed name', githubId: '5678', id: '5678' },
    })

    expect(await app.getAdminSession()).toBeNull()
    expect(database.prepare('SELECT accountId FROM account').get()).toEqual({ accountId: '1234' })
    const response = await finishSignIn(await beginSignIn())
    expect(new URL(response.headers.get('location')!, environment.SITE_URL).searchParams.get('error'))
      .toBe('account_not_allowed')
    expect(database.prepare('SELECT * FROM session').all()).toHaveLength(1)
  })

  it('撤销失败时明确报错并保留 Cookie，原会话可以重试撤销', async () => {
    await finishSignIn(await beginSignIn())
    const session = await (await request('/get-session')).json()
    const originalCookies = cookieHeader()
    const context = await app.getAuth()!.$context
    const deletion = vi.spyOn(context.internalAdapter, 'deleteSession')
      .mockRejectedValueOnce(new Error('SQLITE_BUSY'))

    const failed = await request('/revoke-session', { method: 'POST', body: { token: session.session.token } })
    expect(failed.status).toBe(500)
    expect(cookieHeader()).toBe(originalCookies)
    expect(await app.getAdminSession()).not.toBeNull()

    deletion.mockRestore()
    expect((await request('/revoke-session', {
      method: 'POST', body: { token: session.session.token },
    })).status).toBe(200)
    expect(await app.getAdminSession()).toBeNull()
  })

  it('退出从服务端撤销会话，重放原 Cookie 也不能恢复登录', async () => {
    await finishSignIn(await beginSignIn())
    const originalCookies = cookieHeader()
    const session = await (await request('/get-session')).json()
    expect((await request('/revoke-session', {
      method: 'POST', body: { token: session.session.token },
    })).status).toBe(200)
    expect(database.prepare('SELECT * FROM session').all()).toEqual([])
    cookies = new Map(originalCookies.split('; ').map(pair => {
      const separator = pair.indexOf('=')
      return [pair.slice(0, separator), pair.slice(separator + 1)]
    }))
    next.requestHeaders = new Headers({ cookie: cookieHeader() })
    expect(await app.getAdminSession()).toBeNull()
  })

  it('过期或篡改 Cookie 不能授予管理员权限', async () => {
    await finishSignIn(await beginSignIn())
    const originalHeaders = next.requestHeaders
    next.requestHeaders = new Headers({ cookie: `${Array.from(cookies.keys()).find(name => name.endsWith('session_token'))}=tampered` })
    expect(await app.getAdminSession()).toBeNull()

    next.requestHeaders = originalHeaders
    database.prepare('UPDATE session SET expiresAt = ?').run(new Date(Date.now() - 1).toISOString())
    expect(await app.getAdminSession()).toBeNull()
  })

  it('重复初始化和重新建立认证实例保留数据库会话与密钥', async () => {
    await finishSignIn(await beginSignIn())
    const secret = getAuthSecret()
    database.close()
    await initializeDatabase()
    initializeAuthSecret()
    vi.resetModules()
    app = await import('./auth')
    const auth = app.getAuth()!
    await auth.$context
    database = auth.options.database as Database

    expect(getAuthSecret()).toBe(secret)
    expect(await app.getAdminSession()).not.toBeNull()
  })

  it('认证存储不可用时向上传播错误，不执行文章操作', async () => {
    await finishSignIn(await beginSignIn())
    const { withAdminPostStore } = await import('./admin-posts')
    const operation = vi.fn()
    database.exec('ALTER TABLE session RENAME TO unavailable_session')
    try {
      await expect(withAdminPostStore(operation)).rejects.toThrow()
      expect(operation).not.toHaveBeenCalled()
    } finally {
      database.exec('ALTER TABLE unavailable_session RENAME TO session')
    }
  })

  it('会话过期后保存返回重登提示，已保存正文保持不变', async () => {
    await finishSignIn(await beginSignIn())
    const orm = openDatabase()
    const original = { title: 'Saved title', description: '', body: '# Saved body\r\n' }
    let id: string
    let expectedRevisionId: number
    let receipts: unknown[]
    try {
      const draft = createTestDraft(createWritingStore(orm), original)
      id = draft.id
      expectedRevisionId = draft.revisionId
      receipts = orm.$client.prepare('SELECT * FROM post_write_receipts WHERE post_id = ?').all(id)
    } finally {
      orm.$client.close()
    }
    database.prepare('UPDATE session SET expiresAt = ?').run(new Date(Date.now() - 1).toISOString())
    const { writeDraftAction } = await import('../app/admin/writing-actions')

    expect(await writeDraftAction({
      postId: id, operationId: randomUUID(), intent: 'save',
      content: { ...original, body: '# Unsaved body' }, expectedRevisionId,
    })).toEqual({
      status: 'error',
      message: 'Sign in to save or publish this draft.',
      signInRequired: true,
    })
    expect(database.prepare(`SELECT r.title, r.description, r.body FROM post_revisions r
      INNER JOIN post_drafts d ON d.revision_id = r.id WHERE d.post_id = ?`).get(id))
      .toEqual(original)
    expect(database.prepare('SELECT revision_id FROM post_drafts WHERE post_id = ?').get(id))
      .toEqual({ revision_id: expectedRevisionId })
    expect(database.prepare('SELECT * FROM post_write_receipts WHERE post_id = ?').all(id)).toEqual(receipts)
  })

  it('不开放邮箱密码注册', async () => {
    const response = await request('/sign-up/email', {
      method: 'POST',
      body: { name: 'Visitor', email: 'visitor@example.test', password: 'not-a-site-password' },
    })
    expect(response.ok).toBe(false)
    expect(database.prepare('SELECT * FROM user').all()).toEqual([])
  })
})

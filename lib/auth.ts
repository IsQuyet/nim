import 'server-only'
import { cache } from 'react'
import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { getSiteUrl } from './site-config'
import { getAuthSecret } from './auth-secret'
import { openDatabase } from './database'

const SESSION_MAX_AGE = 24 * 60 * 60
let auth: ReturnType<typeof betterAuth> | undefined

export function getAuthOptions(): BetterAuthOptions | null {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim()
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim()
  const adminId = process.env.ADMIN_GITHUB_ID?.trim()
  if (!clientId || !clientSecret || !adminId) return null

  const secret = getAuthSecret()
  if (!secret) return null

  return {
    baseURL: getSiteUrl().origin,
    secret,
    advanced: { disableOriginCheck: false },
    session: { expiresIn: SESSION_MAX_AGE, disableSessionRefresh: true },
    socialProviders: { github: { clientId, clientSecret } },
    user: {
      validateUserInfo({ source }) {
        if (
          source.method !== 'oauth' ||
          source.oauth?.providerId !== 'github' ||
          String(source.oauth.profile?.id) !== process.env.ADMIN_GITHUB_ID?.trim()
        ) {
          return { error: 'account_not_allowed' }
        }
      },
    },
    account: {
      accountLinking: { enabled: false },
      encryptOAuthTokens: true,
    },
    onAPIError: { errorURL: '/admin/login' },
    disabledPaths: ['/get-access-token', '/refresh-token', '/sign-out'],
  }
}

export function getAuth() {
  const options = getAuthOptions()
  if (!options) return null

  // 按需建立进程内共享连接，构建时不打开持久化文件。
  auth ??= betterAuth<BetterAuthOptions>({ ...options, database: openDatabase() })
  return auth
}

export const getAdminSession = cache(async () => {
  await connection()
  const auth = getAuth()
  if (!auth) return null

  const requestHeaders = await headers()
  const session = await auth.api.getSession({ headers: requestHeaders })
  if (!session) return null

  const accounts = await auth.api.listUserAccounts({ headers: requestHeaders })
  return accounts.some(account =>
    account.providerId === 'github' && account.accountId === process.env.ADMIN_GITHUB_ID?.trim(),
  ) ? session : null
})

export async function requireAdminSession() {
  const session = await getAdminSession()
  if (!session) redirect('/admin/login')

  return session
}

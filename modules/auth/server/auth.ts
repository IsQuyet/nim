import 'server-only'
import { cache } from 'react'
import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { getSiteUrl } from '@/lib/server/site-config'
import { getSharedDatabase, withDatabase } from '@/lib/server/database'
import { routes } from '@/lib/routes'
import * as authSchema from './schema'
import { getAuthSecret } from './secret'

const SESSION_MAX_AGE = 24 * 60 * 60
let auth: ReturnType<typeof betterAuth> | undefined
let pendingAuth: Promise<ReturnType<typeof betterAuth> | null> | undefined

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
    onAPIError: { errorURL: routes.admin.login },
    disabledPaths: ['/get-access-token', '/refresh-token', '/sign-out'],
  }
}

export async function getAuth() {
  const options = getAuthOptions()
  if (!options) return null
  if (auth) return auth

  if (!pendingAuth) {
    pendingAuth = getSharedDatabase()
      .then(database => {
        auth = betterAuth<BetterAuthOptions>({
          ...options,
          database: drizzleAdapter(database, { provider: 'pg', schema: authSchema, transaction: true }),
        })
        return auth
      })
      .finally(() => {
        pendingAuth = undefined
      })
  }
  return pendingAuth
}

export const getAdminSession = cache(async () => {
  await connection()
  const authInstance = await getAuth()
  if (!authInstance) return null

  const requestHeaders = await headers()
  const session = await authInstance.api.getSession({ headers: requestHeaders })
  if (!session) return null

  const adminId = process.env.ADMIN_GITHUB_ID?.trim()
  if (!adminId) return null

  return withDatabase(async database => {
    const [adminAccount] = await database.select({ id: authSchema.account.id }).from(authSchema.account).where(and(
      eq(authSchema.account.userId, session.user.id),
      eq(authSchema.account.providerId, 'github'),
      eq(authSchema.account.accountId, adminId),
    )).limit(1)
    return adminAccount ? session : null
  })
})

export async function requireAdminSession() {
  const session = await getAdminSession()
  if (!session) redirect(routes.admin.login)

  return session
}

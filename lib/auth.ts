import 'server-only'
import { cache } from 'react'
import { getServerSession, type NextAuthOptions } from 'next-auth'
import GitHub from 'next-auth/providers/github'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { getSiteUrl } from './site-config'

declare module 'next-auth' {
  interface Session {
    githubId?: string
  }
}

const SESSION_MAX_AGE = 24 * 60 * 60

type AuthEnvironment = Readonly<Record<string, string | undefined>>

export function getAuthOptions(environment: AuthEnvironment = process.env): NextAuthOptions | null {
  const clientId = environment.GITHUB_CLIENT_ID?.trim()
  const clientSecret = environment.GITHUB_CLIENT_SECRET?.trim()
  const adminId = environment.ADMIN_GITHUB_ID?.trim()
  const secret = environment.AUTH_SECRET?.trim()

  if (!clientId || !clientSecret || !adminId || !secret) return null

  const siteUrl = getSiteUrl(environment)
  // NextAuth v4 从环境变量读取回调基址，统一由 SITE_URL 提供，不另配域名。
  process.env.NEXTAUTH_URL = siteUrl.origin

  return {
    secret,
    session: { strategy: 'jwt', maxAge: SESSION_MAX_AGE },
    jwt: { maxAge: SESSION_MAX_AGE },
    providers: [
      GitHub({
        clientId,
        clientSecret,
        checks: ['pkce', 'state'],
        authorization: { params: { scope: '' } },
        userinfo: {
          // 身份判断只需公开账号资料，不额外申请或读取私人邮箱。
          request: ({ client, tokens }) => client.userinfo(tokens.access_token!),
        },
      }),
    ],
    pages: {
      signIn: '/admin/login',
      signOut: '/admin',
      error: '/admin/login',
      verifyRequest: '/admin/login',
    },
    callbacks: {
      signIn({ account }) {
        return account?.provider === 'github' && account.providerAccountId === adminId
      },
      jwt({ token, account }) {
        if (account) {
          token.githubId = account.provider === 'github' ? account.providerAccountId : undefined
        }
        return token
      },
      session({ session, token }) {
        session.githubId = typeof token.githubId === 'string' ? token.githubId : undefined
        return session
      },
      redirect({ url }) {
        try {
          const target = new URL(url, siteUrl)
          if (target.origin === siteUrl.origin) return target.href
        } catch {}

        return new URL('/admin', siteUrl).href
      },
    },
  }
}

export const getAdminSession = cache(async () => {
  await connection()
  const options = getAuthOptions()
  if (!options) return null

  const session = await getServerSession(options)
  return session?.githubId === process.env.ADMIN_GITHUB_ID?.trim() ? session : null
})

export async function requireAdminSession() {
  const session = await getAdminSession()
  if (!session) redirect('/admin/login')

  return session
}

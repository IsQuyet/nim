import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getAdminSession, getAuthOptions } from '@/modules/auth/server/auth'
import { AuthButton } from '@/modules/auth/ui/auth-button'
import { routes } from '@/lib/routes'

export const metadata: Metadata = { title: 'Sign in' }

type LoginPageProps = {
  searchParams: Promise<{ error?: string }>
}

function getSignInErrorMessage(error: string) {
  if (error === 'account_not_allowed') return 'This GitHub account is not allowed to manage this site.'
  if (error === 'internal_server_error') return 'Sign-in is unavailable. Please check the server logs.'

  return 'GitHub sign-in could not be completed. Please try signing in again.'
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  if (await getAdminSession()) redirect(routes.admin.home)

  const configured = getAuthOptions() !== null
  const { error } = await searchParams

  return (
    <main className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-lg font-medium">Sign in</h1>
        <p className="text-muted-foreground">
          Sign in with the GitHub account configured to manage this site.
        </p>
      </section>
      {configured ? (
        <AuthButton action="sign-in" />
      ) : (
        <p className="text-sm text-muted-foreground">
          Administrator sign-in is not configured.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-muted-foreground">
          {getSignInErrorMessage(error)}
        </p>
      )}
    </main>
  )
}

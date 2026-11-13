import { requireAdminSession } from '@/lib/auth'
import { AuthButton } from './auth-button'

export default async function AdminPage() {
  await requireAdminSession()

  return (
    <main className="space-y-8">
      <section className="space-y-3">
        <h1 className="text-lg font-medium">Admin</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Signed in with the GitHub account configured for this site.
        </p>
      </section>
      <AuthButton action="sign-out" />
    </main>
  )
}

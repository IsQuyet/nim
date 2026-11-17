'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '../client'
import { Magnetic } from '@/components/ui/magnetic'

type AuthButtonProps = {
  action: 'sign-in' | 'sign-out'
}

export function AuthButton({ action }: AuthButtonProps) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  const isSignIn = action === 'sign-in'

  async function handleClick() {
    setPending(true)
    setError(false)

    try {
      if (isSignIn) {
        const result = await authClient.signIn.social({
          provider: 'github',
          callbackURL: '/admin',
          errorCallbackURL: '/admin/login',
        })
        if (result.error) setError(true)
      } else {
        const session = await authClient.getSession()
        if (session.error) {
          setError(true)
          return
        }
        if (session.data) {
          const result = await authClient.revokeSession({ token: session.data.session.token })
          if (result.error) {
            setError(true)
            return
          }
        }
        router.replace('/admin/login')
        router.refresh()
      }
    } catch {
      setError(true)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <Magnetic springOptions={{ bounce: 0 }} intensity={0.3}>
        <button
          type="button"
          onClick={handleClick}
          disabled={pending}
          aria-busy={pending}
          className="inline-flex items-center rounded-full bg-zinc-100 px-3 py-1.5 text-sm text-black transition-colors duration-200 hover:bg-zinc-950 hover:text-zinc-50 disabled:cursor-wait disabled:opacity-60 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
        >
          {pending
            ? (isSignIn ? 'Signing in…' : 'Signing out…')
            : (isSignIn ? 'Continue with GitHub' : 'Sign out')}
        </button>
      </Magnetic>
      {error && (
        <p role="alert" className="text-sm text-zinc-600 dark:text-zinc-400">
          {isSignIn
            ? 'GitHub sign-in could not be completed. Please try signing in again.'
            : 'Could not complete sign-out. Please try again.'}
        </p>
      )}
    </div>
  )
}

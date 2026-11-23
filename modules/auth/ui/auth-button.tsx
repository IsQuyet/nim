'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '../client'
import { signOut } from './sign-out'
import { Magnetic } from '@/components/ui/magnetic'
import { Button } from '@/components/ui/button'
import { routes } from '@/lib/routes'

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
          callbackURL: routes.admin.home,
          errorCallbackURL: routes.admin.login,
        })
        if (result.error) setError(true)
      } else {
        if (!(await signOut())) {
          setError(true)
          return
        }
        router.replace(routes.admin.login)
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
        <Button type="button" onClick={handleClick} disabled={pending} aria-busy={pending}>
          {pending
            ? (isSignIn ? 'Signing in…' : 'Signing out…')
            : (isSignIn ? 'Continue with GitHub' : 'Sign out')}
        </Button>
      </Magnetic>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {isSignIn
            ? 'GitHub sign-in could not be completed. Please try signing in again.'
            : 'Could not complete sign-out. Please try again.'}
        </p>
      )}
    </div>
  )
}

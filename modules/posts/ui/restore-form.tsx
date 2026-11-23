'use client'

import { useActionState } from 'react'
import { Button } from '@/components/ui/button'
import type { RestoreFormState } from '../history'
import { routes } from '@/lib/routes'

type RestoreFormProps = {
  action: (state: RestoreFormState) => Promise<RestoreFormState>
  disabled: boolean
}

export function RestoreForm({ action, disabled }: RestoreFormProps) {
  const [state, formAction, pending] = useActionState(action, { status: 'idle' })

  return (
    <form action={formAction} aria-label="Restore revision" className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Restore this snapshot into the draft without changing the published version.
      </p>
      <Button type="submit" disabled={disabled || pending} aria-busy={pending}>
        {pending ? 'Restoring…' : 'Restore draft'}
      </Button>
      {disabled && (
        <p className="text-sm text-muted-foreground">
          This revision matches the current draft.
        </p>
      )}
      {state.status === 'error' && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
          {state.signInRequired && (
            <>
              {' '}
              <a
                href={routes.admin.login}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4"
              >
                Sign in in a new tab
              </a>
            </>
          )}
        </p>
      )}
    </form>
  )
}

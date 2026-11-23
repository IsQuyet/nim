'use client'

import { useActionState } from 'react'
import type { RestoreFormState } from '../history'

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
      <button
        type="submit"
        disabled={disabled || pending}
        aria-busy={pending}
        className="rounded-full bg-secondary px-3 py-1.5 text-sm text-secondary-foreground transition-colors hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Restoring…' : 'Restore draft'}
      </button>
      {disabled && (
        <p className="text-sm text-muted-foreground">
          This revision matches the current draft.
        </p>
      )}
      {state.status === 'error' && (
        <p role="alert" className="text-sm text-muted-foreground">
          {state.message}
          {state.signInRequired && (
            <>
              {' '}
              <a
                href="/admin/login"
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

'use client'

import { useActionState } from 'react'
import type { RestoreFormState } from '@/lib/content'

type RestoreFormProps = {
  action: (state: RestoreFormState) => Promise<RestoreFormState>
  disabled: boolean
}

export function RestoreForm({ action, disabled }: RestoreFormProps) {
  const [state, formAction, pending] = useActionState(action, { status: 'idle' })

  return (
    <form action={formAction} aria-label="Restore revision" className="space-y-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Restore this snapshot into the draft without changing the published version.
      </p>
      <button
        type="submit"
        disabled={disabled || pending}
        aria-busy={pending}
        className="rounded-full bg-zinc-100 px-3 py-1.5 text-sm text-black transition-colors hover:bg-zinc-950 hover:text-zinc-50 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
      >
        {pending ? 'Restoring…' : 'Restore draft'}
      </button>
      {disabled && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          This revision matches the current draft.
        </p>
      )}
      {state.status === 'error' && (
        <p role="alert" className="text-sm text-zinc-600 dark:text-zinc-400">
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

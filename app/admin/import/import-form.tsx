'use client'

import { startTransition, useActionState, useId, useRef, useState, type FormEvent } from 'react'
import { unstable_rethrow } from 'next/navigation'
import { MAX_MARKDOWN_UPLOAD_BYTES } from '@/lib/post-file-policy'
import type { PostFileFormState } from '@/lib/post-files'

type ImportFormProps = {
  newPostId: string
  action: (state: PostFileFormState, input: FormData) => Promise<PostFileFormState>
}

export function ImportForm({ newPostId, action }: ImportFormProps) {
  const prefix = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const [sessionNewPostId] = useState(newPostId)
  const [state, submitAction, pending] = useActionState<PostFileFormState, FormData>(async (previous, input) => {
    try {
      return await action(previous, input)
    } catch (error) {
      unstable_rethrow(error)
      return {
        status: 'error',
        message: 'Could not confirm the import. Your file selection is preserved. Check your drafts before retrying.',
      }
    }
  }, { status: 'idle' })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const input = new FormData()
    for (const file of fileInput.current?.files ?? []) input.append('file', file)
    input.set('newPostId', sessionNewPostId)
    startTransition(() => submitAction(input))
  }

  return (
    <form aria-label="Import Markdown" method="post" encType="multipart/form-data" onSubmit={handleSubmit} className="space-y-4">
      <fieldset disabled={pending} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor={`${prefix}-file`} className="text-sm font-medium">Markdown file</label>
          <input
            ref={fileInput}
            id={`${prefix}-file`}
            name="file"
            type="file"
            accept=".md,text/markdown"
            required
            aria-describedby={`${prefix}-file-hint`}
            className="block w-full rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-sm text-zinc-900 outline-offset-4 focus-visible:outline-2 dark:border-zinc-800 dark:text-zinc-100"
          />
          <p id={`${prefix}-file-hint`} className="text-sm text-zinc-500 dark:text-zinc-400">
            UTF-8 Markdown, up to {MAX_MARKDOWN_UPLOAD_BYTES / 1024 / 1024} MiB.
          </p>
        </div>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="rounded-full bg-zinc-100 px-3 py-1.5 text-sm text-black transition-colors hover:bg-zinc-950 hover:text-zinc-50 disabled:cursor-wait disabled:opacity-60 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
        >
          {pending ? 'Importing…' : 'Import draft'}
        </button>
      </fieldset>
      {state.status === 'error' && (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-zinc-600 dark:text-zinc-400">{state.message}</p>
          {state.signInRequired && (
            <a
              href="/admin/login"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm underline underline-offset-4"
            >
              Sign in in a new tab
            </a>
          )}
          {state.reviewPostId && (
            <div className="flex flex-wrap gap-4 text-sm">
              <a
                href={`/admin/posts/${state.reviewPostId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4"
              >
                Check saved draft in a new tab
              </a>
              <a href="/admin/import" className="underline underline-offset-4">Start new import</a>
            </div>
          )}
        </div>
      )}
    </form>
  )
}

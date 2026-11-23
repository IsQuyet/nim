'use client'

import { startTransition, useActionState, useId, useRef, useState, type FormEvent } from 'react'
import { unstable_rethrow } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/field'
import { MAX_MARKDOWN_UPLOAD_BYTES, type PostFileFormState } from '../files'
import { routes } from '@/lib/routes'

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
          <Label htmlFor={`${prefix}-file`}>Markdown file</Label>
          <Input
            ref={fileInput}
            id={`${prefix}-file`}
            name="file"
            type="file"
            accept=".md,text/markdown"
            required
            aria-describedby={`${prefix}-file-hint`}
            className="block text-sm"
          />
          <p id={`${prefix}-file-hint`} className="text-sm text-muted-foreground">
            UTF-8 Markdown, up to {MAX_MARKDOWN_UPLOAD_BYTES / 1024 / 1024} MiB.
          </p>
        </div>
        <Button type="submit" disabled={pending} aria-busy={pending}>
          {pending ? 'Importing…' : 'Import draft'}
        </Button>
      </fieldset>
      {state.status === 'error' && (
        <div className="space-y-3">
          <p role="alert" className="text-sm text-destructive">{state.message}</p>
          {state.signInRequired && (
            <a
              href={routes.admin.login}
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
                href={routes.admin.post(state.reviewPostId)}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4"
              >
                Check saved draft in a new tab
              </a>
              <a href={routes.admin.import} className="underline underline-offset-4">Start new import</a>
            </div>
          )}
        </div>
      )}
    </form>
  )
}

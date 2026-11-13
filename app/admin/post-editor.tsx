'use client'

import {
  startTransition,
  useActionState,
  useId,
  useState,
  type FormEvent,
} from 'react'
import { MarkdownContent } from '@/components/markdown-content'
import { MarkdownProse } from '@/components/markdown-prose'
import type { PostContent } from '@/lib/posts'
import { cn } from '@/lib/utils'
import type { DraftFormState } from './actions'

type PostEditorProps = {
  initialContent: PostContent
  action: (state: DraftFormState, input: PostContent) => Promise<DraftFormState>
}

const FIELD_CLASS_NAME =
  'w-full rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-zinc-900 outline-offset-4 focus-visible:outline-2 dark:border-zinc-800 dark:text-zinc-100'

export function PostEditor({ initialContent, action }: PostEditorProps) {
  const prefix = useId()
  const [title, setTitle] = useState(initialContent.title)
  const [description, setDescription] = useState(initialContent.description)
  const [body, setBody] = useState(initialContent.body)
  const [preview, setPreview] = useState(false)
  const [state, submitAction, pending] = useActionState<
    DraftFormState,
    PostContent
  >(action, { status: 'idle' })
  const savedContent = state.status === 'saved' ? state.content : initialContent
  const hasChanges =
    title !== savedContent.title ||
    description !== savedContent.description ||
    body !== savedContent.body

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    startTransition(() => submitAction({ title, description, body }))
  }

  return (
    <form
      aria-label="Draft"
      method="post"
      onSubmit={handleSubmit}
      className="space-y-4"
    >
      <fieldset disabled={pending} className="space-y-6">
        <div className="space-y-2">
          <label htmlFor={`${prefix}-title`} className="text-sm font-medium">
            Title
          </label>
          <input
            id={`${prefix}-title`}
            name="title"
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={FIELD_CLASS_NAME}
          />
        </div>
        <div className="space-y-2">
          <label
            htmlFor={`${prefix}-description`}
            className="text-sm font-medium"
          >
            Description
          </label>
          <textarea
            id={`${prefix}-description`}
            name="description"
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className={FIELD_CLASS_NAME}
          />
        </div>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label htmlFor={`${prefix}-body`} className="text-sm font-medium">
              Body
            </label>
            <div role="group" aria-label="Body view" className="flex gap-2">
              {[
                { label: 'Edit', value: false },
                { label: 'Preview', value: true },
              ].map((view) => (
                <button
                  key={view.label}
                  type="button"
                  aria-pressed={preview === view.value}
                  onClick={() => setPreview(view.value)}
                  className={cn(
                    'rounded-full px-3 py-1 text-sm transition-colors',
                    preview === view.value
                      ? 'bg-zinc-100 text-zinc-950 dark:bg-zinc-800 dark:text-zinc-100'
                      : 'text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100',
                  )}
                >
                  {view.label}
                </button>
              ))}
            </div>
          </div>
          <textarea
            id={`${prefix}-body`}
            name="body"
            rows={18}
            hidden={preview}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            className={cn(
              FIELD_CLASS_NAME,
              'min-h-80 resize-y font-mono text-sm leading-6',
            )}
          />
          {preview && (
            <section aria-label="Markdown preview">
              <MarkdownProse className="min-h-80 max-w-none rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
                {body ? (
                  <MarkdownContent source={body} />
                ) : (
                  <p>Nothing to preview yet.</p>
                )}
              </MarkdownProse>
            </section>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            className="rounded-full bg-zinc-100 px-3 py-1.5 text-sm text-black transition-colors hover:bg-zinc-950 hover:text-zinc-50 disabled:cursor-wait disabled:opacity-60 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          >
            {pending ? 'Saving…' : 'Save draft'}
          </button>
          {hasChanges && !pending && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Unsaved changes.
            </p>
          )}
        </div>
      </fieldset>
      {state.status === 'error' && (
        <p role="alert" className="text-sm text-zinc-600 dark:text-zinc-400">
          {state.message}
        </p>
      )}
      {state.status === 'saved' && !hasChanges && (
        <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
          Draft saved.
        </p>
      )}
    </form>
  )
}

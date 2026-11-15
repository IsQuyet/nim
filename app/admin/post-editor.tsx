'use client'

import { useEffect, useId, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { MarkdownPreviewLoader } from '@/components/markdown-preview-loader'
import { MarkdownProse } from '@/components/markdown-prose'
import { samePostContent, type PostContent } from '@/lib/content'
import type { WorkingCopy, WritingTransport } from '@/lib/writing'
import { cn } from '@/lib/utils'
import { readWorkingCopyAction, writeWorkingCopyAction } from './writing-actions'
import { useWritingSession } from './use-writing-session'
import { useWritingLeaveGuard } from './use-writing-leave-guard'

export type PostEditorProps = {
  postId: string
  initial: WorkingCopy | null
  isNew?: boolean
  transport?: WritingTransport
}

const transport: WritingTransport = { read: readWorkingCopyAction, write: writeWorkingCopyAction }
const FIELD_CLASS_NAME =
  'w-full rounded-lg border border-zinc-200 bg-transparent px-3 py-2 text-zinc-900 outline-offset-4 focus-visible:outline-2 dark:border-zinc-800 dark:text-zinc-100'
const BUTTON_CLASS_NAME =
  'rounded-full bg-zinc-100 px-3 py-1.5 text-sm text-black transition-colors hover:bg-zinc-950 hover:text-zinc-50 disabled:cursor-wait disabled:opacity-60 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700'

export function PostEditor({ postId, initial, isNew = false, transport: connection = transport }: PostEditorProps) {
  const prefix = useId()
  const router = useRouter()
  const [preview, setPreview] = useState(false)
  const { session, snapshot } = useWritingSession({ postId, initial, isNew, transport: connection })
  const { content, remote, candidates, feedback, lastConfirmed } = snapshot
  useWritingLeaveGuard(snapshot.shouldWarn)

  useEffect(() => {
    const retry = () => { void session.retry() }
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [session])

  useEffect(() => {
    const pathname = snapshot.isNew ? `/admin/posts/new?draft=${snapshot.postId}` : `/admin/posts/${snapshot.postId}`
    if (`${location.pathname}${location.search}` !== pathname) {
      router.replace(pathname, { scroll: false })
    }
  }, [router, snapshot.isNew, snapshot.postId])

  function edit(field: keyof PostContent, value: string) {
    session.edit({ ...content, [field]: value })
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const submitter = event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : null
    session.submit(submitter instanceof HTMLButtonElement && submitter.value === 'publish' ? 'publish' : 'save')
  }

  const blocked = snapshot.manualBusy || snapshot.recoveryRequired || snapshot.syncStatus === 'conflict'
    || snapshot.syncStatus === 'missing' || snapshot.syncStatus === 'interrupted'
  const confirmedCurrent = lastConfirmed && samePostContent(content, lastConfirmed.content)
  const errorMessage = feedback && (feedback.status === 'error' || feedback.status === 'invalid') ? feedback.message : null
  const syncLabel = {
    idle: 'Ready to write.',
    checking: 'Checking server draft…',
    recovery: 'Choose how to continue with your local copies.',
    dirty: 'Only on this browser. Not synced yet.',
    syncing: 'Syncing to server…',
    synced: 'Synced to server.',
    error: 'Server sync is not confirmed. Your input is preserved.',
    invalid: 'This operation needs your attention.',
    conflict: 'The server draft changed. Both copies are preserved.',
    missing: 'The server draft is no longer available. Your local copy is preserved.',
    interrupted: 'Navigation interrupted this operation.',
    disposed: 'Writing session closed.',
  }[snapshot.syncStatus]

  return (
    <form aria-label="Draft" method="post" onSubmit={handleSubmit} className="space-y-6">
      {snapshot.recoveryRequired && (
        <section aria-label="Local recovery copies" className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="font-medium">Local recovery copies</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">These copies belong to separate writing sessions on this browser. Recovering keeps the original copy and checks the server before syncing.</p>
          <ul className="space-y-4">
            {candidates.map(copy => (
              <li key={copy.sessionId} className="space-y-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                <p>{copy.content.title || 'Untitled draft'}</p>
                <p className="text-xs break-all text-zinc-500">{copy.postId} · <time dateTime={copy.updatedAt}>{copy.updatedAt}</time></p>
                <details>
                  <summary className="cursor-pointer text-sm">Review local text</summary>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">{copy.content.body}</pre>
                </details>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={BUTTON_CLASS_NAME} onClick={() => { void session.recover(copy) }}>Recover this copy</button>
                  <button type="button" className="px-3 py-1.5 text-sm underline underline-offset-4" onClick={() => {
                    if (window.confirm('Delete this local recovery copy? This does not delete the server draft.')) void session.discardRecovery(copy.sessionId)
                  }}>Delete local copy</button>
                </div>
              </li>
            ))}
          </ul>
          <button type="button" className={BUTTON_CLASS_NAME} onClick={() => { void session.skipRecovery() }}>Continue without restoring</button>
        </section>
      )}

      {(snapshot.syncStatus === 'conflict' || snapshot.syncStatus === 'missing') && (
        <section aria-label="Draft conflict" className="space-y-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="font-medium">The server draft changed</h2>
          <p className="text-sm">Your text has not been replaced. Review the server copy or continue your local text as a separate draft.</p>
          {snapshot.conflict?.current && (
            <details>
              <summary className="cursor-pointer text-sm">Review server text</summary>
              <p className="mt-2">{snapshot.conflict.current.title || 'Untitled draft'}</p>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{snapshot.conflict.current.body}</pre>
            </details>
          )}
          <div className="flex flex-wrap gap-2">
            {snapshot.conflict?.current && <button type="button" className={BUTTON_CLASS_NAME} onClick={() => { void session.useServer() }}>Use server draft</button>}
            <button type="button" className={BUTTON_CLASS_NAME} onClick={() => { void session.forkLocal() }}>Keep local text as a new draft</button>
            <a href={`/admin/posts/${snapshot.postId}`} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 text-sm underline underline-offset-4">Review server draft in a new tab</a>
          </div>
        </section>
      )}

      <div className="space-y-2">
        <label htmlFor={`${prefix}-title`} className="text-sm font-medium">Title</label>
        <input id={`${prefix}-title`} name="title" value={content.title} onChange={event => edit('title', event.target.value)} className={FIELD_CLASS_NAME} />
      </div>
      <div className="space-y-2">
        <label htmlFor={`${prefix}-description`} className="text-sm font-medium">Description</label>
        <textarea id={`${prefix}-description`} name="description" rows={2} value={content.description} onChange={event => edit('description', event.target.value)} className={FIELD_CLASS_NAME} />
      </div>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label htmlFor={`${prefix}-body`} className="text-sm font-medium">Body</label>
          <div role="group" aria-label="Body view" className="flex gap-2">
            {[{ label: 'Edit', value: false }, { label: 'Preview', value: true }].map(view => (
              <button key={view.label} type="button" aria-pressed={preview === view.value} onClick={() => setPreview(view.value)} className={cn(
                'rounded-full px-3 py-1 text-sm transition-colors',
                preview === view.value ? 'bg-zinc-100 text-zinc-950 dark:bg-zinc-800 dark:text-zinc-100' : 'text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100',
              )}>{view.label}</button>
            ))}
          </div>
        </div>
        <textarea id={`${prefix}-body`} name="body" rows={18} hidden={preview} value={content.body} onChange={event => edit('body', event.target.value)} className={cn(FIELD_CLASS_NAME, 'min-h-80 resize-y font-mono text-sm leading-6')} />
        {preview && <section aria-label="Markdown preview"><MarkdownProse className="min-h-80 max-w-none rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">{content.body ? <MarkdownPreviewLoader source={content.body} /> : <p>Nothing to preview yet.</p>}</MarkdownProse></section>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" name="intent" value="save" disabled={blocked} aria-busy={snapshot.manualBusy} className={BUTTON_CLASS_NAME}>{snapshot.manualBusy ? 'Saving…' : 'Save draft'}</button>
        <button type="submit" name="intent" value="publish" disabled={blocked} aria-busy={snapshot.manualBusy} className={BUTTON_CLASS_NAME}>Publish</button>
        {(snapshot.syncStatus === 'error' || snapshot.syncStatus === 'invalid' || snapshot.localStatus === 'failed') && <button type="button" className="px-3 py-1.5 text-sm underline underline-offset-4" onClick={() => { void session.retry() }}>Retry sync</button>}
      </div>
      <div aria-label="Saving status" aria-live="polite" className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
        <p>{snapshot.localStatus === 'saved' ? 'Recovery copy saved on this browser.' : snapshot.localStatus === 'saving' ? 'Saving recovery copy on this browser…' : snapshot.localStatus === 'failed' ? 'Local recovery is unavailable. Keep this page open or save to the server.' : 'No local changes yet.'}</p>
        <p>{syncLabel}</p>
        {confirmedCurrent && lastConfirmed.intent !== 'autosave' && <p role="status">{lastConfirmed.intent === 'publish' ? 'Post published.' : 'Draft saved.'}</p>}
      </div>
      {(errorMessage || snapshot.localError) && <p role="alert" className="text-sm text-zinc-600 dark:text-zinc-400">{errorMessage}{errorMessage && snapshot.localError ? ' ' : ''}{snapshot.localError}</p>}
      {snapshot.signInRequired && <a href="/admin/login" target="_blank" rel="noopener noreferrer" className="text-sm underline underline-offset-4">Sign in in a new tab</a>}
      {remote && <nav aria-label="Draft tools" className="flex flex-wrap gap-4 text-sm text-zinc-500 dark:text-zinc-400">
        {remote.checkpointRevisionId !== null && <a href={`/admin/posts/${snapshot.postId}/history`} className="underline underline-offset-4">Revision history</a>}
        <a href={`/admin/posts/${snapshot.postId}/export`} download className="underline underline-offset-4">Download server draft</a>
      </nav>}
    </form>
  )
}

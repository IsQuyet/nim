'use client'

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { Route } from 'next'
import { useRouter } from 'next/navigation'
import { Columns2Icon, DownloadIcon, HistoryIcon } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { MarkdownComparison } from './version-comparison'
import { MarkdownEditor, type MarkdownEditorHandle } from '@/modules/markdown/ui/editor'
import { MarkdownImageUpload } from '@/modules/media/ui/image-upload'
import { samePostContent, type DraftPost, type PostContent, type PublishedPost } from '../model'
import { publishedPostReadSchema } from '../comparison'
import type { WritingTransport } from '../writing'
import { readPublishedPostAction } from '../server/actions/comparison'
import { inspectDraftOperationAction, readDraftAction, writeDraftAction } from '../server/actions/writing'
import { useWritingSession } from './use-writing-session'
import { useWritingLeaveGuard } from './use-writing-leave-guard'
import { useSettled } from '@/hooks/useSettled'
import { Panes } from '@/components/layout/panes'
import { Button } from '@/components/ui/button'
import { Input, Label, Textarea } from '@/components/ui/field'
import { routes } from '@/lib/routes'

export type PostEditorProps = {
  postId: string
  initial: DraftPost | null
  transport?: WritingTransport
}

const transport: WritingTransport = { read: readDraftAction, write: writeDraftAction, inspect: inspectDraftOperationAction }
const LINK_BUTTON = { variant: 'link', size: 'text' } as const
const QUIET_BUTTON = { variant: 'quiet', size: 'text' } as const

// 对照要解析并高亮整篇正文。打开时显示当时的输入，之后连续输入期间不逐次重算，停顿后再更新。
const COMPARISON_SETTLE_MS = 200

function EditorComparison({ published, content, baseline, action }: {
  published: PublishedPost | null
  content: PostContent
  baseline: DraftPost | null
  action: ReactNode
}) {
  const settled = useSettled(content, COMPARISON_SETTLE_MS)
  return (
    <MarkdownComparison
      published={published}
      action={action}
      compared={{
        label: 'Current editor text',
        revisionId: null,
        detail: baseline ? `Draft baseline revision ${baseline.revisionId}` : 'Not saved to the server',
        ...settled,
      }}
    />
  )
}

export function PostEditor({ postId, initial, transport: connection = transport }: PostEditorProps) {
  const prefix = useId()
  const router = useRouter()
  const markdownEditorRef = useRef<MarkdownEditorHandle>(null)
  const comparisonRef = useRef<HTMLDivElement>(null)
  const [comparison, setComparison] = useState<PublishedPost | null>(null)
  const [comparisonOpen, setComparisonOpen] = useState(false)
  const [comparisonLoads, setComparisonLoads] = useState(0)
  const [comparisonBusy, setComparisonBusy] = useState(false)
  const [comparisonFeedback, setComparisonFeedback] = useState<ReturnType<typeof publishedPostReadSchema.parse> | null>(null)
  const { session, snapshot } = useWritingSession({ postId, initial, transport: connection })
  const { content, remote, candidates, feedback, lastConfirmed, pending } = snapshot
  // 被拦下的链接可以指向任何地址，这里按原地址继续导航。
  const navigate = useCallback((href: string) => router.push(href as Route, { scroll: false }), [router])
  const { pendingNavigation, cancelNavigation, confirmNavigation, leaveDescription } = useWritingLeaveGuard(snapshot.shouldWarn, navigate)

  useEffect(() => {
    const check = () => { void session.checkServer() }
    window.addEventListener('online', check)
    return () => window.removeEventListener('online', check)
  }, [session])

  useEffect(() => {
    const pathname = snapshot.isNew ? routes.admin.newDraft(snapshot.postId) : routes.admin.post(snapshot.postId)
    if (`${location.pathname}${location.search}` !== pathname) router.replace(pathname, { scroll: false })
  }, [router, snapshot.isNew, snapshot.postId])

  // 对照排在编辑区之后。每次读取完成后把它带进视口。
  useEffect(() => {
    if (comparisonLoads > 0) comparisonRef.current?.scrollIntoView()
  }, [comparisonLoads])

  function edit(field: keyof PostContent, value: string) {
    session.edit({ ...content, [field]: value })
  }

  async function refreshComparison() {
    setComparisonBusy(true)
    setComparisonFeedback(null)
    try {
      const result = publishedPostReadSchema.parse(await readPublishedPostAction(postId))
      setComparisonFeedback(result)
      if (result.status === 'success') {
        setComparison(result.value)
        setComparisonOpen(true)
        setComparisonLoads(count => count + 1)
      }
    } catch {
      setComparisonFeedback({ status: 'error', message: 'Could not load the published version.' })
    } finally {
      setComparisonBusy(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const submitter = event.nativeEvent instanceof SubmitEvent ? event.nativeEvent.submitter : null
    session.submit(submitter instanceof HTMLButtonElement && submitter.value === 'publish' ? 'publish' : 'save')
  }

  const decisionBlocked = snapshot.manualBusy || snapshot.recoveryRequired || snapshot.serverStatus === 'conflict'
    || snapshot.serverStatus === 'missing' || snapshot.serverStatus === 'interrupted'
  const blocked = decisionBlocked || pending !== null
  const confirmedCurrent = lastConfirmed && samePostContent(content, lastConfirmed.content)
  const errorMessage = feedback && (feedback.status === 'error' || feedback.status === 'invalid') ? feedback.message : null
  const serverLabel = {
    idle: 'Ready to write.',
    checking: pending ? 'Checking the previous operation…' : 'Checking server draft…',
    unsaved: 'Unsaved changes. Not saved to the server.',
    saving: pending?.intent === 'publish' ? 'Publishing…' : 'Saving draft…',
    saved: 'No unsaved changes.',
    unconfirmed: 'The previous operation is not confirmed. Your input is preserved.',
    error: pending ? 'Could not confirm the previous operation. Your input is preserved.' : 'Could not check the server draft. Your input is preserved.',
    invalid: 'This operation needs your attention.',
    conflict: 'The server draft changed. Both copies are preserved.',
    missing: 'The server draft is no longer available. Your local copy is preserved.',
    interrupted: 'Navigation interrupted this operation.',
    disposed: 'Writing session closed.',
  }[snapshot.serverStatus]

  return (
    <>
      <form aria-label="Draft" method="post" onSubmit={handleSubmit}>
        <Panes
          split="workspace"
          side={
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" name="intent" value="save" disabled={blocked} aria-busy={snapshot.manualBusy}>Save draft</Button>
                <Button type="submit" variant="default" name="intent" value="publish" disabled={blocked} aria-busy={snapshot.manualBusy}>Publish</Button>
              </div>
              <div className="space-y-3">
                <div aria-label="Saving status" aria-live="polite" className="space-y-1 text-sm text-muted-foreground">
                  <p>{snapshot.localStatus === 'saved' ? 'Recovery copy saved on this browser.' : snapshot.localStatus === 'saving' ? 'Saving recovery copy on this browser…' : snapshot.localStatus === 'failed' ? 'Local recovery is unavailable. Keep this page open or explicitly save to the server.' : 'No local changes yet.'}</p>
                  <p>{serverLabel}</p>
                  {confirmedCurrent && <p role="status">{lastConfirmed.via === 'receipt'
                    ? lastConfirmed.intent === 'publish' ? 'Previous publish confirmed.' : 'Previous save confirmed.'
                    : lastConfirmed.intent === 'publish' ? 'Post published.' : 'Draft saved.'}</p>}
                </div>
                {(errorMessage || snapshot.localError) && <p role="alert" className="text-sm text-destructive">{errorMessage}{errorMessage && snapshot.localError ? ' ' : ''}{snapshot.localError}</p>}
                {snapshot.signInRequired && <a href={routes.admin.login} target="_blank" rel="noopener noreferrer" className="block w-fit text-sm underline underline-offset-4">Sign in in a new tab</a>}
                {snapshot.serverStatus === 'error' && !pending && <Button type="button" {...LINK_BUTTON} className="flex" onClick={() => { void session.checkServer() }}>Check server draft</Button>}
                {snapshot.localStatus === 'failed' && <Button type="button" {...LINK_BUTTON} className="flex" onClick={() => { void session.retryLocal() }}>Retry local recovery</Button>}
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-3 border-t pt-6 md:flex-col md:items-start">
                <Button type="button" {...QUIET_BUTTON} disabled={comparisonBusy} onClick={() => { void refreshComparison() }}>
                  <Columns2Icon />
                  {comparisonBusy ? 'Loading published version…' : comparisonOpen ? 'Refresh comparison' : 'Compare with published'}
                </Button>
                {comparisonFeedback?.status === 'error' && (
                  <div role="alert" className="w-full space-y-2 text-sm text-destructive">
                    <p>{comparisonFeedback.message}</p>
                    {comparisonFeedback.signInRequired && <a href={routes.admin.login} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Sign in in a new tab</a>}
                  </div>
                )}
                {remote && (
                  <nav aria-label="Draft tools" className="flex flex-wrap gap-x-6 gap-y-3 md:flex-col md:items-start">
                    <Button asChild {...QUIET_BUTTON}>
                      <a href={routes.admin.postHistory(snapshot.postId)}><HistoryIcon />Revision history</a>
                    </Button>
                    <Button asChild {...QUIET_BUTTON}>
                      <a href={routes.admin.postExport(snapshot.postId)} download><DownloadIcon />Download saved draft</a>
                    </Button>
                  </nav>
                )}
              </div>
            </div>
          }
          wide={comparisonOpen && comparisonFeedback?.status === 'success' && (
            <div ref={comparisonRef} className="scroll-mt-(--anchor-top) border-t pt-10">
              <EditorComparison
                published={comparison}
                content={content}
                baseline={remote}
                action={<Button type="button" {...LINK_BUTTON} onClick={() => setComparisonOpen(false)}>Close comparison</Button>}
              />
            </div>
          )}
        >
          <div className="space-y-6">
            {snapshot.recoveryRequired && (
              <section aria-label="Local recovery copies" className="space-y-4 rounded-lg border border-border p-4">
                <h2 className="font-medium">Local recovery copies</h2>
                <p className="text-sm text-muted-foreground">These copies belong to separate writing sessions on this browser. Recovered text remains unsubmitted until you choose Save draft or Publish.</p>
                <ul className="space-y-4">
                  {candidates.map(copy => (
                    <li key={copy.sessionId} className="space-y-2 border-t border-border pt-3">
                      <p>{copy.content.title || 'Untitled draft'}</p>
                      <p className="text-xs break-all text-muted-foreground">{copy.postId} · <time dateTime={copy.updatedAt}>{copy.updatedAt}</time></p>
                      <details>
                        <summary className="cursor-pointer text-sm">Review local text</summary>
                        <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs">{copy.content.body}</pre>
                      </details>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" onClick={() => { void session.recover(copy) }}>Recover this copy</Button>
                        <Button type="button" {...LINK_BUTTON} onClick={() => {
                          if (window.confirm('Delete this local recovery copy? This does not delete the server draft.')) void session.discardRecovery(copy.sessionId)
                        }}>Delete local copy</Button>
                      </div>
                    </li>
                  ))}
                </ul>
                <Button type="button" onClick={() => { void session.skipRecovery() }}>Continue without restoring</Button>
              </section>
            )}

            {(snapshot.serverStatus === 'conflict' || snapshot.serverStatus === 'missing') && (
              <section aria-label="Draft conflict" className="space-y-3 rounded-lg border border-border p-4">
                <h2 className="font-medium">The server draft changed</h2>
                <p className="text-sm">Your text has not been replaced. Review the server copy or keep your local text as a separate unsaved draft.</p>
                {snapshot.conflict?.current && (
                  <details>
                    <summary className="cursor-pointer text-sm">Review server text</summary>
                    <p className="mt-2">{snapshot.conflict.current.title}</p>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{snapshot.conflict.current.body}</pre>
                  </details>
                )}
                <div className="flex flex-wrap gap-2">
                  {snapshot.conflict?.current && <Button type="button" onClick={() => { void session.useServer() }}>Use server draft</Button>}
                  <Button type="button" onClick={() => { void session.forkLocal() }}>Keep local text as a new draft</Button>
                  <a href={routes.admin.post(snapshot.postId)} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 text-sm underline underline-offset-4">Review server draft in a new tab</a>
                </div>
              </section>
            )}

            {pending && !snapshot.manualBusy && (
              <section aria-label="Unconfirmed operation" className="space-y-3 rounded-lg border border-border p-4">
                <h2 className="font-medium">Previous {pending.intent === 'publish' ? 'publish' : 'save'} not confirmed</h2>
                <p className="text-sm">Checking reads the result without submitting again. Retrying submits the same snapshot shown below, not your newer edits.</p>
                <details>
                  <summary className="cursor-pointer text-sm">Review previously submitted text</summary>
                  <p className="mt-2">{pending.content.title}</p>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs">{pending.content.body}</pre>
                </details>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => { void session.checkServer() }}>Check previous operation</Button>
                  <Button type="button" disabled={decisionBlocked} onClick={() => { void session.retryPending() }}>Retry previous {pending.intent === 'publish' ? 'publish' : 'save'}</Button>
                </div>
              </section>
            )}

            <div className="space-y-2">
              <Label htmlFor={`${prefix}-title`}>Title</Label>
              <Input id={`${prefix}-title`} name="title" value={content.title} onChange={event => edit('title', event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${prefix}-description`}>Description</Label>
              <Textarea id={`${prefix}-description`} name="description" rows={2} value={content.description} onChange={event => edit('description', event.target.value)} />
            </div>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label id={`${prefix}-body-label`} htmlFor={`${prefix}-body`}>Body</Label>
                <MarkdownEditor
                  key={`editor:${snapshot.postId}`}
                  ref={markdownEditorRef}
                  id={`${prefix}-body`}
                  labelId={`${prefix}-body-label`}
                  value={content.body}
                  onChange={value => edit('body', value)}
                />
              </div>
              <MarkdownImageUpload
                key={`upload:${snapshot.postId}`}
                prepareInsertion={() => markdownEditorRef.current?.prepareImageInsertion() ?? null}
              />
            </div>
          </div>
        </Panes>
      </form>
      <AlertDialog
        open={pendingNavigation !== null}
        onOpenChange={open => { if (!open) cancelNavigation() }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave this page?</AlertDialogTitle>
            <AlertDialogDescription>
              {leaveDescription} Leaving will not retry an unconfirmed save or publish.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              Stay on page
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmNavigation}>
              Leave page
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

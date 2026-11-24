'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CopyIcon, Trash2Icon } from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import { TextMorph } from '@/components/ui/text-morph'
import { routes } from '@/lib/routes'
import { formatMarkdownImage } from '@/modules/media/model'
import type { AdminMediaItem, DeleteMediaFeedback } from '../media'
import { deleteMediaAssetAction } from '../server/actions/media'

const dateFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeZone: 'UTC',
})

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(2)} MB`
}

function CopyMarkdownButton({ id, originalName }: { id: string; originalName: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timeout = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timeout)
  }, [copied])

  return (
    <Button
      type="button"
      variant="quiet"
      size="text"
      onClick={async () => {
        await navigator.clipboard.writeText(formatMarkdownImage(id, originalName))
        setCopied(true)
      }}
    >
      <CopyIcon />
      <TextMorph>{copied ? 'Copied Markdown' : 'Copy Markdown'}</TextMorph>
    </Button>
  )
}

export function MediaLibrary({ items }: { items: AdminMediaItem[] }) {
  const router = useRouter()
  const [pendingDelete, setPendingDelete] = useState<AdminMediaItem | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ id: string; result: Exclude<DeleteMediaFeedback, { status: 'success' }> } | null>(null)

  async function confirmDelete() {
    if (!pendingDelete || deletingId) return
    const target = pendingDelete
    setPendingDelete(null)
    setDeletingId(target.asset.id)
    setFeedback(null)
    try {
      const result = await deleteMediaAssetAction(target.asset.id)
      if (result.status === 'success') {
        router.refresh()
      } else {
        setFeedback({ id: target.asset.id, result })
      }
    } catch {
      setFeedback({
        id: target.asset.id,
        result: { status: 'error', message: 'Could not delete the media file. Please try again.' },
      })
    } finally {
      setDeletingId(null)
    }
  }

  if (items.length === 0) {
    return <p className="text-muted-foreground">No media uploaded yet.</p>
  }

  return (
    <>
      <ul aria-label="Media assets" className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3">
        {items.map(item => {
          const { asset, references } = item
          const isDeleting = deletingId === asset.id
          const itemFeedback = feedback?.id === asset.id ? feedback.result : null

          return (
            <li key={asset.id} className="flex min-w-0 flex-col gap-4 rounded-lg border border-border p-4">
              <div className="flex aspect-video items-center justify-center overflow-hidden rounded-md bg-muted">
                {asset.state === 'ready' ? (
                  // 私有媒体鉴权依赖浏览器 Cookie，不能走服务端图片代理。
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={routes.media(asset.id)}
                    alt={asset.originalName}
                    width={asset.width}
                    height={asset.height}
                    loading="lazy"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">Pending upload</span>
                )}
              </div>

              <div className="min-w-0 space-y-1">
                <h2 className="truncate font-medium" title={asset.originalName}>{asset.originalName}</h2>
                <p className="text-xs text-muted-foreground">
                  {asset.width}×{asset.height} · {formatBytes(asset.byteSize)} · {asset.state === 'ready' ? 'Ready' : 'Pending'}
                </p>
                <p className="text-xs text-muted-foreground">
                  Uploaded <time dateTime={asset.createdAt}>{dateFormatter.format(new Date(asset.createdAt))}</time>
                </p>
              </div>

              <div className="space-y-1.5 border-t pt-3 text-sm">
                <p className="text-xs font-medium text-muted-foreground">References</p>
                {references.length > 0 ? (
                  <ul aria-label={`References for ${asset.originalName}`} className="space-y-1.5">
                    {references.map(ref => (
                      <li key={ref.postId} className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                        <Link
                          href={routes.admin.post(ref.postId)}
                          className="min-w-0 truncate underline underline-offset-4 transition-colors hover:text-muted-foreground"
                        >
                          {ref.title}
                        </Link>
                        <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                          {ref.inDraft && <span>Draft</span>}
                          {ref.inPublished ? (
                            <Link
                              href={routes.post(ref.postId)}
                              className="text-foreground underline underline-offset-4 transition-colors hover:text-muted-foreground"
                            >
                              Published
                            </Link>
                          ) : ref.publicationCount > 0 ? (
                            <span>History ({ref.publicationCount})</span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">Not referenced</p>
                )}
              </div>

              <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                {asset.state === 'ready' ? (
                  <CopyMarkdownButton id={asset.id} originalName={asset.originalName} />
                ) : (
                  <span className="text-xs text-muted-foreground">Unavailable until ready</span>
                )}
                {references.length === 0 && (
                  <Button
                    type="button"
                    variant="quiet"
                    size="text"
                    disabled={isDeleting}
                    aria-busy={isDeleting}
                    onClick={() => setPendingDelete(item)}
                  >
                    <Trash2Icon />
                    {isDeleting ? 'Deleting…' : 'Delete'}
                  </Button>
                )}
              </div>

              {itemFeedback && (
                <div role="alert" className="space-y-1 text-xs text-destructive">
                  <p>{itemFeedback.message}</p>
                  {itemFeedback.signInRequired && (
                    <a href={routes.admin.login} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                      Sign in in a new tab
                    </a>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <AlertDialog open={pendingDelete !== null} onOpenChange={open => { if (!open) setPendingDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this image?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete ? `"${pendingDelete.asset.originalName}" will be permanently deleted from the server.` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void confirmDelete() }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

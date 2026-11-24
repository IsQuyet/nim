'use client'

import { useState, type ChangeEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Trash2Icon, UploadIcon } from 'lucide-react'
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
import { Input, Label, Textarea } from '@/components/ui/field'
import { routes } from '@/lib/routes'
import { mediaImageFormats, type MediaAsset } from '@/modules/media/model'
import { uploadMediaFile } from '@/modules/media/upload-client'
import type { GalleryItem, GalleryStatus } from '../model'
import {
  deleteGalleryItemAction,
  saveGalleryItemAction,
  setGalleryStatusAction,
} from '../server/actions/gallery'

type GalleryAdminProps = {
  items: GalleryItem[]
  assets: MediaAsset[]
}

const dateFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeZone: 'UTC',
})

export function GalleryAdmin({ items, assets }: GalleryAdminProps) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [mediaOptions, setMediaOptions] = useState<MediaAsset[]>(assets)
  const [mediaId, setMediaId] = useState<string>(assets[0]?.id ?? '')
  const [title, setTitle] = useState('')
  const [caption, setCaption] = useState('')
  const [location, setLocation] = useState('')
  const [takenAt, setTakenAt] = useState('')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<GalleryItem | null>(null)
  const [feedback, setFeedback] = useState<{
    status: 'success' | 'error'
    message: string
    signInRequired?: boolean
  } | null>(null)

  const selectedMedia = mediaOptions.find(asset => asset.id === mediaId) ?? null

  function resetForm() {
    setEditingId(null)
    setTitle('')
    setCaption('')
    setLocation('')
    setTakenAt('')
  }

  function startEdit(item: GalleryItem) {
    setEditingId(item.id)
    setMediaId(item.mediaId)
    setTitle(item.title)
    setCaption(item.caption)
    setLocation(item.location)
    setTakenAt(item.takenAt ?? '')
    setFeedback(null)
  }

  async function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file || uploading) return

    setUploading(true)
    setFeedback(null)
    try {
      const uploaded = await uploadMediaFile({ id: crypto.randomUUID(), file })
      const asset: MediaAsset = {
        id: uploaded.id,
        originalName: uploaded.originalName,
        mediaType: uploaded.mediaType,
        byteSize: file.size || 1,
        width: uploaded.width,
        height: uploaded.height,
        sha256: '0'.repeat(64),
        state: 'ready',
        createdAt: new Date().toISOString(),
      }
      setMediaOptions(previous => [asset, ...previous.filter(entry => entry.id !== asset.id)])
      setMediaId(uploaded.id)
      if (!title.trim()) {
        const defaultTitle = uploaded.originalName.replace(/\.[^.]*$/, '').trim()
        if (defaultTitle) setTitle(defaultTitle)
      }
      setFeedback({ status: 'success', message: `Uploaded "${uploaded.originalName}".` })
      router.refresh()
    } catch (error) {
      setFeedback({
        status: 'error',
        message: error instanceof Error ? error.message : 'Could not upload the image.',
      })
    } finally {
      setUploading(false)
    }
  }

  async function handleSave(status: GalleryStatus) {
    if (saving || uploading) return
    if (!mediaId) {
      setFeedback({ status: 'error', message: 'Upload or select an image first.' })
      return
    }
    setSaving(true)
    setFeedback(null)
    try {
      const result = await saveGalleryItemAction({
        ...(editingId ? { id: editingId } : {}),
        mediaId,
        title,
        caption,
        location,
        takenAt: takenAt.trim() || null,
        status,
      })
      if (result.status === 'success') {
        resetForm()
        setFeedback({
          status: 'success',
          message: status === 'published' ? 'Gallery item published.' : 'Gallery draft saved.',
        })
        router.refresh()
      } else {
        setFeedback({
          status: 'error',
          message: result.message,
          signInRequired: 'signInRequired' in result ? result.signInRequired : undefined,
        })
      }
    } catch {
      setFeedback({ status: 'error', message: 'Could not save this gallery item. Please try again.' })
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleStatus(item: GalleryItem) {
    if (busyItemId) return
    const nextStatus: GalleryStatus = item.status === 'published' ? 'draft' : 'published'
    setBusyItemId(item.id)
    setFeedback(null)
    try {
      const result = await setGalleryStatusAction(item.id, nextStatus)
      if (result.status === 'success') {
        setFeedback({
          status: 'success',
          message: nextStatus === 'published' ? 'Gallery item published.' : 'Moved back to draft.',
        })
        router.refresh()
      } else {
        setFeedback({
          status: 'error',
          message: result.message,
          signInRequired: 'signInRequired' in result ? result.signInRequired : undefined,
        })
      }
    } catch {
      setFeedback({ status: 'error', message: 'Could not update the publish status.' })
    } finally {
      setBusyItemId(null)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete || busyItemId) return
    const target = pendingDelete
    setPendingDelete(null)
    setBusyItemId(target.id)
    setFeedback(null)
    try {
      const result = await deleteGalleryItemAction(target.id)
      if (result.status === 'success') {
        if (editingId === target.id) resetForm()
        setFeedback({ status: 'success', message: 'Gallery item removed.' })
        router.refresh()
      } else {
        setFeedback({
          status: 'error',
          message: result.message,
          signInRequired: 'signInRequired' in result ? result.signInRequired : undefined,
        })
      }
    } catch {
      setFeedback({ status: 'error', message: 'Could not delete this gallery item.' })
    } finally {
      setBusyItemId(null)
    }
  }

  return (
    <div className="space-y-10">
      <section aria-labelledby="gallery-editor-heading" className="rounded-xl border border-border p-5 sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="gallery-editor-heading" className="text-lg font-medium">
              {editingId ? 'Edit photo' : 'Add photo'}
            </h2>
            <p className="text-sm text-muted-foreground">
              Upload a new image or reuse a ready asset from your media library.
            </p>
          </div>
          {editingId && (
            <Button type="button" variant="outline" size="sm" onClick={resetForm}>
              Cancel edit
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
          <div className="space-y-4 md:col-span-5">
            <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg border bg-muted">
              {selectedMedia ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={routes.media(selectedMedia.id)}
                  alt={selectedMedia.originalName}
                  width={selectedMedia.width}
                  height={selectedMedia.height}
                  className="h-full w-full object-contain"
                />
              ) : (
                <span className="text-sm text-muted-foreground">No image selected</span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button asChild variant="outline" disabled={uploading}>
                <label className="cursor-pointer">
                  <UploadIcon />
                  <span>{uploading ? 'Uploading…' : 'Upload new image'}</span>
                  <input
                    aria-label="Upload new image"
                    type="file"
                    accept={mediaImageFormats.map(format => format.mediaType).join(',')}
                    disabled={uploading}
                    onChange={handleFileSelect}
                    className="sr-only"
                  />
                </label>
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="gallery-media-select">Existing media asset</Label>
              <select
                id="gallery-media-select"
                value={mediaId}
                onChange={event => setMediaId(event.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-offset-2 outline-ring focus-visible:outline-2"
              >
                {mediaOptions.length === 0 && <option value="">No uploaded media yet</option>}
                {mediaOptions.map(asset => (
                  <option key={asset.id} value={asset.id}>
                    {asset.originalName} ({asset.width}×{asset.height})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-4 md:col-span-7">
            <div className="space-y-1.5">
              <Label htmlFor="gallery-title">Title</Label>
              <Input
                id="gallery-title"
                value={title}
                onChange={event => setTitle(event.target.value)}
                placeholder="Morning light over the harbor"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="gallery-caption">Caption</Label>
              <Textarea
                id="gallery-caption"
                rows={3}
                value={caption}
                onChange={event => setCaption(event.target.value)}
                placeholder="Optional note about the frame, camera, or context."
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="gallery-location">Location</Label>
                <Input
                  id="gallery-location"
                  value={location}
                  onChange={event => setLocation(event.target.value)}
                  placeholder="Kyoto"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="gallery-taken-at">Date taken</Label>
                <Input
                  id="gallery-taken-at"
                  type="date"
                  value={takenAt}
                  onChange={event => setTakenAt(event.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                disabled={saving || uploading}
                onClick={() => { void handleSave('draft') }}
              >
                {saving ? 'Saving…' : 'Save draft'}
              </Button>
              <Button
                type="button"
                disabled={saving || uploading}
                onClick={() => { void handleSave('published') }}
              >
                {saving ? 'Saving…' : 'Publish photo'}
              </Button>
            </div>
          </div>
        </div>

        {feedback && (
          <div
            role={feedback.status === 'error' ? 'alert' : 'status'}
            className={`mt-4 space-y-1 text-sm ${feedback.status === 'error' ? 'text-destructive' : 'text-foreground'}`}
          >
            <p>{feedback.message}</p>
            {feedback.signInRequired && (
              <a href={routes.admin.login} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                Sign in in a new tab
              </a>
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="gallery-list-heading" className="space-y-4">
        <h2 id="gallery-list-heading" className="text-lg font-medium">
          All photos ({items.length})
        </h2>

        {items.length > 0 ? (
          <ul aria-label="Gallery items" className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3">
            {items.map(item => {
              const isBusy = busyItemId === item.id
              return (
                <li key={item.id} className="flex flex-col gap-3 rounded-xl border border-border p-4">
                  <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-lg bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={routes.media(item.mediaId)}
                      alt={item.title}
                      width={item.media.width}
                      height={item.media.height}
                      loading="lazy"
                      className="h-full w-full object-contain"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <h3 className="truncate font-medium">{item.title}</h3>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {item.status === 'published' ? 'Published' : 'Draft'}
                      </span>
                    </div>
                    {item.caption && (
                      <p className="line-clamp-2 text-sm text-muted-foreground">{item.caption}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {[
                        item.location || null,
                        item.takenAt ? dateFormatter.format(new Date(`${item.takenAt}T00:00:00Z`)) : null,
                        `${item.media.width}×${item.media.height}`,
                      ].filter(Boolean).join(' · ')}
                    </p>
                  </div>

                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button type="button" variant="quiet" size="text" onClick={() => startEdit(item)}>
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="quiet"
                        size="text"
                        disabled={isBusy}
                        onClick={() => { void handleToggleStatus(item) }}
                      >
                        {item.status === 'published' ? 'Unpublish' : 'Publish'}
                      </Button>
                      {item.status === 'published' && (
                        <Link
                          href={routes.galleryItem(item.id)}
                          className="text-xs underline underline-offset-4 transition-colors hover:text-muted-foreground"
                        >
                          View
                        </Link>
                      )}
                    </div>
                    <Button
                      type="button"
                      variant="quiet"
                      size="text"
                      disabled={isBusy}
                      onClick={() => setPendingDelete(item)}
                    >
                      <Trash2Icon />
                      Delete
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground">No gallery photos yet.</p>
        )}
      </section>

      <AlertDialog open={pendingDelete !== null} onOpenChange={open => { if (!open) setPendingDelete(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete gallery item?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `"${pendingDelete.title}" will be removed from the gallery. The underlying file remains in the media library.`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void confirmDelete() }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

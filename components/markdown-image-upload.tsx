'use client'

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Button } from '@/components/ui/button'
import type { MarkdownImageInsertion } from '@/modules/markdown/ui/editor'
import { mediaImageFormats, mediaUploadResponseSchema, MAX_MEDIA_UPLOAD_BYTES, MAX_MEDIA_IMAGE_PIXELS } from '@/modules/media/model'

type MarkdownImageUploadProps = {
  prepareInsertion: () => MarkdownImageInsertion | null
}

const buttonClassName = 'rounded-full bg-zinc-100 text-black hover:bg-zinc-950 hover:text-zinc-50 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700'

function markdownAlt(filename: string) {
  const base = filename.split(/[\\/]/).at(-1)?.replace(/\.[^.]*$/, '').trim() ?? ''
  return base.replace(/[\\[\]]/g, character => `\\${character}`)
}

export function MarkdownImageUpload({ prepareInsertion }: MarkdownImageUploadProps) {
  const [file, setFile] = useState<File | null>(null)
  const [uploadId, setUploadId] = useState<string | null>(null)
  const [uploadedMarkdown, setUploadedMarkdown] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const insertion = useRef<MarkdownImageInsertion | null>(null)
  const request = useRef<AbortController | null>(null)

  useEffect(() => () => {
    request.current?.abort()
    insertion.current?.release()
  }, [])

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.currentTarget.files?.[0] ?? null
    event.currentTarget.value = ''
    insertion.current?.release()
    insertion.current = null
    setFile(selected)
    setUploadId(selected ? crypto.randomUUID() : null)
    setUploadedMarkdown(null)
    setError(null)
  }

  function finishInsertion() {
    insertion.current?.release()
    insertion.current = null
    setFile(null)
    setUploadId(null)
    setUploadedMarkdown(null)
    setError(null)
  }

  async function upload() {
    if (!file || !uploadId || busy || uploadedMarkdown) return
    insertion.current ??= prepareInsertion()
    if (!insertion.current) return
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError(null)
    try {
      const form = new FormData()
      form.set('id', uploadId)
      form.set('file', file)
      const response = await fetch('/api/admin/media', { method: 'POST', body: form, signal: controller.signal })
      const raw: unknown = await response.json()
      if (controller.signal.aborted) return
      const result = mediaUploadResponseSchema.safeParse(raw)
      if (!result.success) throw new Error('The upload response was invalid.')
      if (!response.ok || result.data.status === 'error') {
        throw new Error(result.data.status === 'error' ? result.data.message : 'Could not upload the image.')
      }
      if (result.data.media.id !== uploadId) throw new Error('The upload response belongs to a different image.')
      const alt = markdownAlt(result.data.media.originalName)
      const markdown = `![${alt}](${result.data.media.url})`
      if (insertion.current?.insert(markdown)) {
        finishInsertion()
      } else {
        setUploadedMarkdown(markdown)
        setError('The image was uploaded, but the editor content changed. Choose where to insert it, then insert the uploaded image.')
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not upload the image. Retry this file.')
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  function insertUploaded() {
    if (!uploadedMarkdown) return
    const target = prepareInsertion()
    if (target?.insert(uploadedMarkdown)) finishInsertion()
    target?.release()
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <Button asChild size="sm" variant="secondary" className={buttonClassName}>
        <label className="cursor-pointer">
          <span>{file ? 'Choose another image' : 'Add image'}</span>
          <input
            aria-label="Choose image"
            className="sr-only"
            type="file"
            accept={mediaImageFormats.map(format => format.mediaType).join(',')}
            disabled={busy}
            onChange={selectFile}
          />
        </label>
      </Button>
      {file && (
        <>
          <span className="max-w-48 truncate text-xs text-zinc-500 dark:text-zinc-400">{file.name}</span>
          <Button type="button" size="sm" variant="secondary" className={buttonClassName} disabled={busy} onClick={() => {
            if (uploadedMarkdown) insertUploaded()
            else void upload()
          }}>
            {busy ? 'Uploading…' : uploadedMarkdown ? 'Insert uploaded image' : error ? 'Retry upload' : 'Upload and insert'}
          </Button>
        </>
      )}
      {error && <p role="alert" className="w-full text-sm text-zinc-600 dark:text-zinc-400">{error}</p>}
      <p className="w-full text-xs text-zinc-500 dark:text-zinc-400">
        JPEG, PNG, GIF, or WebP · up to {MAX_MEDIA_UPLOAD_BYTES / 1024 / 1024} MiB and {MAX_MEDIA_IMAGE_PIXELS / 1_000_000} megapixels. Uploading does not save or publish this post.
      </p>
    </div>
  )
}

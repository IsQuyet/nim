'use client'

import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Button } from '@/components/ui/button'
import type { MarkdownImageInsertion } from '@/modules/markdown/ui/editor'
import { formatMarkdownImage, mediaImageFormats, MAX_MEDIA_UPLOAD_BYTES, MAX_MEDIA_IMAGE_PIXELS } from '../model'
import { uploadMediaFile } from '../upload-client'

type MarkdownImageUploadProps = {
  prepareInsertion: () => MarkdownImageInsertion | null
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
      const uploaded = await uploadMediaFile({ id: uploadId, file, signal: controller.signal })
      if (controller.signal.aborted) return
      const markdown = formatMarkdownImage(uploaded.id, uploaded.originalName)
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
      <Button asChild>
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
          <span className="max-w-48 truncate text-xs text-muted-foreground">{file.name}</span>
          <Button type="button" disabled={busy} aria-busy={busy} onClick={() => {
            if (uploadedMarkdown) insertUploaded()
            else void upload()
          }}>
            {busy ? 'Uploading…' : uploadedMarkdown ? 'Insert uploaded image' : error ? 'Retry upload' : 'Upload and insert'}
          </Button>
        </>
      )}
      {error && <p role="alert" className="w-full text-sm text-destructive">{error}</p>}
      <p className="w-full text-xs text-muted-foreground">
        JPEG, PNG, GIF, or WebP · up to {MAX_MEDIA_UPLOAD_BYTES / 1024 / 1024} MiB and {MAX_MEDIA_IMAGE_PIXELS / 1_000_000} megapixels. Uploading does not save or publish this post.
      </p>
    </div>
  )
}

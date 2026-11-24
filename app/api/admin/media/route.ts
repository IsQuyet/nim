import { unstable_rethrow } from 'next/navigation'
import { withAdmin } from '@/modules/auth/server/admin'
import { getSiteUrl } from '@/lib/server/site-config'
import { mediaUploadResponseSchema, MAX_MEDIA_UPLOAD_BYTES } from '@/modules/media/model'
import { prepareMediaUpload } from '@/modules/media/server/upload'
import { createMediaStore } from '@/modules/media/server/store'
import { createConfiguredMediaStorage } from '@/modules/media/server/storage'
import { withDatabase } from '@/lib/server/database'
import { routes } from '@/lib/routes'

export const runtime = 'nodejs'
const MAX_MEDIA_REQUEST_BYTES = MAX_MEDIA_UPLOAD_BYTES + 64 * 1024

function jsonError(message: string, status: number) {
  return Response.json({ status: 'error', message }, { status })
}

async function acceptUpload(request: Request) {
  const contentLength = Number(request.headers.get('content-length'))
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    return jsonError('A bounded Content-Length is required for image uploads.', 411)
  }
  if (contentLength > MAX_MEDIA_REQUEST_BYTES) {
    return jsonError(`Images must be ${MAX_MEDIA_UPLOAD_BYTES / 1024 / 1024} MiB or smaller.`, 413)
  }

  if (!request.body) return jsonError('Choose an image file.', 400)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_MEDIA_REQUEST_BYTES) {
        await reader.cancel()
        return jsonError('The upload request exceeds the image size limit.', 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  if (total !== contentLength) return jsonError('The upload length does not match its Content-Length.', 400)
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  let form: FormData
  try {
    form = await new Response(body, { headers: { 'Content-Type': request.headers.get('content-type') ?? '' } }).formData()
  } catch (error) {
    unstable_rethrow(error)
    return jsonError('The image upload form is invalid.', 400)
  }
  const ids = form.getAll('id')
  const files = form.getAll('file')
  if (ids.length !== 1 || files.length !== 1 || !(files[0] instanceof File)) {
    return jsonError('Choose exactly one image file and provide its upload ID.', 400)
  }
  const file = files[0]
  if (file.size > MAX_MEDIA_UPLOAD_BYTES) {
    return jsonError(`Images must be ${MAX_MEDIA_UPLOAD_BYTES / 1024 / 1024} MiB or smaller.`, 413)
  }

  const prepared = await prepareMediaUpload({
    id: ids[0],
    originalName: file.name,
    declaredType: file.type,
    bytes: new Uint8Array(await file.arrayBuffer()),
  })
  if (prepared.status === 'invalid') return jsonError(prepared.message, 400)

  const result = await withDatabase(database =>
    createMediaStore(database, createConfiguredMediaStorage()).upload(prepared.value))
  if (result.status === 'conflict') {
    return jsonError('This upload ID already belongs to a different image.', 409)
  }
  if (result.value.state !== 'ready') return jsonError('The image upload is still being finalized. Retry the same upload.', 503)
  return Response.json(mediaUploadResponseSchema.parse({
    status: 'success',
    media: {
      id: result.value.id,
      originalName: result.value.originalName,
      mediaType: result.value.mediaType,
      width: result.value.width,
      height: result.value.height,
      url: routes.media(result.value.id),
    },
  }))
}

export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin')
    if (!origin) return jsonError('This upload request is not allowed.', 403)
    let requestOrigin: URL
    try {
      requestOrigin = new URL(origin)
    } catch {
      return jsonError('This upload request is not allowed.', 403)
    }
    if (requestOrigin.origin !== getSiteUrl().origin) return jsonError('This upload request is not allowed.', 403)
    const upload = await withAdmin(() => acceptUpload(request))
    if (!upload.authorized) return jsonError('Sign in to upload images.', 401)
    return upload.value
  } catch (error) {
    unstable_rethrow(error)
    console.error('上传图片失败。', error)
    return jsonError('Could not confirm the image upload. Retry the same file.', 500)
  }
}

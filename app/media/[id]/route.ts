import { connection } from 'next/server'
import { postIdSchema } from '@/modules/posts/model'
import type { MediaAsset } from '@/modules/media/model'
import { getAdminSession } from '@/modules/auth/server/auth'
import { getMediaDirectory } from '@/lib/server/data-paths'
import { openDatabase } from '@/lib/server/database'
import { createMediaStore } from '@/modules/media/server/store'
import { createFileMediaStorage } from '@/modules/media/server/storage'

type MediaRouteContext = {
  params: Promise<{ id: string }>
}

export const runtime = 'nodejs'

function notFound() {
  return new Response(null, { status: 404, headers: { 'Cache-Control': 'private, no-store' } })
}

export async function GET(request: Request, { params }: MediaRouteContext) {
  await connection()
  const { id: candidate } = await params
  const parsed = postIdSchema.safeParse(candidate)
  if (!parsed.success) return notFound()

  const database = openDatabase()
  let asset: MediaAsset | null
  let publicAsset = false
  try {
    const store = createMediaStore(database, createFileMediaStorage(getMediaDirectory()))
    asset = store.get(parsed.data)
    if (!asset || asset.state !== 'ready') return notFound()
    publicAsset = store.isPublished(asset.id)
  } finally {
    database.$client.close()
  }

  if (!publicAsset && !(await getAdminSession())) return notFound()
  const bytes = await createFileMediaStorage(getMediaDirectory()).read(asset)
  if (!bytes) return notFound()

  const etag = `"${asset.sha256}"`
  const headers = new Headers({
    'Cache-Control': publicAsset ? 'public, max-age=31536000, immutable' : 'private, no-store',
    'Content-Length': String(bytes.byteLength),
    'Content-Type': asset.mediaType,
    'Content-Disposition': 'inline',
    'ETag': etag,
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
  })
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers })
  return new Response(bytes, { headers })
}

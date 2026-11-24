import { connection } from 'next/server'
import { mediaIdSchema } from '@/modules/media/model'
import { getAdminSession } from '@/modules/auth/server/auth'
import { withDatabase } from '@/lib/server/database'
import { createMediaStore } from '@/modules/media/server/store'
import { createConfiguredMediaStorage } from '@/modules/media/server/storage'
import { isSiteMediaPublished } from '@/modules/site/server/media-admin'

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
  const parsed = mediaIdSchema.safeParse(candidate)
  if (!parsed.success) return notFound()

  const storage = createConfiguredMediaStorage()
  const found = await withDatabase(async database => {
    const asset = await createMediaStore(database, storage).get(parsed.data)
    if (!asset || asset.state !== 'ready') return null
    return { asset, publicAsset: await isSiteMediaPublished(database, asset.id) }
  })
  if (!found) return notFound()
  const { asset, publicAsset } = found

  if (!publicAsset && !(await getAdminSession())) return notFound()
  const bytes = await storage.read(asset)
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

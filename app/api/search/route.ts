import { connection } from 'next/server'
import { withDatabase } from '@/lib/server/database'
import { DEFAULT_PALETTE_LIMIT } from '@/modules/search/model'
import { searchSiteDatabase } from '@/modules/search/server/public'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  await connection()
  const { searchParams } = new URL(request.url)
  const result = await withDatabase(database =>
    searchSiteDatabase(database, {
      q: searchParams.get('q') ?? '',
      scope: searchParams.get('scope') ?? searchParams.get('type') ?? 'all',
      limit: searchParams.get('limit') ?? DEFAULT_PALETTE_LIMIT,
    }),
  )

  return Response.json(result, {
    headers: { 'Cache-Control': 'no-store' },
  })
}

import 'server-only'
import { cache } from 'react'
import { connection } from 'next/server'
import { withDatabase, type AppDatabase } from '@/lib/server/database'
import { createGalleryStore } from '@/modules/gallery/server/store'
import { listPublishedPostDocuments } from '@/modules/posts/server/store'
import { executeSiteSearch } from '../engine'
import { searchQuerySchema, type SearchResponse } from '../model'

export type SearchQueryInput = {
  q?: string | null
  scope?: string | null
  limit?: number | string | null
}

/** 对数据库中的公开文章与公开画廊作品执行站内检索。 */
export async function searchSiteDatabase(database: AppDatabase, input: SearchQueryInput): Promise<SearchResponse> {
  const parsed = searchQuerySchema.parse({
    q: input.q ?? '',
    scope: input.scope ?? 'all',
    limit: input.limit ?? undefined,
  })

  if (!parsed.q) {
    return {
      query: '',
      scope: parsed.scope,
      terms: [],
      total: 0,
      counts: { all: 0, posts: 0, gallery: 0 },
      hits: [],
    }
  }

  const [posts, gallery] = await Promise.all([
    listPublishedPostDocuments(database),
    createGalleryStore(database).listPublished(),
  ])

  return executeSiteSearch({
    query: parsed.q,
    scope: parsed.scope,
    limit: parsed.limit,
    posts,
    gallery,
  })
}

export const searchPublicSite = cache(async (input: SearchQueryInput): Promise<SearchResponse> => {
  await connection()
  return withDatabase(database => searchSiteDatabase(database, input))
})

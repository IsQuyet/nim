import type { Route } from 'next'
import { z } from 'zod'

export const SEARCH_SCOPES = ['all', 'posts', 'gallery'] as const
export type SearchScope = (typeof SEARCH_SCOPES)[number]

export const MAX_SEARCH_QUERY_LENGTH = 120
export const MAX_SEARCH_LIMIT = 50
export const DEFAULT_PALETTE_LIMIT = 8
export const DEFAULT_SEARCH_PAGE_LIMIT = 20

export const searchScopeSchema = z.enum(SEARCH_SCOPES).catch('all')

export const searchQuerySchema = z.object({
  q: z
    .string()
    .transform(value => value.trim().slice(0, MAX_SEARCH_QUERY_LENGTH))
    .default(''),
  scope: searchScopeSchema.default('all'),
  limit: z.coerce.number().int().min(1).max(MAX_SEARCH_LIMIT).default(DEFAULT_SEARCH_PAGE_LIMIT),
})

export type SearchSnippetSegment = {
  text: string
  matched: boolean
}

export type SearchPostHit = {
  kind: 'post'
  id: string
  title: string
  description: string
  publishedAt: string
  href: Route<`/blog/${string}`>
  titleSegments: SearchSnippetSegment[]
  excerptSegments: SearchSnippetSegment[]
  score: number
}

export type SearchGalleryHit = {
  kind: 'gallery'
  id: string
  title: string
  caption: string
  location: string
  takenAt: string | null
  publishedAt: string
  mediaId: string
  width: number
  height: number
  href: Route<`/gallery/${string}`>
  titleSegments: SearchSnippetSegment[]
  detailSegments: SearchSnippetSegment[]
  score: number
}

export type SearchHit = SearchPostHit | SearchGalleryHit

export type SearchCounts = {
  all: number
  posts: number
  gallery: number
}

export type SearchResponse = {
  query: string
  scope: SearchScope
  terms: string[]
  total: number
  counts: SearchCounts
  hits: SearchHit[]
}

import { routes } from '@/lib/routes'
import type { PublishedGalleryItem } from '@/modules/gallery/model'
import type {
  SearchGalleryHit,
  SearchHit,
  SearchPostHit,
  SearchResponse,
  SearchScope,
  SearchSnippetSegment,
} from './model'
import { MAX_SEARCH_QUERY_LENGTH } from './model'

export type SearchablePost = {
  id: string
  title: string
  description: string
  body: string
  publishedAt: string
}

type MatchInterval = { start: number; end: number }

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 拆解搜索词：按空白切分中英文混排词条，并按大小写折叠去重。 */
export function parseSearchTerms(rawQuery: string): string[] {
  const trimmed = rawQuery.trim().slice(0, MAX_SEARCH_QUERY_LENGTH)
  if (!trimmed) return []

  const seen = new Set<string>()
  const terms: string[] = []
  for (const part of trimmed.split(/\s+/)) {
    if (!part) continue
    const key = part.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    terms.push(part)
  }
  return terms
}

/** 剥离 Markdown 控制语法与站内媒体地址，仅保留可读文本参与检索和摘录。 */
export function stripMarkdownForSearch(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/```[^\n]*\n([\s\S]*?)```/g, ' $1 ')
    .replace(/~~~[^\n]*\n([\s\S]*?)~~~/g, ' $1 ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s+|(?:[-*+]|\d+\.)\s+)/gm, '')
    .replace(/[*_~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function collectMatches(text: string, terms: string[]): MatchInterval[] {
  if (!text || terms.length === 0) return []
  const intervals: MatchInterval[] = []

  for (const term of terms) {
    const regex = new RegExp(escapeRegExp(term), 'gi')
    for (const match of text.matchAll(regex)) {
      if (typeof match.index !== 'number' || match[0].length === 0) continue
      intervals.push({ start: match.index, end: match.index + match[0].length })
    }
  }

  if (intervals.length === 0) return []
  intervals.sort((left, right) => left.start - right.start || left.end - right.end)

  const merged: MatchInterval[] = [intervals[0]]
  for (let i = 1; i < intervals.length; i += 1) {
    const current = intervals[i]
    const last = merged[merged.length - 1]
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end)
    } else {
      merged.push(current)
    }
  }
  return merged
}

export function highlightSegments(text: string, terms: string[]): SearchSnippetSegment[] {
  if (!text) return []
  const intervals = collectMatches(text, terms)
  if (intervals.length === 0) return [{ text, matched: false }]

  const segments: SearchSnippetSegment[] = []
  let cursor = 0
  for (const interval of intervals) {
    if (interval.start > cursor) {
      segments.push({ text: text.slice(cursor, interval.start), matched: false })
    }
    segments.push({ text: text.slice(interval.start, interval.end), matched: true })
    cursor = interval.end
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), matched: false })
  }
  return segments
}

export function buildExcerptSegments(text: string, terms: string[], maxLength = 140): SearchSnippetSegment[] {
  if (!text) return []
  const intervals = collectMatches(text, terms)
  if (intervals.length === 0) {
    const clipped = text.length > maxLength ? `${text.slice(0, maxLength).trimEnd()}…` : text
    return [{ text: clipped, matched: false }]
  }

  const first = intervals[0]
  let start = Math.max(0, first.start - 40)
  const end = Math.min(text.length, start + maxLength)
  if (end - start < maxLength && start > 0) {
    start = Math.max(0, end - maxLength)
  }

  const slice = text.slice(start, end)
  const segments = highlightSegments(slice, terms)
  if (start > 0) segments.unshift({ text: '…', matched: false })
  if (end < text.length) segments.push({ text: '…', matched: false })
  return segments
}

function countOccurrences(haystackLower: string, needleLower: string): number {
  let count = 0
  let offset = 0
  while (offset <= haystackLower.length - needleLower.length) {
    const found = haystackLower.indexOf(needleLower, offset)
    if (found === -1) break
    count += 1
    offset = found + needleLower.length
  }
  return count
}

function scoreTextFields(
  queryLower: string,
  termsLower: string[],
  title: string,
  secondaryFields: string[],
  body: string,
): number | null {
  const titleLower = title.toLowerCase()
  const secondaryLowers = secondaryFields.map(field => field.toLowerCase())
  const bodyLower = body.toLowerCase()

  let score = 0
  if (titleLower === queryLower) {
    score += 120
  } else if (titleLower.startsWith(queryLower)) {
    score += 45
  }

  for (const term of termsLower) {
    const inTitle = titleLower.includes(term)
    const inSecondary = secondaryLowers.some(field => field.includes(term))
    const bodyHits = bodyLower ? countOccurrences(bodyLower, term) : 0

    if (!inTitle && !inSecondary && bodyHits === 0) {
      return null
    }

    if (inTitle) {
      score += titleLower.startsWith(term) ? 40 : 35
    }
    if (inSecondary) {
      score += 18
    }
    if (bodyHits > 0) {
      score += 10 + Math.min(bodyHits, 5) * 2
    }
  }

  return score
}

/** 对公开文章和画廊作品执行多语检索、权重排序与高亮摘要提取。 */
export function executeSiteSearch({
  query,
  scope,
  limit,
  posts,
  gallery,
}: {
  query: string
  scope: SearchScope
  limit: number
  posts: SearchablePost[]
  gallery: PublishedGalleryItem[]
}): SearchResponse {
  const terms = parseSearchTerms(query)
  if (terms.length === 0) {
    return {
      query: query.trim(),
      scope,
      terms: [],
      total: 0,
      counts: { all: 0, posts: 0, gallery: 0 },
      hits: [],
    }
  }

  const queryLower = terms.join(' ').toLowerCase()
  const termsLower = terms.map(term => term.toLowerCase())

  const postHits: SearchPostHit[] = []
  for (const post of posts) {
    const plainBody = stripMarkdownForSearch(post.body)
    const score = scoreTextFields(queryLower, termsLower, post.title, [post.description], plainBody)
    if (score === null) continue

    const descMatched = collectMatches(post.description, terms).length > 0
    const bodyMatched = collectMatches(plainBody, terms).length > 0
    const excerptSource = bodyMatched || !post.description ? plainBody : post.description

    postHits.push({
      kind: 'post',
      id: post.id,
      title: post.title,
      description: post.description,
      publishedAt: post.publishedAt,
      href: routes.post(post.id),
      titleSegments: highlightSegments(post.title, terms),
      excerptSegments: descMatched && !bodyMatched
        ? highlightSegments(post.description, terms)
        : buildExcerptSegments(excerptSource, terms),
      score,
    })
  }

  const galleryHits: SearchGalleryHit[] = []
  for (const item of gallery) {
    const score = scoreTextFields(
      queryLower,
      termsLower,
      item.title,
      [item.caption, item.location, item.takenAt ?? ''],
      '',
    )
    if (score === null) continue

    const detailParts = [item.location, item.takenAt, item.caption].filter(Boolean)
    const detailText = detailParts.join(' · ')

    galleryHits.push({
      kind: 'gallery',
      id: item.id,
      title: item.title,
      caption: item.caption,
      location: item.location,
      takenAt: item.takenAt,
      publishedAt: item.publishedAt,
      mediaId: item.mediaId,
      width: item.media.width,
      height: item.media.height,
      href: routes.galleryItem(item.id),
      titleSegments: highlightSegments(item.title, terms),
      detailSegments: detailText ? buildExcerptSegments(detailText, terms, 140) : [],
      score,
    })
  }

  const compareHits = (left: SearchHit, right: SearchHit) =>
    right.score - left.score ||
    right.publishedAt.localeCompare(left.publishedAt) ||
    left.id.localeCompare(right.id)

  postHits.sort(compareHits)
  galleryHits.sort(compareHits)

  const allHits: SearchHit[] = [...postHits, ...galleryHits].sort(compareHits)
  const scopedHits =
    scope === 'posts' ? postHits : scope === 'gallery' ? galleryHits : allHits

  return {
    query: query.trim(),
    scope,
    terms,
    total: scopedHits.length,
    counts: {
      all: allHits.length,
      posts: postHits.length,
      gallery: galleryHits.length,
    },
    hits: scopedHits.slice(0, limit),
  }
}

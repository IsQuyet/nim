import Link from 'next/link'
import { routes } from '@/lib/routes'
import { cn } from '@/lib/utils'
import type { SearchHit, SearchResponse, SearchSnippetSegment } from '../model'

const dateFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeZone: 'UTC',
})

export function HighlightedText({ segments }: { segments: SearchSnippetSegment[] }) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.matched ? (
          <mark key={index} className="rounded-xs bg-accent px-0.5 text-foreground">
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  )
}

function HitCard({
  hit,
  active,
  onNavigate,
}: {
  hit: SearchHit
  active: boolean
  onNavigate?: () => void
}) {
  if (hit.kind === 'gallery') {
    return (
      <Link
        href={hit.href}
        onClick={onNavigate}
        data-active={active ? 'true' : undefined}
        className={cn(
          'flex items-start gap-3 rounded-xl border border-transparent p-3 transition-colors hover:bg-accent/60',
          active && 'border-border bg-accent/80',
        )}
      >
        <div className="aspect-[4/3] w-16 shrink-0 overflow-hidden rounded-md border bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={routes.media(hit.mediaId)}
            alt={hit.title}
            width={hit.width}
            height={hit.height}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="truncate font-medium">
              <HighlightedText segments={hit.titleSegments} />
            </h3>
            <span className="shrink-0 text-xs text-muted-foreground">Gallery</span>
          </div>
          {hit.detailSegments.length > 0 && (
            <p className="line-clamp-2 text-sm text-muted-foreground">
              <HighlightedText segments={hit.detailSegments} />
            </p>
          )}
        </div>
      </Link>
    )
  }

  return (
    <Link
      href={hit.href}
      onClick={onNavigate}
      data-active={active ? 'true' : undefined}
      className={cn(
        'block rounded-xl border border-transparent p-3 transition-colors hover:bg-accent/60',
        active && 'border-border bg-accent/80',
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="min-w-0 truncate font-medium">
          <HighlightedText segments={hit.titleSegments} />
        </h3>
        <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <span>Post</span>
          <time dateTime={hit.publishedAt}>{dateFormatter.format(new Date(hit.publishedAt))}</time>
        </div>
      </div>
      {hit.excerptSegments.length > 0 && (
        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
          <HighlightedText segments={hit.excerptSegments} />
        </p>
      )}
    </Link>
  )
}

type SearchResultsProps = {
  response: SearchResponse
  activeIndex?: number
  onNavigate?: () => void
  emptyIdleText?: string
}

export function SearchResults({
  response,
  activeIndex = -1,
  onNavigate,
  emptyIdleText = 'Type keywords to search across published articles and gallery photos.',
}: SearchResultsProps) {
  if (!response.query) {
    return <p className="text-sm text-muted-foreground">{emptyIdleText}</p>
  }

  if (response.hits.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No results matched &ldquo;{response.query}&rdquo;.
      </p>
    )
  }

  return (
    <ul aria-label="Search results" className="divide-y divide-border">
      {response.hits.map((hit, index) => (
        <li key={`${hit.kind}:${hit.id}`} className="py-1 first:pt-0 last:pb-0">
          <HitCard hit={hit} active={index === activeIndex} onNavigate={onNavigate} />
        </li>
      ))}
    </ul>
  )
}

import type { Metadata } from 'next'
import Link from 'next/link'
import { Canvas } from '@/components/layout/canvas'
import { PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/field'
import { routes } from '@/lib/routes'
import { cn } from '@/lib/utils'
import {
  DEFAULT_SEARCH_PAGE_LIMIT,
  SEARCH_SCOPES,
  searchQuerySchema,
  type SearchScope,
} from '@/modules/search/model'
import { searchPublicSite } from '@/modules/search/server/public'
import { SearchResults } from '@/modules/search/ui/search-results'

type SearchPageProps = {
  searchParams: Promise<{ q?: string | string[]; type?: string | string[] }>
}

const SCOPE_LABELS: Record<SearchScope, string> = {
  all: 'All',
  posts: 'Posts',
  gallery: 'Gallery',
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '')
}

export async function generateMetadata({ searchParams }: SearchPageProps): Promise<Metadata> {
  const params = await searchParams
  const q = firstParam(params.q).trim()
  return {
    title: q ? `Search: ${q}` : 'Search',
    alternates: { canonical: routes.search },
    robots: q ? { index: false, follow: true } : undefined,
  }
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams
  const parsed = searchQuerySchema.parse({
    q: firstParam(params.q),
    scope: firstParam(params.type) || 'all',
    limit: DEFAULT_SEARCH_PAGE_LIMIT,
  })

  const response = await searchPublicSite({
    q: parsed.q,
    scope: parsed.scope,
    limit: parsed.limit,
  })

  return (
    <Canvas>
      <main className="space-y-8">
        <PageHeader
          title="Search"
          description={<p>Search across published blog posts and gallery photos.</p>}
        />

        <form method="GET" action={routes.search} className="flex flex-wrap items-center gap-3">
          {parsed.scope !== 'all' && <input type="hidden" name="type" value={parsed.scope} />}
          <Input
            name="q"
            defaultValue={parsed.q}
            aria-label="Search query"
            placeholder="Search articles, locations, captions..."
            className="min-w-56 flex-1"
          />
          <Button type="submit">Search</Button>
        </form>

        <nav aria-label="Filter results" className="flex flex-wrap items-center gap-2 border-b pb-3 text-sm">
          {SEARCH_SCOPES.map(candidate => {
            const active = response.scope === candidate
            const countLabel = response.query ? ` (${response.counts[candidate]})` : ''
            return (
              <Link
                key={candidate}
                href={routes.searchWith(response.query, candidate)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'rounded-full px-3 py-1 transition-colors',
                  active
                    ? 'bg-secondary font-medium text-secondary-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {SCOPE_LABELS[candidate]}
                {countLabel}
              </Link>
            )
          })}
        </nav>

        <SearchResults response={response} />
      </main>
    </Canvas>
  )
}

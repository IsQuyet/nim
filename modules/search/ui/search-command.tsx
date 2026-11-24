'use client'

import { useEffect, useRef, useState } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { SearchIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { routes } from '@/lib/routes'
import { cn } from '@/lib/utils'
import {
  DEFAULT_PALETTE_LIMIT,
  SEARCH_SCOPES,
  type SearchResponse,
  type SearchScope,
} from '../model'
import { SearchResults } from './search-results'

const SCOPE_LABELS: Record<SearchScope, string> = {
  all: 'All',
  posts: 'Posts',
  gallery: 'Gallery',
}

function emptyResponse(query: string, scope: SearchScope): SearchResponse {
  return {
    query,
    scope,
    terms: [],
    total: 0,
    counts: { all: 0, posts: 0, gallery: 0 },
    hits: [],
  }
}

/** 页头搜索触发器与 Ctrl/Cmd+K 快捷搜索弹窗。 */
export function SearchTrigger() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<SearchScope>('all')
  const [response, setResponse] = useState<SearchResponse>(() => emptyResponse('', 'all'))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(previous => !previous)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const trimmedQuery = query.trim()
  const activeResponse = trimmedQuery ? response : emptyResponse('', scope)
  const isLoading = Boolean(trimmedQuery) && loading
  const activeError = trimmedQuery ? error : null

  useEffect(() => {
    if (!open || !trimmedQuery) return

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          q: trimmedQuery,
          scope,
          limit: String(DEFAULT_PALETTE_LIMIT),
        })
        const res = await fetch(`${routes.searchApi}?${params.toString()}`, {
          signal: controller.signal,
        })
        if (!res.ok) throw new Error('Search request failed.')
        const data = (await res.json()) as SearchResponse
        if (controller.signal.aborted) return
        setResponse(data)
        setActiveIndex(0)
      } catch {
        if (!controller.signal.aborted) {
          setError('Could not load search results. Please try again.')
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }, 150)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [open, trimmedQuery, scope])

  function closeDialog() {
    setOpen(false)
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' && activeResponse.hits.length > 0) {
      event.preventDefault()
      setActiveIndex(previous => (previous + 1) % activeResponse.hits.length)
    } else if (event.key === 'ArrowUp' && activeResponse.hits.length > 0) {
      event.preventDefault()
      setActiveIndex(previous => (previous <= 0 ? activeResponse.hits.length - 1 : previous - 1))
    } else if (event.key === 'Enter') {
      const selected = activeResponse.hits[activeIndex]
      if (selected && !event.shiftKey) {
        event.preventDefault()
        closeDialog()
        router.push(selected.href)
      } else if (trimmedQuery) {
        event.preventDefault()
        closeDialog()
        router.push(routes.searchWith(query, scope))
      }
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="Search" title="Search (Ctrl+K)">
          <SearchIcon />
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-xs" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onOpenAutoFocus={event => {
            event.preventDefault()
            inputRef.current?.focus()
          }}
          className="fixed inset-x-3 top-14 z-50 mx-auto flex max-h-[calc(100dvh-5rem)] max-w-2xl flex-col overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-xl sm:inset-x-6 sm:top-20"
        >
          <DialogPrimitive.Title className="sr-only">Search site</DialogPrimitive.Title>

          <div className="flex items-center gap-2 border-b px-4 py-3">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              aria-label="Search posts and photos"
              placeholder="Search articles and gallery..."
              value={query}
              onChange={event => setQuery(event.target.value)}
              onKeyDown={handleInputKeyDown}
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Clear search"
                onClick={() => {
                  setQuery('')
                  inputRef.current?.focus()
                }}
              >
                <XIcon />
              </Button>
            )}
            <DialogPrimitive.Close asChild>
              <Button type="button" variant="ghost" size="sm">
                Esc
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-xs">
            <div className="flex items-center gap-1" role="group" aria-label="Search scope">
              {SEARCH_SCOPES.map(candidate => (
                <button
                  key={candidate}
                  type="button"
                  aria-pressed={scope === candidate}
                  onClick={() => {
                    setScope(candidate)
                    setActiveIndex(0)
                  }}
                  className={cn(
                    'rounded-full px-2.5 py-1 transition-colors',
                    scope === candidate
                      ? 'bg-secondary font-medium text-secondary-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {SCOPE_LABELS[candidate]}
                  {trimmedQuery ? ` (${activeResponse.counts[candidate]})` : ''}
                </button>
              ))}
            </div>
            {isLoading && <span className="text-muted-foreground">Searching…</span>}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
            {activeError ? (
              <p role="alert" className="text-sm text-destructive">{activeError}</p>
            ) : (
              <SearchResults
                response={activeResponse}
                activeIndex={activeIndex}
                onNavigate={closeDialog}
              />
            )}
          </div>

          {trimmedQuery && (
            <div className="flex items-center justify-between border-t px-4 py-2.5 text-xs text-muted-foreground">
              <span>Use ↑/↓ to select, Enter to open</span>
              <Link
                href={routes.searchWith(query, scope)}
                onClick={closeDialog}
                className="font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground"
              >
                Open search page ({activeResponse.total})
              </Link>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

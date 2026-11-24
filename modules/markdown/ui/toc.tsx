'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { MarkdownHeading } from '../headings'

type TableOfContentsProps = {
  headings: MarkdownHeading[]
  variant: 'sidebar' | 'inline'
}

// 目标标题使用 scroll-margin-top: var(--anchor-top)（5rem）。触发线略低于它，确保点击跳转后立即高亮。
const DEFAULT_ACTIVATION_OFFSET_PX = 96

function getActivationOffsetPx() {
  if (typeof window === 'undefined') return DEFAULT_ACTIVATION_OFFSET_PX
  const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  if (!Number.isFinite(rootFontSize) || rootFontSize <= 0) return DEFAULT_ACTIVATION_OFFSET_PX
  // 5rem（--anchor-top）再加 1rem 容差，容许子像素与字体微差。
  return rootFontSize * 6
}

export function pickActiveHeadingId(headings: MarkdownHeading[]): string | null {
  if (headings.length === 0 || typeof document === 'undefined') return null

  const offset = getActivationOffsetPx()
  let active: string | null = null

  for (const heading of headings) {
    const element = document.getElementById(heading.id)
    if (!element) continue
    if (element.getBoundingClientRect().top <= offset) {
      active = heading.id
    } else {
      break
    }
  }

  // 确实滚动到了可滚动页面底部时，最后一个很短的章节可能还没跨过顶部触发线；若它已在视口内则高亮它。
  const scrollable = document.documentElement.scrollHeight > window.innerHeight
  const reachedBottom = scrollable && window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
  if (reachedBottom) {
    for (let index = headings.length - 1; index >= 0; index -= 1) {
      const element = document.getElementById(headings[index].id)
      if (element && element.getBoundingClientRect().top < window.innerHeight) {
        return headings[index].id
      }
    }
  }

  return active
}

function HeadingList({
  headings,
  activeId,
  onSelect,
}: {
  headings: MarkdownHeading[]
  activeId: string | null
  onSelect: (id: string) => void
}) {
  return (
    <ol className="border-l border-border text-sm">
      {headings.map(heading => {
        const active = activeId === heading.id
        return (
          <li
            key={heading.id}
            className={cn(
              '-ml-px border-l-2 py-1',
              heading.depth === 3 ? 'pl-6' : 'pl-3',
              active ? 'border-foreground' : 'border-transparent',
            )}
          >
            <a
              href={`#${heading.id}`}
              aria-current={active ? 'location' : undefined}
              onClick={() => onSelect(heading.id)}
              className={cn(
                'block rounded-sm leading-snug transition-colors outline-offset-2 outline-ring focus-visible:outline-2 hover:text-foreground',
                active ? 'font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {heading.text}
            </a>
          </li>
        )
      })}
    </ol>
  )
}

/** 文章目录：宽屏停靠在阅读辅栏随滚动高亮当前章节，窄屏折叠在正文上方。 */
export function TableOfContents({ headings, variant }: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string | null>(() => headings[0]?.id ?? null)
  const detailsRef = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    if (headings.length === 0) return

    let frame = 0
    const sync = () => {
      frame = 0
      const next = pickActiveHeadingId(headings)
      setActiveId(next ?? headings[0]?.id ?? null)
    }
    const schedule = () => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(sync)
    }

    sync()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    window.addEventListener('hashchange', schedule)

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('hashchange', schedule)
    }
  }, [headings])

  if (headings.length === 0) return null

  if (variant === 'inline') {
    return (
      <details
        ref={detailsRef}
        className="group rounded-lg border border-border px-4 py-3"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium text-foreground outline-offset-4 outline-ring focus-visible:outline-2 [&::-webkit-details-marker]:hidden">
          <span>On this page</span>
          <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <nav aria-label="On this page" className="mt-3">
          <HeadingList
            headings={headings}
            activeId={activeId}
            onSelect={id => {
              setActiveId(id)
              if (detailsRef.current) detailsRef.current.open = false
            }}
          />
        </nav>
      </details>
    )
  }

  return (
    <nav aria-label="On this page">
      <h2 className="mb-3 text-xs font-medium text-muted-foreground">On this page</h2>
      <HeadingList
        headings={headings}
        activeId={activeId}
        onSelect={id => setActiveId(id)}
      />
    </nav>
  )
}

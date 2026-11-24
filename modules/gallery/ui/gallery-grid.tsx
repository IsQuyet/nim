'use client'

import { useState } from 'react'
import Link from 'next/link'
import { routes } from '@/lib/routes'
import type { PublishedGalleryItem } from '../model'
import { GalleryLightbox } from './lightbox'

type GalleryGridProps = {
  items: PublishedGalleryItem[]
  variant?: 'archive' | 'showcase'
}

const dateFormatter = new Intl.DateTimeFormat('en', {
  year: 'numeric',
  month: 'short',
  timeZone: 'UTC',
})

function formatMeta(item: PublishedGalleryItem) {
  const parts: string[] = []
  if (item.location) parts.push(item.location)
  if (item.takenAt) {
    parts.push(dateFormatter.format(new Date(`${item.takenAt}T00:00:00Z`)))
  } else {
    parts.push(dateFormatter.format(new Date(item.publishedAt)))
  }
  return parts.join(' · ')
}

/**
 * 画廊展示网格：`archive` 在 `/gallery` 按原始宽高比排布；`showcase` 在首页用 3 列 4:3 精选窗。
 */
export function GalleryGrid({ items, variant = 'archive' }: GalleryGridProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  if (items.length === 0) {
    return <p className="text-muted-foreground">No photos yet.</p>
  }

  return (
    <>
      {variant === 'showcase' ? (
        <ul aria-label="Featured gallery" className="grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3">
          {items.map((item, index) => (
            <li key={item.id} className="group space-y-2">
              <button
                type="button"
                onClick={() => setActiveIndex(index)}
                aria-label={`Preview ${item.title}`}
                className="block w-full cursor-zoom-in overflow-hidden rounded-xl border border-border/60 bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <div className="aspect-[4/3] w-full overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={routes.media(item.mediaId)}
                    alt={item.title}
                    width={item.media.width}
                    height={item.media.height}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                  />
                </div>
              </button>
              <div className="flex items-baseline justify-between gap-2 px-0.5">
                <Link
                  href={routes.galleryItem(item.id)}
                  className="truncate font-medium transition-colors hover:text-muted-foreground"
                >
                  {item.title}
                </Link>
                <span className="shrink-0 text-xs text-muted-foreground">{formatMeta(item)}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul aria-label="Gallery photos" className="columns-1 gap-6 space-y-6 sm:columns-2 md:columns-3">
          {items.map((item, index) => (
            <li key={item.id} className="break-inside-avoid space-y-2">
              <button
                type="button"
                onClick={() => setActiveIndex(index)}
                aria-label={`Preview ${item.title}`}
                className="block w-full cursor-zoom-in overflow-hidden rounded-xl border border-border/60 bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                style={{ aspectRatio: `${item.media.width} / ${item.media.height}` }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={routes.media(item.mediaId)}
                  alt={item.title}
                  width={item.media.width}
                  height={item.media.height}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 hover:scale-[1.015]"
                />
              </button>
              <div className="space-y-0.5 px-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <Link
                    href={routes.galleryItem(item.id)}
                    className="truncate font-medium transition-colors hover:text-muted-foreground"
                  >
                    {item.title}
                  </Link>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatMeta(item)}</span>
                </div>
                {item.caption && (
                  <p className="line-clamp-2 text-sm text-muted-foreground">{item.caption}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <GalleryLightbox
        items={items}
        activeIndex={activeIndex}
        onClose={() => setActiveIndex(null)}
        onSelectIndex={setActiveIndex}
      />
    </>
  )
}

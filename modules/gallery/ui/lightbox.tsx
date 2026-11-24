'use client'

import { useEffect } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import Link from 'next/link'
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { routes } from '@/lib/routes'
import type { PublishedGalleryItem } from '../model'

type GalleryLightboxProps = {
  items: PublishedGalleryItem[]
  activeIndex: number | null
  onClose: () => void
  onSelectIndex: (index: number) => void
}

const dateFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeZone: 'UTC',
})

/** 公开画廊与首页共用的全尺寸灯箱视图，支持键盘左右翻页与独立详情页跳转。 */
export function GalleryLightbox({
  items,
  activeIndex,
  onClose,
  onSelectIndex,
}: GalleryLightboxProps) {
  const active = activeIndex !== null ? items[activeIndex] ?? null : null
  const hasMultiple = items.length > 1

  useEffect(() => {
    if (activeIndex === null || !hasMultiple) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        onSelectIndex(activeIndex === 0 ? items.length - 1 : activeIndex! - 1)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        onSelectIndex(activeIndex === items.length - 1 ? 0 : activeIndex! + 1)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeIndex, hasMultiple, items.length, onSelectIndex])

  return (
    <DialogPrimitive.Root open={active !== null} onOpenChange={open => { if (!open) onClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-xs" />
        <DialogPrimitive.Content
          aria-describedby={active?.caption ? 'gallery-lightbox-caption' : undefined}
          className="fixed inset-3 z-50 m-auto flex max-h-[calc(100dvh-1.5rem)] max-w-5xl flex-col overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-xl sm:inset-6 sm:max-h-[calc(100dvh-3rem)]"
        >
          {active && activeIndex !== null && (
            <>
              <div className="flex items-center justify-between gap-4 border-b px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <DialogPrimitive.Title className="truncate font-medium">
                    {active.title}
                  </DialogPrimitive.Title>
                  {hasMultiple && (
                    <p className="text-xs text-muted-foreground">
                      {activeIndex + 1} / {items.length}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {hasMultiple && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Previous photo"
                        onClick={() => onSelectIndex(activeIndex === 0 ? items.length - 1 : activeIndex - 1)}
                      >
                        <ChevronLeftIcon />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Next photo"
                        onClick={() => onSelectIndex(activeIndex === items.length - 1 ? 0 : activeIndex + 1)}
                      >
                        <ChevronRightIcon />
                      </Button>
                    </>
                  )}
                  <DialogPrimitive.Close asChild>
                    <Button type="button" variant="ghost" size="icon" aria-label="Close lightbox">
                      <XIcon />
                    </Button>
                  </DialogPrimitive.Close>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/40 p-4 sm:p-6">
                {/* 保持原图宽高比展示，不走默认图片代理以与私有/缓存策略一致。 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={routes.media(active.mediaId)}
                  alt={active.title}
                  width={active.media.width}
                  height={active.media.height}
                  className="max-h-[62vh] w-auto max-w-full rounded-lg object-contain"
                />
              </div>

              <div className="flex flex-wrap items-end justify-between gap-4 border-t px-4 py-3 text-sm sm:px-5">
                <div className="min-w-0 space-y-1">
                  {active.caption && (
                    <p id="gallery-lightbox-caption" className="max-w-2xl text-foreground">
                      {active.caption}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {[
                      active.location || null,
                      active.takenAt ? dateFormatter.format(new Date(`${active.takenAt}T00:00:00Z`)) : null,
                      `${active.media.width}×${active.media.height}`,
                    ].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href={routes.galleryItem(active.id)} onClick={onClose}>
                    Open detail page
                  </Link>
                </Button>
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

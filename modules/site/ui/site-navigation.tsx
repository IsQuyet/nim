'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MenuIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { DESTINATIONS, isCurrent } from '../navigation'

// 页头从 md 起放得下精选栏目。更窄时全部栏目都在侧边导航里。
const everythingPinned = DESTINATIONS.every(destination => destination.pinned)

/** 页头里的精选栏目。 */
export function PinnedNavigation() {
  const pathname = usePathname()

  return (
    <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
      {DESTINATIONS.filter(destination => destination.pinned).map(destination => (
        <Link
          key={destination.href}
          href={destination.href}
          aria-current={isCurrent(destination, pathname) ? 'page' : undefined}
          className="rounded-full px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:text-foreground"
        >
          {destination.label}
        </Link>
      ))}
    </nav>
  )
}

/** 侧边导航：收着页头没有显示的栏目，没有这样的栏目时不出现开关。 */
export function NavigationDrawer({ title }: { title: string }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open navigation"
          className={cn('-ml-2', everythingPinned && 'md:hidden')}
        >
          <MenuIcon />
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetTitle>{title}</SheetTitle>
        <SheetDescription className="sr-only">Site sections</SheetDescription>
        <nav aria-label="All sections" className="flex flex-col gap-0.5">
          {DESTINATIONS.map(destination => (
            <Link
              key={destination.href}
              href={destination.href}
              aria-current={isCurrent(destination, pathname) ? 'page' : undefined}
              onClick={() => setOpen(false)}
              className={cn(
                'rounded-lg px-2.5 py-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground aria-[current=page]:text-foreground',
                destination.pinned && 'md:hidden',
              )}
            >
              {destination.label}
            </Link>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  )
}

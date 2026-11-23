import type { Route } from 'next'
import { routes } from '@/lib/routes'

export type Destination = {
  label: string
  href: Route
  /** 精选栏目在页头放得下时显示在页头，其余栏目收在侧边导航里。 */
  pinned: boolean
}

// 全站栏目的唯一清单。每个栏目同一时刻只出现在页头或侧边导航其中一处。
export const DESTINATIONS: Destination[] = [
  { label: 'Blog', href: routes.blog, pinned: true },
]

export function isCurrent(destination: Destination, pathname: string) {
  return pathname === destination.href || pathname.startsWith(`${destination.href}/`)
}

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** 聚焦版式：一件事占一条窄列，在画布内居中。 */
export function Focus({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="canvas py-10 md:py-16">
      <div className={cn('mx-auto max-w-160', className)}>{children}</div>
    </div>
  )
}

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** 页面主体占用的画布，页面在里面选用一种版式。 */
export function Canvas({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('canvas py-(--canvas-block-padding)', className)}>{children}</div>
}

/** 聚焦版式：一件事占一条窄列，在画布内居中。 */
export function Focus({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Canvas>
      <div className={cn('mx-auto max-w-160', className)}>{children}</div>
    </Canvas>
  )
}

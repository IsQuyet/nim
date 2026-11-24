import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// 主栏与辅栏在 12 列画布上的占位。窄于 md 时两栏上下排列。
const SPLITS = {
  /** 阅读：正文在前，辅栏靠右，放目录和针对这篇内容的操作。 */
  reading: { main: 'md:col-span-8 lg:col-span-7 lg:col-start-3', side: 'md:col-span-4 lg:col-span-3 lg:col-start-10', sideFirst: false },
  /** 工作区：编辑内容在前，辅栏靠右，放状态与操作。 */
  workspace: { main: 'md:col-span-8', side: 'md:col-span-4 lg:col-span-3 lg:col-start-10', sideFirst: false },
  /** 列表-详情：辅栏是列表，排在前面，主栏是选中项。 */
  'list-detail': { main: 'md:col-span-8 lg:col-span-9', side: 'md:col-span-4 lg:col-span-3', sideFirst: true },
}

type PanesProps = {
  split: keyof typeof SPLITS
  children: ReactNode
  /**
   * 辅栏内容。两栏并排时辅栏停靠在视口内，内容超出视口高度就在栏内滚动。
   * 只想让其中一段滚动时，给那一段加 `md:min-h-0 md:overflow-y-auto`。
   */
  side: ReactNode
  /** 需要整幅画布宽度的内容，排在两栏之后。 */
  wide?: ReactNode
  className?: string
}

/** 两栏版式。 */
export function Panes({ split, children, side, wide, className }: PanesProps) {
  const { main, side: sideSpan, sideFirst } = SPLITS[split]
  const sidePane = (
    <div data-pane="side" className={cn('col-span-full min-w-0 md:sticky md:top-(--canvas-top) md:self-start', sideSpan)}>
      {/* 滚动容器会裁掉贴边控件的焦点轮廓，四周各让出 4px。 */}
      <div className="md:-m-1 md:flex md:max-h-[calc(100dvh-var(--canvas-top)-var(--canvas-block-padding))] md:flex-col md:overflow-y-auto md:p-1">
        {side}
      </div>
    </div>
  )

  return (
    <div className={cn('canvas-grid gap-y-10', className)}>
      {sideFirst && sidePane}
      <div data-pane="main" className={cn('col-span-full min-w-0', main)}>
        {children}
      </div>
      {!sideFirst && sidePane}
      {wide && (
        <div data-pane="wide" className="col-span-full min-w-0">
          {wide}
        </div>
      )}
    </div>
  )
}

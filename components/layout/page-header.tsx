import type { ReactNode } from 'react'
import type { Route } from 'next'
import Link from 'next/link'
import { ChevronLeftIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

type PageHeaderProps<T extends string> = {
  title: string
  /** 返回上一级页面的链接，排在标题上方。 */
  back?: { href: Route<T>; label: string }
  description?: ReactNode
  /** 针对整个页面的操作，宽屏排在标题右侧。 */
  actions?: ReactNode
}

/** 页面主体顶部的标题区。 */
export function PageHeader<T extends string>({ title, back, description, actions }: PageHeaderProps<T>) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 md:mb-10">
      <div className="min-w-0 space-y-2">
        {back && (
          <Button asChild variant="quiet" size="text" className="flex w-fit gap-0.5">
            <Link href={back.href}>
              <ChevronLeftIcon className="-ml-1" />
              {back.label}
            </Link>
          </Button>
        )}
        <h1 className="text-2xl font-medium">{title}</h1>
        {description && <div className="max-w-160 space-y-2 text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

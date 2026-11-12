import type { ComponentPropsWithoutRef } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { highlight } from 'sugar-high'

function MarkdownCode({
  children,
  className,
}: ComponentPropsWithoutRef<'code'>) {
  return (
    <code
      className={className}
      dangerouslySetInnerHTML={{ __html: highlight(String(children)) }}
    />
  )
}

const components = {
  code: MarkdownCode,
} satisfies Components

type MarkdownContentProps = {
  source: string
}

export function MarkdownContent({ source }: MarkdownContentProps) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
      {source}
    </Markdown>
  )
}

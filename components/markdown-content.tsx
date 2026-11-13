import type { ComponentPropsWithoutRef } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSlug from 'rehype-slug'
import rehypeAutolinkHeadings, {
  type Options as HeadingLinkOptions,
} from 'rehype-autolink-headings'
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

const headingLinkOptions = {
  behavior: 'append',
  test: heading => heading.position !== undefined,
  content: { type: 'text', value: '#' },
  properties: {
    className: ['markdown-heading-anchor', 'not-prose'],
    ariaLabel: 'Link to this section',
  },
} satisfies HeadingLinkOptions

type MarkdownContentProps = {
  source: string
}

export function MarkdownContent({ source }: MarkdownContentProps) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSlug, [rehypeAutolinkHeadings, headingLinkOptions]]}
      components={components}
      skipHtml
    >
      {source}
    </Markdown>
  )
}

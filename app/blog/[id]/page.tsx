import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Canvas } from '@/components/layout/canvas'
import { Panes } from '@/components/layout/panes'
import { ScrollProgress } from '@/components/ui/scroll-progress'
import { MarkdownContent } from '@/modules/markdown/server/content'
import { extractMarkdownHeadings } from '@/modules/markdown/headings'
import { MarkdownProse } from '@/modules/markdown/ui/prose'
import { TableOfContents } from '@/modules/markdown/ui/toc'
import { getBlogPost } from '@/modules/posts/server/public'
import { PostActions } from '@/modules/posts/ui/post-actions'
import { routes } from '@/lib/routes'

type BlogPostPageProps = {
  params: Promise<{ id: string }>
}

const dateFormatter = new Intl.DateTimeFormat('en', {
  dateStyle: 'long',
  timeZone: 'UTC',
})

export async function generateMetadata({
  params,
}: BlogPostPageProps): Promise<Metadata> {
  const { id } = await params
  const post = await getBlogPost(id)
  if (!post) notFound()

  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: routes.post(post.id) },
  }
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { id } = await params
  const post = await getBlogPost(id)
  if (!post) notFound()
  const headings = extractMarkdownHeadings(post.body)

  return (
    <>
      <ScrollProgress className="fixed top-0 z-50 h-0.5 bg-foreground/30" springOptions={{ bounce: 0 }} />
      <Canvas>
        <Panes
          split="reading"
          side={
            <>
              {headings.length > 0 && (
                <div className="hidden md:block md:min-h-0 md:overflow-y-auto md:pb-6">
                  <TableOfContents headings={headings} variant="sidebar" />
                </div>
              )}
              <div className={headings.length > 0 ? 'shrink-0 md:border-t md:pt-6' : 'shrink-0'}>
                <PostActions postId={post.id} />
              </div>
            </>
          }
        >
          <time dateTime={post.publishedAt} className="mb-6 block text-sm text-muted-foreground">
            {dateFormatter.format(new Date(post.publishedAt))}
          </time>
          {headings.length > 0 && (
            <div className="mb-8 max-w-160 md:hidden">
              <TableOfContents headings={headings} variant="inline" />
            </div>
          )}
          <MarkdownProse as="main" className="max-w-160">
            <MarkdownContent source={post.body} />
          </MarkdownProse>
        </Panes>
      </Canvas>
    </>
  )
}

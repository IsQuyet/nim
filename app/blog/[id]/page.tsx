import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Canvas } from '@/components/layout/canvas'
import { Panes } from '@/components/layout/panes'
import { ScrollProgress } from '@/components/ui/scroll-progress'
import { MarkdownContent } from '@/modules/markdown/server/content'
import { MarkdownProse } from '@/modules/markdown/ui/prose'
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

  return (
    <>
      <ScrollProgress className="fixed top-0 z-50 h-0.5 bg-foreground/30" springOptions={{ bounce: 0 }} />
      <Canvas>
        <Panes split="reading" side={<PostActions postId={post.id} />}>
          <time dateTime={post.publishedAt} className="mb-6 block text-sm text-muted-foreground">
            {dateFormatter.format(new Date(post.publishedAt))}
          </time>
          <MarkdownProse as="main" className="max-w-160">
            <MarkdownContent source={post.body} />
          </MarkdownProse>
        </Panes>
      </Canvas>
    </>
  )
}

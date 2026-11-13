import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MarkdownContent } from '@/components/markdown-content'
import { getBlogPost } from '@/lib/blog'

type BlogPostPageProps = {
  params: Promise<{ id: string }>
}

export async function generateMetadata({
  params,
}: BlogPostPageProps): Promise<Metadata> {
  const { id } = await params
  const post = await getBlogPost(id)
  if (!post) notFound()

  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${post.id}` },
  }
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { id } = await params
  const post = await getBlogPost(id)
  if (!post) notFound()

  return <MarkdownContent source={post.body} />
}

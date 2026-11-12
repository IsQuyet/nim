import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { BLOG_POSTS } from '@/app/data'
import { MarkdownContent } from '@/components/markdown-content'
import { getBlogPost } from '@/lib/blog'

type BlogPostPageProps = {
  params: Promise<{ slug: string }>
}

export function generateStaticParams() {
  return BLOG_POSTS.map(post => ({
    slug: post.link.slice('/blog/'.length),
  }))
}

export async function generateMetadata({
  params,
}: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params
  const post = await getBlogPost(slug)
  if (!post) notFound()

  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: post.link },
  }
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const { slug } = await params
  const post = await getBlogPost(slug)
  if (!post) notFound()

  return <MarkdownContent source={post.body} />
}

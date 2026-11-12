import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { cache } from 'react'
import { BLOG_POSTS } from '@/app/data'

export const getBlogPost = cache(async (slug: string) => {
  const post = BLOG_POSTS.find(post => post.link === `/blog/${slug}`)
  if (!post) return null

  const body = await readFile(
    join(process.cwd(), 'content', 'blog', `${slug}.md`),
    'utf8',
  )

  return { ...post, body }
})

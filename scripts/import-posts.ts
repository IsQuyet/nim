import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnvConfig } from '@next/env'
import { BLOG_POSTS } from '../app/data'
import { openDatabase } from '../lib/database'
import { importPublishedPosts } from '../lib/posts'

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production')

const posts = BLOG_POSTS.map(post => {
  const slug = post.link.slice('/blog/'.length)

  return {
    slug,
    title: post.title,
    description: post.description,
    body: readFileSync(join(process.cwd(), 'content', 'blog', `${slug}.md`), 'utf8'),
  }
})
const database = openDatabase()

try {
  const { imported, skipped } = importPublishedPosts(database, posts)
  console.log(`文章导入完成：新增 ${imported} 篇，跳过已有 ${skipped} 篇。`)
} finally {
  database.close()
}

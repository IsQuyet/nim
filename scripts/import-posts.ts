import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnvConfig } from '@next/env'
import { BLOG_POST_SOURCES } from '../app/data'
import { openDatabase } from '../lib/server/database'
import { importPublishedPosts } from '../lib/posts'

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production')

const posts = BLOG_POST_SOURCES.map(post => ({
  id: post.id,
  title: post.title,
  description: post.description,
  body: readFileSync(join(process.cwd(), 'content', 'blog', post.file), 'utf8'),
}))
const database = openDatabase()

try {
  const { imported, skipped } = importPublishedPosts(database, posts)
  console.log(`文章导入完成：新增 ${imported} 篇，跳过已有 ${skipped} 篇。`)
} finally {
  database.$client.close()
}

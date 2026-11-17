import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnvConfig } from '@next/env'
import { BLOG_POST_SOURCES } from '../app/data'
import { withDatabase } from '../lib/server/database'
import { importPublishedPosts } from '../modules/posts/server/store'

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production')

const posts = BLOG_POST_SOURCES.map(post => ({
  id: post.id,
  title: post.title,
  description: post.description,
  body: readFileSync(join(process.cwd(), 'content', 'blog', post.file), 'utf8'),
}))

withDatabase(database => importPublishedPosts(database, posts))
  .then(({ imported, skipped }) => {
    console.log(`文章导入完成：新增 ${imported} 篇，跳过已有 ${skipped} 篇。`)
  })
  .catch(error => {
    console.error('文章导入失败。', error)
    process.exitCode = 1
  })

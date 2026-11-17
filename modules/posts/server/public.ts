import 'server-only'
import { cache } from 'react'
import { connection } from 'next/server'
import { withDatabase } from '@/lib/server/database'
import { createPostStore } from './store'

export const getBlogPost = cache(async (id: string) => {
  // 同步 SQLite 查询本身不会退出预渲染，须先等待请求再读库。
  await connection()
  return withDatabase(database => createPostStore(database).getPublishedPost(id))
})

export const getBlogPosts = cache(async () => {
  await connection()
  return withDatabase(database => createPostStore(database).listPublishedPosts())
})

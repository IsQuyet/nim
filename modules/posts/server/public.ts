import 'server-only'
import { cache } from 'react'
import { connection } from 'next/server'
import { withDatabase } from '@/lib/server/database'
import { createPostStore } from './store'

export const getBlogPost = cache(async (id: string) => {
  // 先等待进入真实请求生命周期，避免构建预渲染期间访问数据库。
  await connection()
  return withDatabase(database => createPostStore(database).getPublishedPost(id))
})

export const getBlogPosts = cache(async () => {
  await connection()
  return withDatabase(database => createPostStore(database).listPublishedPosts())
})

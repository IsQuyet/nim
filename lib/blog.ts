import 'server-only'
import { cache } from 'react'
import { connection } from 'next/server'
import { openDatabase } from './database'
import { createPostStore } from './posts'

export const getBlogPost = cache(async (id: string) => {
  // 同步 SQLite 查询本身不会退出预渲染，须先等待请求再读库。
  await connection()
  const database = openDatabase()

  try {
    return createPostStore(database).getPublishedPost(id)
  } finally {
    database.$client.close()
  }
})

export const getBlogPosts = cache(async () => {
  await connection()
  const database = openDatabase()

  try {
    return createPostStore(database).listPublishedPosts()
  } finally {
    database.$client.close()
  }
})

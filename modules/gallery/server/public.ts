import 'server-only'
import { cache } from 'react'
import { connection } from 'next/server'
import { withDatabase } from '@/lib/server/database'
import { createGalleryStore } from './store'

export const getGalleryItems = cache(async () => {
  await connection()
  return withDatabase(database => createGalleryStore(database).listPublished())
})

export const getGalleryItem = cache(async (id: string) => {
  await connection()
  return withDatabase(database => createGalleryStore(database).getPublished(id))
})

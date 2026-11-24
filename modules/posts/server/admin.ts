import 'server-only'
import { redirect } from 'next/navigation'
import { withAdmin } from '@/modules/auth/server/admin'
import { revisionHistoryQuerySchema } from '../history'
import { getMediaDirectory } from '@/lib/server/data-paths'
import { withDatabase, type AppDatabase } from '@/lib/server/database'
import { createFileMediaStorage, type MediaStorage } from '@/modules/media/server/storage'
import { createPostStore, type PostStore } from './store'
import { createWritingStore } from './writing-store'
import type { WritingStore } from '../writing'
import { listAdminMedia } from './media-admin'
import { routes } from '@/lib/routes'

export function withAdminPostStore<T>(operation: (store: PostStore) => T) {
  return withAdmin(() => withDatabase(database => operation(createPostStore(database))))
}

export function withAdminWritingStore<T>(operation: (store: WritingStore) => T) {
  return withAdmin(() => withDatabase(database => operation(createWritingStore(database))))
}

export function withAdminMediaDatabase<T>(operation: (database: AppDatabase, storage: MediaStorage) => Promise<T> | T) {
  return withAdmin(() => withDatabase(database => operation(database, createFileMediaStorage(getMediaDirectory()))))
}

export async function getAdminPosts() {
  const result = await withAdminPostStore(store => store.listPosts())
  if (!result.authorized) redirect(routes.admin.login)
  return result.value
}

export async function getAdminMedia() {
  const result = await withAdminMediaDatabase((database, storage) => listAdminMedia(database, storage))
  if (!result.authorized) redirect(routes.admin.login)
  return result.value
}

export async function getAdminDraft(id: string) {
  const result = await withAdminPostStore(store => store.getDraft(id))
  if (!result.authorized) redirect(routes.admin.login)
  return result.value
}

export async function getAdminRevisionHistory(id: string, query: unknown = {}) {
  const result = await withAdminPostStore(store => {
    const parsed = revisionHistoryQuerySchema.safeParse(query)
    return parsed.success ? store.getRevisionHistory(id, parsed.data) : null
  })
  if (!result.authorized) redirect(routes.admin.login)
  return result.value
}

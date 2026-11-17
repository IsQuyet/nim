import 'server-only'
import { redirect } from 'next/navigation'
import { getAdminSession } from '@/modules/auth/server/auth'
import { revisionHistoryQuerySchema, type PostStore } from '../model'
import { withDatabase, type AppDatabase } from '@/lib/server/database'
import { createPostStore } from './store'
import { createWritingStore } from './writing-store'
import type { WritingStore } from '../writing'

type AdminPostStoreResult<T> =
  | { authorized: false }
  | { authorized: true; value: T }

async function withAdminDatabase<T>(
  operation: (database: AppDatabase) => T,
): Promise<AdminPostStoreResult<Awaited<T>>> {
  if (!(await getAdminSession())) return { authorized: false }
  return { authorized: true, value: await withDatabase(operation) }
}

export function withAdminPostStore<T>(operation: (store: PostStore) => T) {
  return withAdminDatabase(database => operation(createPostStore(database)))
}

export function withAdminWritingStore<T>(operation: (store: WritingStore) => T) {
  return withAdminDatabase(database => operation(createWritingStore(database)))
}

export async function getAdminPosts() {
  const result = await withAdminPostStore(store => store.listPosts())
  if (!result.authorized) redirect('/admin/login')
  return result.value
}

export async function getAdminDraft(id: string) {
  const result = await withAdminPostStore(store => store.getDraft(id))
  if (!result.authorized) redirect('/admin/login')
  return result.value
}

export async function getAdminRevisionHistory(id: string, query: unknown = {}) {
  const result = await withAdminPostStore(store => {
    const parsed = revisionHistoryQuerySchema.safeParse(query)
    return parsed.success ? store.getRevisionHistory(id, parsed.data) : null
  })
  if (!result.authorized) redirect('/admin/login')
  return result.value
}

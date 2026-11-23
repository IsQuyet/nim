import 'server-only'
import { redirect } from 'next/navigation'
import { withAdmin } from '@/modules/auth/server/admin'
import { revisionHistoryQuerySchema } from '../history'
import { withDatabase } from '@/lib/server/database'
import { createPostStore, type PostStore } from './store'
import { createWritingStore } from './writing-store'
import type { WritingStore } from '../writing'
import { routes } from '@/lib/routes'

export function withAdminPostStore<T>(operation: (store: PostStore) => T) {
  return withAdmin(() => withDatabase(database => operation(createPostStore(database))))
}

export function withAdminWritingStore<T>(operation: (store: WritingStore) => T) {
  return withAdmin(() => withDatabase(database => operation(createWritingStore(database))))
}

export async function getAdminPosts() {
  const result = await withAdminPostStore(store => store.listPosts())
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

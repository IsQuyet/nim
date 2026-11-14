import 'server-only'
import { redirect } from 'next/navigation'
import { getAdminSession } from './auth'
import { revisionHistoryQuerySchema, type PostStore } from './content'
import { openDatabase } from './database'
import { createPostStore } from './posts'

type AdminPostStoreResult<T> =
  | { authorized: false }
  | { authorized: true; value: T }

export async function withAdminPostStore<T>(
  operation: (store: PostStore) => T,
): Promise<AdminPostStoreResult<Awaited<T>>> {
  if (!(await getAdminSession())) return { authorized: false }

  const database = openDatabase()
  try {
    return { authorized: true, value: await operation(createPostStore(database)) }
  } finally {
    database.$client.close()
  }
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

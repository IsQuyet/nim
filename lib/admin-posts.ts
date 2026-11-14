import 'server-only'
import { unstable_rethrow } from 'next/navigation'
import { requireAdminSession } from './auth'
import { openDatabase } from './database'
import { createPostStore } from './posts'

export class AdminPostStoreError extends Error {
  constructor(cause: unknown) {
    super('管理数据访问失败。', { cause })
    this.name = 'AdminPostStoreError'
  }
}

export async function withAdminPostStore<T>(
  operation: (store: ReturnType<typeof createPostStore>) => T,
): Promise<T> {
  try {
    await requireAdminSession()
    const database = openDatabase()
    try {
      return operation(createPostStore(database))
    } finally {
      database.close()
    }
  } catch (error) {
    unstable_rethrow(error)
    throw new AdminPostStoreError(error)
  }
}

export async function getAdminPosts() {
  return withAdminPostStore((store) => store.listPosts())
}

export async function getAdminDraft(id: string) {
  return withAdminPostStore((store) => store.getDraft(id))
}

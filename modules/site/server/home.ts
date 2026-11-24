import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { routes } from '@/lib/routes'
import { withDatabase } from '@/lib/server/database'
import { withAdmin } from '@/modules/auth/server/admin'
import { createHomeStore, type HomeStore } from './home-store'

export const getHomepageData = cache(async () => {
  await connection()
  return withDatabase(database => createHomeStore(database).getPublicHomepage())
})

export function withAdminHomeStore<T>(operation: (store: HomeStore) => T) {
  return withAdmin(() => withDatabase(database => operation(createHomeStore(database))))
}

export async function getAdminHomepageData() {
  const result = await withAdminHomeStore(store => store.getAdminHomepage())
  if (!result.authorized) redirect(routes.admin.login)
  return result.value
}

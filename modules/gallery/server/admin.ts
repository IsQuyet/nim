import 'server-only'
import { redirect } from 'next/navigation'
import { withAdmin } from '@/modules/auth/server/admin'
import { withDatabase } from '@/lib/server/database'
import { createMediaStore } from '@/modules/media/server/store'
import { createConfiguredMediaStorage } from '@/modules/media/server/storage'
import { routes } from '@/lib/routes'
import { createGalleryStore, type GalleryStore } from './store'

export function withAdminGalleryStore<T>(operation: (store: GalleryStore) => Promise<T> | T) {
  return withAdmin(() => withDatabase(database => operation(createGalleryStore(database))))
}

export async function getAdminGallery() {
  const result = await withAdmin(() =>
    withDatabase(async database => {
      const [items, assets] = await Promise.all([
        createGalleryStore(database).listAll(),
        createMediaStore(database, createConfiguredMediaStorage()).list(),
      ])
      return { items, assets: assets.filter(asset => asset.state === 'ready') }
    }),
  )
  if (!result.authorized) redirect(routes.admin.login)
  return result.value
}

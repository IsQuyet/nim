import 'server-only'
import { redirect } from 'next/navigation'
import { withAdmin } from '@/modules/auth/server/admin'
import { withDatabase } from '@/lib/server/database'
import { createMediaStore } from '@/modules/media/server/store'
import { createFileMediaStorage } from '@/modules/media/server/storage'
import { getMediaDirectory } from '@/lib/server/data-paths'
import { routes } from '@/lib/routes'
import { createGalleryStore, type GalleryStore } from './store'

export function withAdminGalleryStore<T>(operation: (store: GalleryStore) => T) {
  return withAdmin(() => withDatabase(database => operation(createGalleryStore(database))))
}

export async function getAdminGallery() {
  const result = await withAdmin(() =>
    withDatabase(database => {
      const items = createGalleryStore(database).listAll()
      const assets = createMediaStore(database, createFileMediaStorage(getMediaDirectory()))
        .list()
        .filter(asset => asset.state === 'ready')
      return { items, assets }
    }),
  )
  if (!result.authorized) redirect(routes.admin.login)
  return result.value
}

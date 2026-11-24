import 'server-only'
import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { routes } from '@/lib/routes'
import { getMediaDirectory } from '@/lib/server/data-paths'
import { withDatabase, type AppDatabase } from '@/lib/server/database'
import { withAdmin } from '@/modules/auth/server/admin'
import {
  findGalleryMediaBlocker,
  isGalleryMediaPublished,
  listGalleryMediaReferences,
} from '@/modules/gallery/server/media'
import { mediaIdSchema, type MediaAsset } from '@/modules/media/model'
import { mediaAssets } from '@/modules/media/server/schema'
import { createFileMediaStorage, type MediaStorage } from '@/modules/media/server/storage'
import { createMediaStore } from '@/modules/media/server/store'
import {
  findPostMediaBlocker,
  listPostMediaReferences,
  type DeleteMediaResult,
} from '@/modules/posts/server/media-admin'
import { isMediaPublished as isPostMediaPublished } from '@/modules/posts/server/storage'
import type { SiteMediaItem } from '../media'

/** 判断媒体资产是否在公开文章或公开画廊中被引用，决定匿名访客是否可读取 `/media/[id]`。 */
export function isSiteMediaPublished(database: AppDatabase, mediaId: string) {
  return isPostMediaPublished(database, mediaId) || isGalleryMediaPublished(database, mediaId)
}

export function listSiteAdminMedia(database: AppDatabase, storage: MediaStorage): SiteMediaItem[] {
  return database.transaction(transaction => {
    const assets = createMediaStore(transaction as unknown as AppDatabase, storage).list()
    if (assets.length === 0) return []

    const postsByMedia = listPostMediaReferences(transaction)
    const galleryByMedia = listGalleryMediaReferences(transaction)

    return assets.map(asset => {
      const postReferences = Array.from(postsByMedia.get(asset.id)?.values() ?? []).sort((left, right) => {
        if (left.inPublished !== right.inPublished) return left.inPublished ? -1 : 1
        if (left.inDraft !== right.inDraft) return left.inDraft ? -1 : 1
        return left.title.localeCompare(right.title)
      })
      const galleryReferences = galleryByMedia.get(asset.id) ?? []
      return { asset, postReferences, galleryReferences }
    })
  }, { behavior: 'deferred' })
}

export async function deleteSiteAdminMedia(
  database: AppDatabase,
  storage: MediaStorage,
  candidateId: unknown,
): Promise<DeleteMediaResult> {
  const parsed = mediaIdSchema.safeParse(candidateId)
  if (!parsed.success) return { status: 'invalid', message: 'Invalid media ID.' }
  const id = parsed.data

  const removed = database.transaction(
    (transaction): { status: 'deleted'; asset: MediaAsset } | Exclude<DeleteMediaResult, { status: 'success' }> => {
      const asset = createMediaStore(transaction as unknown as AppDatabase, storage).get(id)
      if (!asset) return { status: 'missing' }

      const postBlocker = findPostMediaBlocker(transaction, id)
      if (postBlocker) return { status: 'referenced', message: postBlocker }

      const galleryBlocker = findGalleryMediaBlocker(transaction, id)
      if (galleryBlocker) return { status: 'referenced', message: galleryBlocker }

      transaction.delete(mediaAssets).where(eq(mediaAssets.id, id)).run()
      return { status: 'deleted', asset }
    },
    { behavior: 'immediate' },
  )

  if (removed.status !== 'deleted') return removed
  await storage.remove(removed.asset)
  return { status: 'success', id }
}

export function withAdminSiteMediaDatabase<T>(
  operation: (database: AppDatabase, storage: MediaStorage) => Promise<T> | T,
) {
  return withAdmin(() => withDatabase(database => operation(database, createFileMediaStorage(getMediaDirectory()))))
}

export async function getSiteAdminMedia() {
  const result = await withAdminSiteMediaDatabase((database, storage) => listSiteAdminMedia(database, storage))
  if (!result.authorized) redirect(routes.admin.login)
  return result.value
}

import 'server-only'
import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { routes } from '@/lib/routes'
import { withDatabase, type AppDatabase } from '@/lib/server/database'
import { withAdmin } from '@/modules/auth/server/admin'
import {
  findGalleryMediaBlocker,
  isGalleryMediaPublished,
  listGalleryMediaReferences,
} from '@/modules/gallery/server/media'
import { mediaIdSchema, type MediaAsset } from '@/modules/media/model'
import { mediaAssets } from '@/modules/media/server/schema'
import { createConfiguredMediaStorage, type MediaStorage } from '@/modules/media/server/storage'
import { createMediaStore } from '@/modules/media/server/store'
import {
  findPostMediaBlocker,
  listPostMediaReferences,
  type DeleteMediaResult,
} from '@/modules/posts/server/media-admin'
import { isMediaPublished as isPostMediaPublished } from '@/modules/posts/server/storage'
import type { SiteMediaItem } from '../media'

/** 判断媒体资产是否在公开文章或公开画廊中被引用，决定匿名访客是否可读取 `/media/[id]`。 */
export async function isSiteMediaPublished(database: AppDatabase, mediaId: string) {
  return (await isPostMediaPublished(database, mediaId)) || (await isGalleryMediaPublished(database, mediaId))
}

export async function listSiteAdminMedia(database: AppDatabase, storage: MediaStorage): Promise<SiteMediaItem[]> {
  return database.transaction(async transaction => {
    const assets = await createMediaStore(transaction as unknown as AppDatabase, storage).list()
    if (assets.length === 0) return []

    const [postsByMedia, galleryByMedia] = await Promise.all([
      listPostMediaReferences(transaction),
      listGalleryMediaReferences(transaction),
    ])

    return assets.map(asset => {
      const postReferences = Array.from(postsByMedia.get(asset.id)?.values() ?? []).sort((left, right) => {
        if (left.inPublished !== right.inPublished) return left.inPublished ? -1 : 1
        if (left.inDraft !== right.inDraft) return left.inDraft ? -1 : 1
        return left.title.localeCompare(right.title)
      })
      const galleryReferences = galleryByMedia.get(asset.id) ?? []
      return { asset, postReferences, galleryReferences }
    })
  })
}

export async function deleteSiteAdminMedia(
  database: AppDatabase,
  storage: MediaStorage,
  candidateId: unknown,
): Promise<DeleteMediaResult> {
  const parsed = mediaIdSchema.safeParse(candidateId)
  if (!parsed.success) return { status: 'invalid', message: 'Invalid media ID.' }
  const id = parsed.data

  const removed = await database.transaction(
    async (transaction): Promise<{ status: 'deleted'; asset: MediaAsset } | Exclude<DeleteMediaResult, { status: 'success' }>> => {
      await transaction
        .select({ id: mediaAssets.id })
        .from(mediaAssets)
        .where(eq(mediaAssets.id, id))
        .for('update')
        .limit(1)
      const asset = await createMediaStore(transaction as unknown as AppDatabase, storage).get(id)
      if (!asset) return { status: 'missing' }

      const postBlocker = await findPostMediaBlocker(transaction, id)
      if (postBlocker) return { status: 'referenced', message: postBlocker }

      const galleryBlocker = await findGalleryMediaBlocker(transaction, id)
      if (galleryBlocker) return { status: 'referenced', message: galleryBlocker }

      await transaction.delete(mediaAssets).where(eq(mediaAssets.id, id))
      return { status: 'deleted', asset }
    },
  )

  if (removed.status !== 'deleted') return removed
  await storage.remove(removed.asset)
  return { status: 'success', id }
}

export function withAdminSiteMediaDatabase<T>(
  operation: (database: AppDatabase, storage: MediaStorage) => Promise<T> | T,
) {
  return withAdmin(() => withDatabase(database => operation(database, createConfiguredMediaStorage())))
}

export async function getSiteAdminMedia() {
  const result = await withAdminSiteMediaDatabase((database, storage) => listSiteAdminMedia(database, storage))
  if (!result.authorized) redirect(routes.admin.login)
  return result.value
}

import { and, asc, eq } from 'drizzle-orm'
import type { AppDatabase } from '@/lib/server/database'
import type { GalleryMediaReference } from '../model'
import { galleryItems } from './schema'

type GalleryDatabase = Pick<AppDatabase, 'select'>

/** 判断图片资源是否被至少一条已发布画廊作品引用，供媒体路由决定是否对外公开。 */
export function isGalleryMediaPublished(database: GalleryDatabase, mediaId: string) {
  return database
    .select({ id: galleryItems.id })
    .from(galleryItems)
    .where(and(eq(galleryItems.mediaId, mediaId), eq(galleryItems.status, 'published')))
    .limit(1)
    .get() !== undefined
}

/** 按媒体 ID 汇总画廊作品引用情况。 */
export function listGalleryMediaReferences(database: GalleryDatabase) {
  const rows = database
    .select({
      mediaId: galleryItems.mediaId,
      galleryId: galleryItems.id,
      title: galleryItems.title,
      status: galleryItems.status,
    })
    .from(galleryItems)
    .orderBy(asc(galleryItems.title), asc(galleryItems.id))
    .all()

  const byMedia = new Map<string, GalleryMediaReference[]>()
  for (const row of rows) {
    let entries = byMedia.get(row.mediaId)
    if (!entries) {
      entries = []
      byMedia.set(row.mediaId, entries)
    }
    entries.push({
      galleryId: row.galleryId,
      title: row.title,
      status: row.status,
    })
  }
  return byMedia
}

/** 若媒体仍被画廊条目引用，返回阻止删除的提示信息。 */
export function findGalleryMediaBlocker(database: GalleryDatabase, mediaId: string): string | null {
  const referenced = database
    .select({ id: galleryItems.id, status: galleryItems.status })
    .from(galleryItems)
    .where(eq(galleryItems.mediaId, mediaId))
    .all()

  if (referenced.length === 0) return null
  if (referenced.some(item => item.status === 'published')) {
    return 'This image is used by published gallery items and cannot be deleted.'
  }
  return 'Remove this image from gallery drafts before deleting.'
}

import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq } from 'drizzle-orm'
import type { AppDatabase } from '@/lib/server/database'
import { mediaAssets } from '@/modules/media/server/schema'
import type {
  GalleryItem,
  GalleryStatus,
  ParsedGalleryItemInput,
  PublishedGalleryItem,
} from '../model'
import { galleryItems } from './schema'

export type SaveGalleryResult =
  | { status: 'success'; item: GalleryItem }
  | { status: 'missing' }
  | { status: 'invalid'; message: string }

export type SetGalleryStatusResult =
  | { status: 'success'; item: GalleryItem }
  | { status: 'missing' }
  | { status: 'invalid'; message: string }

export type DeleteGalleryResult =
  | { status: 'success'; id: string }
  | { status: 'missing' }

export type GalleryStore = {
  listPublished(): PublishedGalleryItem[]
  getPublished(id: string): PublishedGalleryItem | null
  listAll(): GalleryItem[]
  get(id: string): GalleryItem | null
  save(input: ParsedGalleryItemInput): SaveGalleryResult
  setStatus(id: string, status: GalleryStatus): SetGalleryStatusResult
  remove(id: string): DeleteGalleryResult
}

function gallerySelection() {
  return {
    id: galleryItems.id,
    mediaId: galleryItems.mediaId,
    title: galleryItems.title,
    caption: galleryItems.caption,
    location: galleryItems.location,
    takenAt: galleryItems.takenAt,
    status: galleryItems.status,
    createdAt: galleryItems.createdAt,
    updatedAt: galleryItems.updatedAt,
    publishedAt: galleryItems.publishedAt,
    media: {
      id: mediaAssets.id,
      originalName: mediaAssets.originalName,
      mediaType: mediaAssets.mediaType,
      width: mediaAssets.width,
      height: mediaAssets.height,
    },
  }
}

export function createGalleryStore(database: AppDatabase): GalleryStore {
  function get(id: string): GalleryItem | null {
    return (
      database
        .select(gallerySelection())
        .from(galleryItems)
        .innerJoin(mediaAssets, eq(mediaAssets.id, galleryItems.mediaId))
        .where(eq(galleryItems.id, id))
        .get() ?? null
    )
  }

  function listAll(): GalleryItem[] {
    return database
      .select(gallerySelection())
      .from(galleryItems)
      .innerJoin(mediaAssets, eq(mediaAssets.id, galleryItems.mediaId))
      .orderBy(desc(galleryItems.updatedAt), asc(galleryItems.id))
      .all()
  }

  function listPublished(): PublishedGalleryItem[] {
    return database
      .select(gallerySelection())
      .from(galleryItems)
      .innerJoin(mediaAssets, eq(mediaAssets.id, galleryItems.mediaId))
      .where(eq(galleryItems.status, 'published'))
      .orderBy(desc(galleryItems.publishedAt), asc(galleryItems.id))
      .all()
      .filter((item): item is PublishedGalleryItem => item.status === 'published' && item.publishedAt !== null)
  }

  function getPublished(id: string): PublishedGalleryItem | null {
    const row = database
      .select(gallerySelection())
      .from(galleryItems)
      .innerJoin(mediaAssets, eq(mediaAssets.id, galleryItems.mediaId))
      .where(and(eq(galleryItems.id, id), eq(galleryItems.status, 'published')))
      .get()
    if (!row || row.status !== 'published' || !row.publishedAt) return null
    return row as PublishedGalleryItem
  }

  function save(input: ParsedGalleryItemInput): SaveGalleryResult {
    return database.transaction((transaction): SaveGalleryResult => {
      const asset = transaction
        .select({ id: mediaAssets.id, state: mediaAssets.state })
        .from(mediaAssets)
        .where(eq(mediaAssets.id, input.mediaId))
        .get()
      if (!asset || asset.state !== 'ready') {
        return { status: 'invalid', message: 'Choose a ready uploaded image before saving.' }
      }

      const now = new Date().toISOString()
      if (input.id) {
        const existing = transaction
          .select({ id: galleryItems.id, status: galleryItems.status, publishedAt: galleryItems.publishedAt })
          .from(galleryItems)
          .where(eq(galleryItems.id, input.id))
          .get()
        if (!existing) return { status: 'missing' }

        const publishedAt =
          input.status === 'published' ? (existing.publishedAt ?? now) : null

        transaction
          .update(galleryItems)
          .set({
            mediaId: input.mediaId,
            title: input.title,
            caption: input.caption,
            location: input.location,
            takenAt: input.takenAt,
            status: input.status,
            updatedAt: now,
            publishedAt,
          })
          .where(eq(galleryItems.id, input.id))
          .run()

        const updated = transaction
          .select(gallerySelection())
          .from(galleryItems)
          .innerJoin(mediaAssets, eq(mediaAssets.id, galleryItems.mediaId))
          .where(eq(galleryItems.id, input.id))
          .get()
        return updated ? { status: 'success', item: updated } : { status: 'missing' }
      }

      const id = randomUUID()
      const publishedAt = input.status === 'published' ? now : null
      transaction
        .insert(galleryItems)
        .values({
          id,
          mediaId: input.mediaId,
          title: input.title,
          caption: input.caption,
          location: input.location,
          takenAt: input.takenAt,
          status: input.status,
          createdAt: now,
          updatedAt: now,
          publishedAt,
        })
        .run()

      const created = transaction
        .select(gallerySelection())
        .from(galleryItems)
        .innerJoin(mediaAssets, eq(mediaAssets.id, galleryItems.mediaId))
        .where(eq(galleryItems.id, id))
        .get()
      return created ? { status: 'success', item: created } : { status: 'missing' }
    }, { behavior: 'immediate' })
  }

  function setStatus(id: string, status: GalleryStatus): SetGalleryStatusResult {
    return database.transaction((transaction): SetGalleryStatusResult => {
      const existing = transaction
        .select({
          id: galleryItems.id,
          mediaId: galleryItems.mediaId,
          publishedAt: galleryItems.publishedAt,
        })
        .from(galleryItems)
        .where(eq(galleryItems.id, id))
        .get()
      if (!existing) return { status: 'missing' }

      if (status === 'published') {
        const asset = transaction
          .select({ state: mediaAssets.state })
          .from(mediaAssets)
          .where(eq(mediaAssets.id, existing.mediaId))
          .get()
        if (!asset || asset.state !== 'ready') {
          return { status: 'invalid', message: 'The image is not ready to publish.' }
        }
      }

      const now = new Date().toISOString()
      const publishedAt = status === 'published' ? (existing.publishedAt ?? now) : null
      transaction
        .update(galleryItems)
        .set({ status, updatedAt: now, publishedAt })
        .where(eq(galleryItems.id, id))
        .run()

      const updated = transaction
        .select(gallerySelection())
        .from(galleryItems)
        .innerJoin(mediaAssets, eq(mediaAssets.id, galleryItems.mediaId))
        .where(eq(galleryItems.id, id))
        .get()
      return updated ? { status: 'success', item: updated } : { status: 'missing' }
    }, { behavior: 'immediate' })
  }

  function remove(id: string): DeleteGalleryResult {
    return database.transaction((transaction): DeleteGalleryResult => {
      const result = transaction.delete(galleryItems).where(eq(galleryItems.id, id)).run()
      return result.changes > 0 ? { status: 'success', id } : { status: 'missing' }
    }, { behavior: 'immediate' })
  }

  return { listPublished, getPublished, listAll, get, save, setStatus, remove }
}

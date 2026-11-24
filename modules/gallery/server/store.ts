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
  listPublished(): Promise<PublishedGalleryItem[]>
  getPublished(id: string): Promise<PublishedGalleryItem | null>
  listAll(): Promise<GalleryItem[]>
  get(id: string): Promise<GalleryItem | null>
  save(input: ParsedGalleryItemInput): Promise<SaveGalleryResult>
  setStatus(id: string, status: GalleryStatus): Promise<SetGalleryStatusResult>
  remove(id: string): Promise<DeleteGalleryResult>
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
  async function get(id: string): Promise<GalleryItem | null> {
    const [row] = await database
      .select(gallerySelection())
      .from(galleryItems)
      .innerJoin(mediaAssets, eq(mediaAssets.id, galleryItems.mediaId))
      .where(eq(galleryItems.id, id))
      .limit(1)
    return row ?? null
  }

  async function listAll(): Promise<GalleryItem[]> {
    return database
      .select(gallerySelection())
      .from(galleryItems)
      .innerJoin(mediaAssets, eq(mediaAssets.id, galleryItems.mediaId))
      .orderBy(desc(galleryItems.updatedAt), asc(galleryItems.id))
  }

  async function listPublished(): Promise<PublishedGalleryItem[]> {
    const rows = await database
      .select(gallerySelection())
      .from(galleryItems)
      .innerJoin(mediaAssets, eq(mediaAssets.id, galleryItems.mediaId))
      .where(eq(galleryItems.status, 'published'))
      .orderBy(desc(galleryItems.publishedAt), asc(galleryItems.id))
    return rows.filter(
      (item): item is PublishedGalleryItem => item.status === 'published' && item.publishedAt !== null,
    )
  }

  async function getPublished(id: string): Promise<PublishedGalleryItem | null> {
    const [row] = await database
      .select(gallerySelection())
      .from(galleryItems)
      .innerJoin(mediaAssets, eq(mediaAssets.id, galleryItems.mediaId))
      .where(and(eq(galleryItems.id, id), eq(galleryItems.status, 'published')))
      .limit(1)
    if (!row || row.status !== 'published' || !row.publishedAt) return null
    return row as PublishedGalleryItem
  }

  async function save(input: ParsedGalleryItemInput): Promise<SaveGalleryResult> {
    return database.transaction(async (transaction): Promise<SaveGalleryResult> => {
      const [asset] = await transaction
        .select({ id: mediaAssets.id, state: mediaAssets.state })
        .from(mediaAssets)
        .where(eq(mediaAssets.id, input.mediaId))
        .limit(1)
      if (!asset || asset.state !== 'ready') {
        return { status: 'invalid', message: 'Choose a ready uploaded image before saving.' }
      }

      const now = new Date().toISOString()
      if (input.id) {
        const [existing] = await transaction
          .select({ id: galleryItems.id, status: galleryItems.status, publishedAt: galleryItems.publishedAt })
          .from(galleryItems)
          .where(eq(galleryItems.id, input.id))
          .for('update')
          .limit(1)
        if (!existing) return { status: 'missing' }

        const publishedAt =
          input.status === 'published' ? (existing.publishedAt ?? now) : null

        await transaction
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

        const [updated] = await transaction
          .select(gallerySelection())
          .from(galleryItems)
          .innerJoin(mediaAssets, eq(mediaAssets.id, galleryItems.mediaId))
          .where(eq(galleryItems.id, input.id))
          .limit(1)
        return updated ? { status: 'success', item: updated } : { status: 'missing' }
      }

      const id = randomUUID()
      const publishedAt = input.status === 'published' ? now : null
      await transaction
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

      const [created] = await transaction
        .select(gallerySelection())
        .from(galleryItems)
        .innerJoin(mediaAssets, eq(mediaAssets.id, galleryItems.mediaId))
        .where(eq(galleryItems.id, id))
        .limit(1)
      return created ? { status: 'success', item: created } : { status: 'missing' }
    })
  }

  async function setStatus(id: string, status: GalleryStatus): Promise<SetGalleryStatusResult> {
    return database.transaction(async (transaction): Promise<SetGalleryStatusResult> => {
      const [existing] = await transaction
        .select({
          id: galleryItems.id,
          mediaId: galleryItems.mediaId,
          publishedAt: galleryItems.publishedAt,
        })
        .from(galleryItems)
        .where(eq(galleryItems.id, id))
        .for('update')
        .limit(1)
      if (!existing) return { status: 'missing' }

      if (status === 'published') {
        const [asset] = await transaction
          .select({ state: mediaAssets.state })
          .from(mediaAssets)
          .where(eq(mediaAssets.id, existing.mediaId))
          .limit(1)
        if (!asset || asset.state !== 'ready') {
          return { status: 'invalid', message: 'The image is not ready to publish.' }
        }
      }

      const now = new Date().toISOString()
      const publishedAt = status === 'published' ? (existing.publishedAt ?? now) : null
      await transaction
        .update(galleryItems)
        .set({ status, updatedAt: now, publishedAt })
        .where(eq(galleryItems.id, id))

      const [updated] = await transaction
        .select(gallerySelection())
        .from(galleryItems)
        .innerJoin(mediaAssets, eq(mediaAssets.id, galleryItems.mediaId))
        .where(eq(galleryItems.id, id))
        .limit(1)
      return updated ? { status: 'success', item: updated } : { status: 'missing' }
    })
  }

  async function remove(id: string): Promise<DeleteGalleryResult> {
    return database.transaction(async (transaction): Promise<DeleteGalleryResult> => {
      const deleted = await transaction
        .delete(galleryItems)
        .where(eq(galleryItems.id, id))
        .returning({ id: galleryItems.id })
      return deleted.length > 0 ? { status: 'success', id } : { status: 'missing' }
    })
  }

  return { listPublished, getPublished, listAll, get, save, setStatus, remove }
}

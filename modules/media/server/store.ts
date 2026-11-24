import { and, asc, desc, eq } from 'drizzle-orm'
import type { AppDatabase } from '@/lib/server/database'
import { mediaAssets } from './schema'
import { mediaAssetSchema, type MediaAsset } from '../model'
import type { PreparedMedia } from './upload'
import type { MediaStorage } from './storage'

export type MediaUploadResult =
  | { status: 'success'; value: MediaAsset }
  | { status: 'conflict' }

export type MediaStore = {
  get(id: string): Promise<MediaAsset | null>
  list(): Promise<MediaAsset[]>
  upload(input: PreparedMedia): Promise<MediaUploadResult>
}

function metadata(input: PreparedMedia): Omit<MediaAsset, 'state' | 'createdAt'> {
  return {
    id: input.id,
    originalName: input.originalName,
    mediaType: input.mediaType,
    byteSize: input.byteSize,
    width: input.width,
    height: input.height,
    sha256: input.sha256,
  }
}

export function createMediaStore(database: AppDatabase, storage: MediaStorage): MediaStore {
  async function get(id: string) {
    const [asset] = await database.select().from(mediaAssets).where(eq(mediaAssets.id, id)).limit(1)
    return asset ? mediaAssetSchema.parse(asset) : null
  }

  async function list() {
    const rows = await database.select().from(mediaAssets)
      .orderBy(desc(mediaAssets.createdAt), asc(mediaAssets.id))
    return rows.map(asset => mediaAssetSchema.parse(asset))
  }

  async function upload(input: PreparedMedia): Promise<MediaUploadResult> {
    const expected = metadata(input)
    const pending = await database.transaction(async (transaction): Promise<MediaUploadResult | { status: 'pending'; value: MediaAsset }> => {
      const asset: MediaAsset = { ...expected, state: 'pending', createdAt: new Date().toISOString() }
      const inserted = await transaction.insert(mediaAssets).values(asset)
        .onConflictDoNothing({ target: mediaAssets.id })
        .returning()
      if (inserted.length > 0) {
        return { status: 'pending', value: inserted[0] }
      }

      const [existing] = await transaction.select().from(mediaAssets)
        .where(eq(mediaAssets.id, input.id))
        .for('update')
      if (!existing) {
        return { status: 'conflict' }
      }
      if (existing.sha256 !== input.sha256 || existing.byteSize !== input.byteSize || existing.mediaType !== input.mediaType) {
        return { status: 'conflict' }
      }
      return existing.state === 'ready'
        ? { status: 'success', value: existing }
        : { status: 'pending', value: existing }
    })

    if (pending.status === 'conflict') return pending
    const stored = await storage.put(pending.value, input.bytes)
    if (stored === 'conflict') return { status: 'conflict' }
    if (pending.status === 'success') return pending

    return database.transaction(async transaction => {
      const [current] = await transaction.select().from(mediaAssets)
        .where(and(eq(mediaAssets.id, input.id), eq(mediaAssets.sha256, input.sha256)))
        .for('update')
      if (!current) return { status: 'conflict' as const }
      if (current.state === 'ready') return { status: 'success' as const, value: current }
      const [ready] = await transaction.update(mediaAssets).set({ state: 'ready' })
        .where(and(eq(mediaAssets.id, input.id), eq(mediaAssets.state, 'pending')))
        .returning()
      if (ready) return { status: 'success' as const, value: ready }
      const [reloaded] = await transaction.select().from(mediaAssets).where(eq(mediaAssets.id, input.id)).limit(1)
      return reloaded ? { status: 'success' as const, value: reloaded } : { status: 'conflict' as const }
    })
  }

  return { get, list, upload }
}

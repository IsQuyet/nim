import { and, eq } from 'drizzle-orm'
import type { AppDatabase } from '@/lib/server/database'
import { mediaAssets } from './schema'
import { mediaAssetSchema, type MediaAsset } from '../model'
import type { PreparedMedia } from './upload'
import type { MediaStorage } from './storage'

export type MediaUploadResult =
  | { status: 'success'; value: MediaAsset }
  | { status: 'conflict' }

export type MediaStore = {
  get(id: string): MediaAsset | null
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
  function get(id: string) {
    const asset = database.select().from(mediaAssets).where(eq(mediaAssets.id, id)).get()
    return asset ? mediaAssetSchema.parse(asset) : null
  }

  async function upload(input: PreparedMedia): Promise<MediaUploadResult> {
    const expected = metadata(input)
    const pending = database.transaction((transaction): MediaUploadResult | { status: 'pending'; value: MediaAsset } => {
      const existing = transaction.select().from(mediaAssets).where(eq(mediaAssets.id, input.id)).get()
      if (existing) {
        if (existing.sha256 !== input.sha256 || existing.byteSize !== input.byteSize || existing.mediaType !== input.mediaType) {
          return { status: 'conflict' }
        }
        return existing.state === 'ready'
          ? { status: 'success', value: existing }
          : { status: 'pending', value: existing }
      }
      const asset: MediaAsset = { ...expected, state: 'pending', createdAt: new Date().toISOString() }
      transaction.insert(mediaAssets).values(asset).run()
      return { status: 'pending', value: asset }
    }, { behavior: 'immediate' })

    if (pending.status === 'conflict') return pending
    const stored = await storage.put(pending.value, input.bytes)
    if (stored === 'conflict') return { status: 'conflict' }
    if (pending.status === 'success') return pending

    return database.transaction(transaction => {
      const current = transaction.select().from(mediaAssets).where(and(
        eq(mediaAssets.id, input.id), eq(mediaAssets.sha256, input.sha256),
      )).get()
      if (!current) return { status: 'conflict' as const }
      if (current.state === 'ready') return { status: 'success' as const, value: current }
      transaction.update(mediaAssets).set({ state: 'ready' }).where(and(
        eq(mediaAssets.id, input.id), eq(mediaAssets.state, 'pending'),
      )).run()
      const ready = transaction.select().from(mediaAssets).where(eq(mediaAssets.id, input.id)).get()
      if (!ready) return { status: 'conflict' as const }
      return { status: 'success' as const, value: ready }
    }, { behavior: 'immediate' })
  }

  return { get, upload }
}

// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { initializeDatabase, openDatabase, type ManagedDatabase } from '@/lib/server/database'
import { mediaAssets } from '@/modules/media/server/schema'
import { createFileMediaStorage } from '@/modules/media/server/storage'
import { createMediaStore } from '@/modules/media/server/store'
import { prepareMediaUpload } from '@/modules/media/server/upload'
import { createTestImage } from '@/test/media-fixtures'
import { saveGalleryItemSchema } from '../model'
import { createGalleryStore } from './store'

let directory: string
let database: ManagedDatabase

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'nim-gallery-store-'))
  const target = join(directory, 'pgdata')
  await initializeDatabase(target)
  database = await openDatabase(target)
})

afterEach(async () => {
  await database?.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

async function uploadReadyMedia(name = 'frame.png') {
  const bytes = await createTestImage()
  const prepared = await prepareMediaUpload({
    id: randomUUID(),
    originalName: name,
    declaredType: 'image/png',
    bytes,
  })
  if (prepared.status !== 'success') throw new Error(prepared.message)
  const storage = createFileMediaStorage(join(directory, 'media'))
  const result = await createMediaStore(database, storage).upload(prepared.value)
  if (result.status !== 'success') throw new Error('Expected ready media.')
  return result.value
}

describe('画廊存储与发布状态控制', () => {
  it('草稿不对公开列表和详情可见，发布与下架同步更新 publishedAt', async () => {
    const media = await uploadReadyMedia()
    const store = createGalleryStore(database)

    const saved = await store.save({
      mediaId: media.id,
      title: 'Harbor Mist',
      caption: 'Early morning ferry',
      location: 'Kobe',
      takenAt: '2026-10-12',
      status: 'draft',
    })
    expect(saved.status).toBe('success')
    if (saved.status !== 'success') return

    expect(await store.listPublished()).toEqual([])
    expect(await store.getPublished(saved.item.id)).toBeNull()
    expect(await store.listAll()).toHaveLength(1)

    const published = await store.setStatus(saved.item.id, 'published')
    expect(published.status).toBe('success')
    if (published.status !== 'success') return
    expect(published.item.publishedAt).toBeTruthy()
    expect(await store.listPublished()).toHaveLength(1)
    expect((await store.getPublished(saved.item.id))?.title).toBe('Harbor Mist')

    const unpublished = await store.setStatus(saved.item.id, 'draft')
    expect(unpublished.status).toBe('success')
    if (unpublished.status !== 'success') return
    expect(unpublished.item.publishedAt).toBeNull()
    expect(await store.listPublished()).toEqual([])
  })

  it('拒绝不存在或未就绪的媒体，并在被引用时由外键阻止直接删媒体', async () => {
    const store = createGalleryStore(database)
    const missing = await store.save({
      mediaId: randomUUID(),
      title: 'Missing',
      caption: '',
      location: '',
      takenAt: null,
      status: 'published',
    })
    expect(missing.status).toBe('invalid')

    const media = await uploadReadyMedia('protected.png')
    const saved = await store.save({
      mediaId: media.id,
      title: 'Protected',
      caption: '',
      location: '',
      takenAt: null,
      status: 'published',
    })
    expect(saved.status).toBe('success')
    if (saved.status !== 'success') return

    await expect(database.delete(mediaAssets).where(eq(mediaAssets.id, media.id))).rejects.toThrow()

    expect(await store.remove(saved.item.id)).toEqual({ status: 'success', id: saved.item.id })
    expect(await store.get(saved.item.id)).toBeNull()
    expect((await database.select().from(mediaAssets).where(eq(mediaAssets.id, media.id)))[0]).toBeDefined()
  })

  it('校验非法拍摄日期与空标题', () => {
    expect(saveGalleryItemSchema.safeParse({
      mediaId: randomUUID(),
      title: '   ',
      caption: '',
      location: '',
      takenAt: '',
      status: 'draft',
    }).success).toBe(false)

    expect(saveGalleryItemSchema.safeParse({
      mediaId: randomUUID(),
      title: 'Valid',
      caption: '',
      location: '',
      takenAt: '2026-02-30',
      status: 'draft',
    }).success).toBe(false)
  })
})

// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeDatabase, openDatabase, type ManagedDatabase } from '@/lib/server/database'
import { createGalleryStore } from '@/modules/gallery/server/store'
import { createFileMediaStorage, type MediaStorage } from '@/modules/media/server/storage'
import { createMediaStore } from '@/modules/media/server/store'
import { prepareMediaUpload } from '@/modules/media/server/upload'
import { createWritingStore } from '@/modules/posts/server/writing-store'
import { createTestImage } from '@/test/media-fixtures'
import { createTestDraft, publishTestDraft } from '@/test/post-commands'
import { deleteSiteAdminMedia, isSiteMediaPublished, listSiteAdminMedia } from './media-admin'

let directory: string
let database: ManagedDatabase
let storage: MediaStorage

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'nim-site-media-admin-'))
  const target = join(directory, 'pgdata')
  await initializeDatabase(target)
  database = await openDatabase(target)
  storage = createFileMediaStorage(join(directory, 'media'))
})

afterEach(async () => {
  await database?.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

async function uploadAsset(name: string) {
  const bytes = await createTestImage()
  const prepared = await prepareMediaUpload({
    id: randomUUID(),
    originalName: name,
    declaredType: 'image/png',
    bytes,
  })
  if (prepared.status !== 'success') throw new Error(prepared.message)
  const result = await createMediaStore(database, storage).upload(prepared.value)
  if (result.status !== 'success') throw new Error('Expected media upload to succeed.')
  return result.value
}

describe('跨模块媒体引用、公开判断与删除守卫', () => {
  it('合并文章与画廊引用，并保护仍被引用的图片不被删除', async () => {
    const unused = await uploadAsset('unused.png')
    const galleryDraftImg = await uploadAsset('gallery-draft.png')
    const galleryPubImg = await uploadAsset('gallery-pub.png')
    const postPubImg = await uploadAsset('post-pub.png')

    const gallery = createGalleryStore(database)
    const draftItem = await gallery.save({
      mediaId: galleryDraftImg.id,
      title: 'Draft shot',
      caption: '',
      location: '',
      takenAt: null,
      status: 'draft',
    })
    const pubItem = await gallery.save({
      mediaId: galleryPubImg.id,
      title: 'Published shot',
      caption: '',
      location: '',
      takenAt: null,
      status: 'published',
    })
    expect(draftItem.status).toBe('success')
    expect(pubItem.status).toBe('success')

    const writer = createWritingStore(database)
    const post = await createTestDraft(writer, {
      title: 'Post with image',
      description: '',
      body: `![post](/media/${postPubImg.id})`,
    })
    await publishTestDraft(writer, post)

    expect(await isSiteMediaPublished(database, unused.id)).toBe(false)
    expect(await isSiteMediaPublished(database, galleryDraftImg.id)).toBe(false)
    expect(await isSiteMediaPublished(database, galleryPubImg.id)).toBe(true)
    expect(await isSiteMediaPublished(database, postPubImg.id)).toBe(true)

    const items = await listSiteAdminMedia(database, storage)
    const byId = new Map(items.map(item => [item.asset.id, item]))
    expect(byId.get(galleryDraftImg.id)?.galleryReferences).toHaveLength(1)
    expect(byId.get(galleryPubImg.id)?.galleryReferences).toHaveLength(1)
    expect(byId.get(postPubImg.id)?.postReferences).toHaveLength(1)

    expect(await deleteSiteAdminMedia(database, storage, galleryDraftImg.id)).toMatchObject({ status: 'referenced' })
    expect(await deleteSiteAdminMedia(database, storage, galleryPubImg.id)).toMatchObject({ status: 'referenced' })
    expect(await deleteSiteAdminMedia(database, storage, postPubImg.id)).toMatchObject({ status: 'referenced' })
    expect(await deleteSiteAdminMedia(database, storage, unused.id)).toEqual({ status: 'success', id: unused.id })
  })
})

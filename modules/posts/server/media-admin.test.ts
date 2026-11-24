// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeDatabase, openDatabase, type AppDatabase } from '@/lib/server/database'
import { createFileMediaStorage, type MediaStorage } from '@/modules/media/server/storage'
import { createMediaStore } from '@/modules/media/server/store'
import { prepareMediaUpload } from '@/modules/media/server/upload'
import { createTestImage } from '@/test/media-fixtures'
import { createTestDraft, publishTestDraft, saveTestDraft } from '@/test/post-commands'
import { createWritingStore } from './writing-store'
import { deleteAdminMedia, listAdminMedia } from './media-admin'

let directory: string
let database: AppDatabase
let storage: MediaStorage
let mediaRoot: string

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'nim-media-admin-'))
  const filename = join(directory, 'nim.sqlite')
  mediaRoot = join(directory, 'media')
  await initializeDatabase(filename)
  database = openDatabase(filename)
  storage = createFileMediaStorage(mediaRoot)
})

afterEach(() => {
  database?.$client.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

async function uploadAsset(name = 'photo.png') {
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

describe('后台媒体列表与引用查询', () => {
  it('汇总当前草稿、当前发布与历史发布对媒体资源的引用', async () => {
    const unused = await uploadAsset('unused.png')
    const draftOnly = await uploadAsset('draft-only.png')
    const publishedBoth = await uploadAsset('published.png')
    const historicalOnly = await uploadAsset('historical.png')

    const writer = createWritingStore(database)
    const draftPost = createTestDraft(writer, {
      title: 'Draft post',
      description: '',
      body: `![draft](/media/${draftOnly.id})`,
    })
    const livePost = createTestDraft(writer, {
      title: 'Live post',
      description: '',
      body: `![live](/media/${publishedBoth.id})\n\n![old](/media/${historicalOnly.id})`,
    })
    const published = publishTestDraft(writer, livePost)
    saveTestDraft(writer, { ...livePost, revisionId: published.revisionId }, {
      title: 'Live post',
      description: '',
      body: `![live](/media/${publishedBoth.id})`,
    })
    publishTestDraft(writer, {
      ...livePost,
      revisionId: published.revisionId + 1,
      body: `![live](/media/${publishedBoth.id})`,
    })

    const items = listAdminMedia(database, storage)
    const byId = new Map(items.map(item => [item.asset.id, item]))

    expect(byId.get(unused.id)?.references).toEqual([])
    expect(byId.get(draftOnly.id)?.references).toEqual([{
      postId: draftPost.id,
      title: 'Draft post',
      inDraft: true,
      inPublished: false,
      publicationCount: 0,
    }])
    expect(byId.get(publishedBoth.id)?.references).toEqual([{
      postId: livePost.id,
      title: 'Live post',
      inDraft: true,
      inPublished: true,
      publicationCount: 2,
    }])
    expect(byId.get(historicalOnly.id)?.references).toEqual([{
      postId: livePost.id,
      title: 'Live post',
      inDraft: false,
      inPublished: false,
      publicationCount: 1,
    }])
  })

  it('仅允许删除未被任何草稿或发布版本引用的媒体，并同步清理磁盘文件', async () => {
    const unused = await uploadAsset('unused.png')
    const inDraft = await uploadAsset('in-draft.png')
    const inPublished = await uploadAsset('in-published.png')

    const writer = createWritingStore(database)
    createTestDraft(writer, { title: 'Draft', description: '', body: `![a](/media/${inDraft.id})` })
    const pub = createTestDraft(writer, { title: 'Pub', description: '', body: `![b](/media/${inPublished.id})` })
    publishTestDraft(writer, pub)

    expect(await deleteAdminMedia(database, storage, 'not-a-uuid')).toMatchObject({ status: 'invalid' })
    expect(await deleteAdminMedia(database, storage, randomUUID())).toEqual({ status: 'missing' })
    expect(await deleteAdminMedia(database, storage, inDraft.id)).toMatchObject({ status: 'referenced' })
    expect(await deleteAdminMedia(database, storage, inPublished.id)).toMatchObject({ status: 'referenced' })

    const unusedFile = join(mediaRoot, `${unused.id}.webp`)
    expect(existsSync(unusedFile)).toBe(true)
    expect(await deleteAdminMedia(database, storage, unused.id)).toEqual({ status: 'success', id: unused.id })
    expect(existsSync(unusedFile)).toBe(false)
    expect(createMediaStore(database, storage).get(unused.id)).toBeNull()
  })
})

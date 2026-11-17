// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { mediaAssets } from '@/modules/media/server/schema'
import { postPublicationMedia, postPublications, postRevisions, posts } from './schema'
import { initializeDatabase, openDatabase, type AppDatabase } from '@/lib/server/database'
import { createWritingStore } from './writing-store'
import { importPublishedPosts } from './store'
import { isMediaPublished } from './storage'
import { createMediaStore } from '@/modules/media/server/store'
import { createFileMediaStorage } from '@/modules/media/server/storage'
import { prepareMediaUpload } from '@/modules/media/server/upload'
import { createTestDraft, publishTestDraft } from '@/test/post-commands'
import { createTestImage } from '@/test/media-fixtures'

let directory: string
let database: AppDatabase
let png: Buffer

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'nim-publication-media-'))
  const filename = join(directory, 'nim.sqlite')
  await initializeDatabase(filename)
  database = openDatabase(filename)
  png = await createTestImage()
})

afterEach(() => {
  database?.$client.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

async function prepared(id: string = randomUUID(), bytes: Uint8Array = png) {
  const result = await prepareMediaUpload({ id, originalName: 'photo.png', declaredType: 'image/png', bytes })
  if (result.status !== 'success') throw new Error(result.message)
  return result.value
}

function store() {
  return createMediaStore(database, createFileMediaStorage(join(directory, 'media')))
}

describe('发布与图片引用', () => {
  it('明确发布在同一事务内登记真实图片引用，重放不重复授权', async () => {
    const input = await prepared()
    const media = store()
    await media.upload(input)
    const writer = createWritingStore(database)
    const draft = createTestDraft(writer, { title: 'Article', description: '', body: `![photo][]\n\n[photo]: /media/${input.id}` })
    expect(isMediaPublished(database, input.id)).toBe(false)
    const command = {
      postId: draft.id, operationId: randomUUID(), expectedRevisionId: draft.revisionId, intent: 'publish' as const,
      content: { title: draft.title, description: draft.description, body: draft.body },
    }
    const first = writer.write(command)
    expect(first.status).toBe('success')
    expect(writer.write(command)).toEqual(first)
    expect(isMediaPublished(database, input.id)).toBe(true)
    expect(database.select().from(postPublicationMedia).all()).toHaveLength(1)
    expect(database.$client.pragma('foreign_key_check')).toEqual([])
  })

  it('回执重放先于新的媒体状态校验，不重复发布或回退草稿', async () => {
    const input = await prepared()
    await store().upload(input)
    const writer = createWritingStore(database)
    const draft = createTestDraft(writer, { title: 'Article', description: '', body: `![photo](/media/${input.id})` })
    const command = {
      postId: draft.id, operationId: randomUUID(), expectedRevisionId: draft.revisionId, intent: 'publish' as const,
      content: { title: draft.title, description: draft.description, body: draft.body },
    }
    const confirmed = writer.write(command)
    const next = writer.write({ ...command, operationId: randomUUID(), intent: 'save', content: { ...command.content, body: 'Newer draft' } })
    expect(next.status).toBe('success')
    database.update(mediaAssets).set({ state: 'pending' }).where(eq(mediaAssets.id, input.id)).run()
    expect(writer.write(command)).toEqual(confirmed)
    expect(writer.getDraft(draft.id)?.body).toBe('Newer draft')
    expect(database.select().from(postPublications).all()).toHaveLength(1)
    expect(database.select().from(postPublicationMedia).all()).toHaveLength(1)
  })

  it('过期发布基线仍先返回冲突，不被缺失图片校验取代', () => {
    const writer = createWritingStore(database)
    const draft = createTestDraft(writer, { title: 'Article', description: '', body: 'Initial' })
    expect(writer.write({
      postId: draft.id, operationId: randomUUID(), expectedRevisionId: null, intent: 'publish',
      content: { title: draft.title, description: '', body: `![missing](/media/${randomUUID()})` },
    })).toEqual({ status: 'conflict', current: draft })
  })

  it('悬空图片引用导致整个发布事务回滚，不追加修订或发布', () => {
    const writer = createWritingStore(database)
    const draft = createTestDraft(writer, { title: 'Article', description: '', body: 'No images yet' })
    const result = writer.write({
      postId: draft.id, operationId: randomUUID(), expectedRevisionId: draft.revisionId, intent: 'publish',
      content: { title: draft.title, description: draft.description, body: `![missing](/media/${randomUUID()})` },
    })
    expect(result).toMatchObject({ status: 'invalid', message: expect.stringContaining('Upload or repair') })
    expect(database.select().from(postRevisions).all()).toHaveLength(1)
    expect(database.select().from(postPublications).all()).toHaveLength(0)
    expect(writer.getDraft(draft.id)).toEqual(draft)
  })

  it('文件尚未写完的图片不能随发布公开，写完后同一篇正文可以发布', async () => {
    const input = await prepared()
    const interrupted = createMediaStore(database, {
      async put() { throw new Error('Disk unavailable') },
      async read() { return null },
    })
    await expect(interrupted.upload(input)).rejects.toThrow('Disk unavailable')
    const writer = createWritingStore(database)
    const draft = createTestDraft(writer, { title: 'Article', description: '', body: `![photo](/media/${input.id})` })
    const publish = () => writer.write({
      postId: draft.id, operationId: randomUUID(), expectedRevisionId: draft.revisionId, intent: 'publish',
      content: { title: draft.title, description: draft.description, body: draft.body },
    })

    expect(publish()).toMatchObject({ status: 'invalid', message: expect.stringContaining('Upload or repair') })
    expect(isMediaPublished(database, input.id)).toBe(false)
    expect(database.select().from(postPublications).all()).toHaveLength(0)

    await store().upload(input)
    expect(publish().status).toBe('success')
    expect(isMediaPublished(database, input.id)).toBe(true)
  })

  it('发布导入与网页发布登记相同的媒体关系', async () => {
    const input = await prepared()
    const media = store()
    await media.upload(input)
    expect(importPublishedPosts(database, [{ id: randomUUID(), title: 'Imported', description: '', body: `![photo](/media/${input.id})` }]))
      .toEqual({ imported: 1, skipped: 0 })
    expect(isMediaPublished(database, input.id)).toBe(true)
    expect(database.select().from(postPublicationMedia).all()).toHaveLength(1)
  })

  it('发布导入遇到缺失图片时整体回滚，不留下文章身份', () => {
    expect(() => importPublishedPosts(database, [
      { id: randomUUID(), title: 'First imported', description: '', body: 'Valid article' },
      { id: randomUUID(), title: 'Imported', description: '', body: `![missing](/media/${randomUUID()})` },
    ]))
      .toThrow('Upload or repair')
    expect(database.select().from(posts).all()).toEqual([])
    expect(database.select().from(postRevisions).all()).toEqual([])
    expect(database.select().from(postPublications).all()).toEqual([])
  })

  it('发布远程图片时不授权其替代文字中的私有媒体', async () => {
    const input = await prepared()
    const media = store()
    await media.upload(input)
    const writer = createWritingStore(database)
    const draft = createTestDraft(writer, { title: 'Remote', description: '', body: `![outer ![private](/media/${input.id})](https://example.test/public.png)` })
    expect(writer.write({
      postId: draft.id, operationId: randomUUID(), expectedRevisionId: draft.revisionId, intent: 'publish',
      content: { title: draft.title, description: draft.description, body: draft.body },
    }).status).toBe('success')
    expect(isMediaPublished(database, input.id)).toBe(false)
    expect(database.select().from(postPublicationMedia).all()).toEqual([])
  })

  it('删除整篇文章级联清理发布引用，但保留媒体文件身份', async () => {
    const input = await prepared()
    const media = store()
    await media.upload(input)
    const writer = createWritingStore(database)
    const draft = createTestDraft(writer, { title: 'Article', description: '', body: `![photo](/media/${input.id})` })
    publishTestDraft(writer, draft)
    expect(database.select().from(postPublicationMedia).all()).toHaveLength(1)
    database.delete(posts).where(eq(posts.id, draft.id)).run()
    expect(database.select().from(postPublicationMedia).all()).toEqual([])
    expect(media.get(input.id)?.state).toBe('ready')
    expect(database.$client.pragma('foreign_key_check')).toEqual([])
  })
})

// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { mediaAssets } from '@/modules/media/server/schema'
import { postPublicationMedia, postPublications, postRevisions, posts } from './schema'
import { initializeDatabase, openDatabase, type ManagedDatabase } from '@/lib/server/database'
import { createWritingStore } from './writing-store'
import { importPublishedPosts } from './store'
import { isMediaPublished } from './storage'
import { createMediaStore } from '@/modules/media/server/store'
import { createFileMediaStorage } from '@/modules/media/server/storage'
import { prepareMediaUpload } from '@/modules/media/server/upload'
import { createTestDraft, publishTestDraft } from '@/test/post-commands'
import { createTestImage } from '@/test/media-fixtures'

let directory: string
let database: ManagedDatabase
let png: Buffer

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'nim-publication-media-'))
  const target = join(directory, 'pgdata')
  await initializeDatabase(target)
  database = await openDatabase(target)
  png = await createTestImage()
})

afterEach(async () => {
  await database?.close()
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
    const draft = await createTestDraft(writer, { title: 'Article', description: '', body: `![photo][]\n\n[photo]: /media/${input.id}` })
    expect(await isMediaPublished(database, input.id)).toBe(false)
    const command = {
      postId: draft.id, operationId: randomUUID(), expectedRevisionId: draft.revisionId, intent: 'publish' as const,
      content: { title: draft.title, description: draft.description, body: draft.body },
    }
    const first = await writer.write(command)
    expect(first.status).toBe('success')
    expect(await writer.write(command)).toEqual(first)
    expect(await isMediaPublished(database, input.id)).toBe(true)
    expect(await database.select().from(postPublicationMedia)).toHaveLength(1)
  })

  it('回执重放先于新的媒体状态校验，不重复发布或回退草稿', async () => {
    const input = await prepared()
    await store().upload(input)
    const writer = createWritingStore(database)
    const draft = await createTestDraft(writer, { title: 'Article', description: '', body: `![photo](/media/${input.id})` })
    const command = {
      postId: draft.id, operationId: randomUUID(), expectedRevisionId: draft.revisionId, intent: 'publish' as const,
      content: { title: draft.title, description: draft.description, body: draft.body },
    }
    const confirmed = await writer.write(command)
    const next = await writer.write({ ...command, operationId: randomUUID(), intent: 'save', content: { ...command.content, body: 'Newer draft' } })
    expect(next.status).toBe('success')
    await database.update(mediaAssets).set({ state: 'pending' }).where(eq(mediaAssets.id, input.id))
    expect(await writer.write(command)).toEqual(confirmed)
    expect((await writer.getDraft(draft.id))?.body).toBe('Newer draft')
    expect(await database.select().from(postPublications)).toHaveLength(1)
    expect(await database.select().from(postPublicationMedia)).toHaveLength(1)
  })

  it('过期发布基线仍先返回冲突，不被缺失图片校验取代', async () => {
    const writer = createWritingStore(database)
    const draft = await createTestDraft(writer, { title: 'Article', description: '', body: 'Initial' })
    expect(await writer.write({
      postId: draft.id, operationId: randomUUID(), expectedRevisionId: null, intent: 'publish',
      content: { title: draft.title, description: '', body: `![missing](/media/${randomUUID()})` },
    })).toEqual({ status: 'conflict', current: draft })
  })

  it('悬空图片引用导致整个发布事务回滚，不追加修订或发布', async () => {
    const writer = createWritingStore(database)
    const draft = await createTestDraft(writer, { title: 'Article', description: '', body: 'No images yet' })
    const result = await writer.write({
      postId: draft.id, operationId: randomUUID(), expectedRevisionId: draft.revisionId, intent: 'publish',
      content: { title: draft.title, description: draft.description, body: `![missing](/media/${randomUUID()})` },
    })
    expect(result).toMatchObject({ status: 'invalid', message: expect.stringContaining('Upload or repair') })
    expect(await database.select().from(postRevisions)).toHaveLength(1)
    expect(await database.select().from(postPublications)).toHaveLength(0)
    expect(await writer.getDraft(draft.id)).toEqual(draft)
  })

  it('文件尚未写完的图片不能随发布公开，写完后同一篇正文可以发布', async () => {
    const input = await prepared()
    const interrupted = createMediaStore(database, {
      async put() { throw new Error('Disk unavailable') },
      async read() { return null },
      async remove() {},
    })
    await expect(interrupted.upload(input)).rejects.toThrow('Disk unavailable')
    const writer = createWritingStore(database)
    const draft = await createTestDraft(writer, { title: 'Article', description: '', body: `![photo](/media/${input.id})` })
    const publish = () => writer.write({
      postId: draft.id, operationId: randomUUID(), expectedRevisionId: draft.revisionId, intent: 'publish',
      content: { title: draft.title, description: draft.description, body: draft.body },
    })

    expect(await publish()).toMatchObject({ status: 'invalid', message: expect.stringContaining('Upload or repair') })
    expect(await isMediaPublished(database, input.id)).toBe(false)
    expect(await database.select().from(postPublications)).toHaveLength(0)

    await store().upload(input)
    expect((await publish()).status).toBe('success')
    expect(await isMediaPublished(database, input.id)).toBe(true)
  })

  it('发布导入与网页发布登记相同的媒体关系', async () => {
    const input = await prepared()
    const media = store()
    await media.upload(input)
    expect(await importPublishedPosts(database, [{ id: randomUUID(), title: 'Imported', description: '', body: `![photo](/media/${input.id})` }]))
      .toEqual({ imported: 1, skipped: 0 })
    expect(await isMediaPublished(database, input.id)).toBe(true)
    expect(await database.select().from(postPublicationMedia)).toHaveLength(1)
  })

  it('发布导入遇到缺失图片时整体回滚，不留下文章身份', async () => {
    await expect(importPublishedPosts(database, [
      { id: randomUUID(), title: 'First imported', description: '', body: 'Valid article' },
      { id: randomUUID(), title: 'Imported', description: '', body: `![missing](/media/${randomUUID()})` },
    ])).rejects.toThrow('Upload or repair')
    expect(await database.select().from(posts)).toEqual([])
    expect(await database.select().from(postRevisions)).toEqual([])
    expect(await database.select().from(postPublications)).toEqual([])
  })

  it('发布远程图片时不授权其替代文字中的私有媒体', async () => {
    const input = await prepared()
    const media = store()
    await media.upload(input)
    const writer = createWritingStore(database)
    const draft = await createTestDraft(writer, { title: 'Remote', description: '', body: `![outer ![private](/media/${input.id})](https://example.test/public.png)` })
    expect((await writer.write({
      postId: draft.id, operationId: randomUUID(), expectedRevisionId: draft.revisionId, intent: 'publish',
      content: { title: draft.title, description: draft.description, body: draft.body },
    })).status).toBe('success')
    expect(await isMediaPublished(database, input.id)).toBe(false)
    expect(await database.select().from(postPublicationMedia)).toEqual([])
  })

  it('删除整篇文章级联清理发布引用，但保留媒体文件身份', async () => {
    const input = await prepared()
    const media = store()
    await media.upload(input)
    const writer = createWritingStore(database)
    const draft = await createTestDraft(writer, { title: 'Article', description: '', body: `![photo](/media/${input.id})` })
    await publishTestDraft(writer, draft)
    expect(await database.select().from(postPublicationMedia)).toHaveLength(1)
    await database.delete(posts).where(eq(posts.id, draft.id))
    expect(await database.select().from(postPublicationMedia)).toEqual([])
    expect((await media.get(input.id))?.state).toBe('ready')
  })
})

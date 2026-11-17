// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { mediaAssets } from './schema'
import { postPublicationMedia, postPublications, postRevisions, posts } from '@/modules/posts/server/schema'
import { initializeDatabase, openDatabase, type AppDatabase } from '@/lib/server/database'
import { createWritingStore } from '@/modules/posts/server/writing-store'
import { importPublishedPosts } from '@/modules/posts/server/store'
import { createMediaStore } from './store'
import { createFileMediaStorage } from './storage'
import { prepareMediaUpload } from './upload'
import { createTestDraft, publishTestDraft } from '@/test/post-commands'
import { createTestImage } from '@/test/media-fixtures'

let directory: string
let database: AppDatabase
let png: Buffer

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'nim-media-store-'))
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

describe('媒体上传与发布关系', () => {
  it('重复上传保持媒体身份、不可变内容与首次时间', async () => {
    const media = store()
    const input = await prepared()
    const first = await media.upload(input)
    expect(first).toMatchObject({ status: 'success', value: { id: input.id, state: 'ready' } })
    expect(await media.upload(input)).toEqual(first)
    expect(media.get(input.id)?.sha256).toBe(input.sha256)
    expect(media.isPublished(input.id)).toBe(false)
  })

  it('同 ID 不同显示内容冲突，不覆盖原元数据和文件', async () => {
    const media = store()
    const first = await prepared()
    const different = await prepared(first.id, await createTestImage('png', '#123456'))
    await media.upload(first)
    expect(await media.upload(different)).toEqual({ status: 'conflict' })
    expect(media.get(first.id)?.sha256).toBe(first.sha256)
  })

  it('同一图片并发重试最终指向同一份已完成内容', async () => {
    const media = store()
    const input = await prepared()
    const [first, second] = await Promise.all([media.upload(input), media.upload(input)])
    expect(first).toMatchObject({ status: 'success', value: { state: 'ready' } })
    expect(second).toEqual(first)
    expect(database.select().from(mediaAssets).all()).toHaveLength(1)
  })

  it('文件写入失败保留可重试的 pending 身份，不将未完成图片视为可发布', async () => {
    const input = await prepared()
    const failed = createMediaStore(database, {
      async put() { throw new Error('Disk unavailable') },
      async read() { return null },
    })
    await expect(failed.upload(input)).rejects.toThrow('Disk unavailable')
    expect(failed.get(input.id)?.state).toBe('pending')
    expect(failed.isPublished(input.id)).toBe(false)
    expect(await store().upload(input)).toMatchObject({ status: 'success', value: { state: 'ready' } })
  })

  it('文件已写入而元数据提交失败后，可用同一上传身份核对并完成', async () => {
    const input = await prepared()
    database.$client.exec("CREATE TRIGGER fail_media_ready BEFORE UPDATE ON media_assets BEGIN SELECT RAISE(ABORT, 'Metadata unavailable'); END")
    const media = store()
    await expect(media.upload(input)).rejects.toThrow('Metadata unavailable')
    expect(media.get(input.id)?.state).toBe('pending')
    database.$client.exec('DROP TRIGGER fail_media_ready')
    expect(await media.upload(input)).toMatchObject({ status: 'success', value: { state: 'ready' } })
  })

  it('明确发布在同一事务内登记真实图片引用，重放不重复授权', async () => {
    const input = await prepared()
    const media = store()
    await media.upload(input)
    const writer = createWritingStore(database)
    const draft = createTestDraft(writer, { title: 'Article', description: '', body: `![photo][]\n\n[photo]: /media/${input.id}` })
    expect(media.isPublished(input.id)).toBe(false)
    const command = {
      postId: draft.id, operationId: randomUUID(), expectedRevisionId: draft.revisionId, intent: 'publish' as const,
      content: { title: draft.title, description: draft.description, body: draft.body },
    }
    const first = writer.write(command)
    expect(first.status).toBe('success')
    expect(writer.write(command)).toEqual(first)
    expect(media.isPublished(input.id)).toBe(true)
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

  it('发布导入与网页发布登记相同的媒体关系', async () => {
    const input = await prepared()
    const media = store()
    await media.upload(input)
    expect(importPublishedPosts(database, [{ id: randomUUID(), title: 'Imported', description: '', body: `![photo](/media/${input.id})` }]))
      .toEqual({ imported: 1, skipped: 0 })
    expect(media.isPublished(input.id)).toBe(true)
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
    expect(media.isPublished(input.id)).toBe(false)
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

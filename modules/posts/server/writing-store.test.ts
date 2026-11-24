// @vitest-environment node
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { asc, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeDatabase, openDatabase, type AppDatabase, type ManagedDatabase } from '@/lib/server/database'
import { createPostStore } from './store'
import { createWritingStore } from './writing-store'
import { postDrafts, postPublications, postPublished, postRevisions, posts, postWriteReceipts } from './schema'
import type { DraftPost } from '../model'
import { operationIdentitySchema, writingCommandSchema, type WritingCommand, type WritingResult, type WritingStore } from '../writing'

let pglite: PGlite
let pgServer: PGLiteSocketServer
let databaseUrl: string
let database: ManagedDatabase
let writer: WritingStore
const content = { title: 'Title', description: '', body: '原文\r\n' }

async function freePort() {
  const listener = createServer()
  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const address = listener.address()
  assert.ok(address && typeof address !== 'string')
  await new Promise<void>((resolve, reject) => listener.close(error => (error ? reject(error) : resolve())))
  return address.port
}

function command(current: DraftPost | null, input: Partial<WritingCommand> = {}): WritingCommand {
  return {
    postId: current?.id ?? randomUUID(), operationId: randomUUID(),
    expectedRevisionId: current?.revisionId ?? null, intent: 'save', content, ...input,
  }
}

function written(result: WritingResult) {
  assert.equal(result.status, 'success')
  return result.value.draft
}

async function snapshot() {
  return {
    posts: await database.select().from(posts).orderBy(asc(posts.id)),
    post_revisions: await database.select().from(postRevisions).orderBy(asc(postRevisions.id)),
    post_drafts: await database.select().from(postDrafts).orderBy(asc(postDrafts.postId)),
    post_publications: await database.select().from(postPublications).orderBy(asc(postPublications.id)),
    post_published: await database.select().from(postPublished).orderBy(asc(postPublished.postId)),
    post_write_receipts: await database.select().from(postWriteReceipts).orderBy(asc(postWriteReceipts.operationId)),
  }
}

beforeEach(async () => {
  const port = await freePort()
  pglite = new PGlite()
  pgServer = new PGLiteSocketServer({ db: pglite, port, host: '127.0.0.1', maxConnections: 10 })
  await pgServer.start()
  databaseUrl = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`
  await initializeDatabase(databaseUrl)
  database = await openDatabase(databaseUrl)
  writer = createWritingStore(database)
})

afterEach(async () => {
  await database?.close()
  await pgServer?.stop()
  await pglite?.close()
})

describe('明确草稿写入与修订基线', () => {
  it('首次保存建立不可变 create 修订，跨连接可读取草稿但不发布', async () => {
    const first = written(await writer.write(command(null)))
    const store = createPostStore(database)
    expect(await store.getDraft(first.id)).toEqual(first)
    expect(await store.listRevisions(first.id)).toEqual([{
      id: first.revisionId, postId: first.id, ...content,
      createdAt: first.updatedAt, source: 'create', restoredFromRevisionId: null,
    }])
    expect(await store.getPublishedPost(first.id)).toBeNull()
    expect(await store.listPosts()).toEqual([{
      id: first.id, title: content.title, description: content.description, updatedAt: first.updatedAt, status: 'draft',
    }])
    const workingCopies = (await database.execute(
      sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'post_working_copies'`,
    )) as { rows: unknown[] }
    expect(workingCopies.rows).toEqual([])
    const other = await openDatabase(databaseUrl)
    try { expect(await createWritingStore(other).getDraft(first.id)).toEqual(first) }
    finally { await other.close() }
  })

  it('首次发布同事务建立 create 修订与发布事件，后续保存不动公开版', async () => {
    const published = await writer.write(command(null, { intent: 'publish' }))
    assert.equal(published.status, 'success')
    const first = published.value.draft
    expect(published.value.publication).not.toBeNull()
    const next = written(await writer.write(command(first, { content: { ...content, body: '私有草稿' } })))
    const store = createPostStore(database)
    expect((await store.listRevisions(first.id)).map(item => item.source)).toEqual(['save', 'create'])
    expect((await store.getPublishedPost(first.id))?.body).toBe(content.body)
    expect((await store.listPosts())[0]).toMatchObject({ updatedAt: next.updatedAt, status: 'modified' })
    const republished = await writer.write(command(next, { intent: 'publish', content: { ...content, body: '当前可见内容' } }))
    assert.equal(republished.status, 'success')
    expect(await store.getDraft(first.id)).toEqual(republished.value.draft)
    expect((await store.getPublishedPost(first.id))?.body).toBe('当前可见内容')
    expect((await store.listRevisions(first.id)).map(item => item.source)).toEqual(['publish', 'save', 'create'])
  })

  it('同内容保存与重复发布不制造修订、不刷新草稿和发布时间', async () => {
    const original = await writer.write(command(null, { intent: 'publish' }))
    assert.equal(original.status, 'success')
    const first = original.value.draft
    const save = await writer.write(command(first))
    expect(save).toEqual({ status: 'success', value: { draft: first, publication: null } })
    const again = await writer.write(command(first, { intent: 'publish' }))
    expect(again).toEqual(original)
    expect(await createPostStore(database).listRevisions(first.id)).toHaveLength(1)
    expect(await createPostStore(database).listPublications(first.id)).toHaveLength(1)
    expect(await database.select().from(postWriteReceipts)).toHaveLength(3)
  })

  it('保存与发布都要求完成标题并保留原始文本，自动写入不属于契约', async () => {
    const before = await snapshot()
    for (const intent of ['save', 'publish'] as const) {
      expect((await writer.write(command(null, { intent, content: { ...content, title: ' \t\n' } }))).status).toBe('invalid')
    }
    expect(writingCommandSchema.safeParse({ ...command(null), intent: 'autosave' }).success).toBe(false)
    expect(await snapshot()).toEqual(before)
    const saved = written(await writer.write(command(null, { content: { ...content, title: ' Title\n' } })))
    expect(saved.title).toBe(' Title\n')
    expect(saved.body).toBe(content.body)
  })

  it('CAS 先于内容比较，旧基线即使内容相同也冲突，两连接不能相互覆盖', async () => {
    const first = written(await writer.write(command(null)))
    const nextContent = { ...content, body: '其他标签页' }
    const next = written(await writer.write(command(first, { content: nextContent })))
    const other = await openDatabase(databaseUrl)
    try {
      for (const intent of ['save', 'publish'] as const) {
        expect(await createWritingStore(other).write(command(first, { intent, content: nextContent })))
          .toEqual({ status: 'conflict', current: next })
      }
      expect(await createWritingStore(other).write(command(null, { postId: first.id, content: nextContent })))
        .toEqual({ status: 'conflict', current: next })
    } finally { await other.close() }
    expect(await createPostStore(database).listRevisions(first.id)).toHaveLength(2)
    expect(await database.select().from(postWriteReceipts)).toHaveLength(2)
  })

  it('null 基线只允许新身份，缺失文章的非空基线不能创建内容', async () => {
    const id = randomUUID()
    expect(await writer.write(command(null, { postId: id, expectedRevisionId: 1 }))).toEqual({ status: 'conflict', current: null })
    expect(await writer.getDraft(id)).toBeNull()
    await database.execute(sql`INSERT INTO posts (id, created_at) VALUES (${id}, ${new Date().toISOString()})`)
    const before = await snapshot()
    expect(await writer.write(command(null, { postId: id }))).toEqual({ status: 'conflict', current: null })
    expect(await snapshot()).toEqual(before)
  })

  it('导入和恢复只在内容变化时追加明确修订，旧写入基线随内容变化失效', async () => {
    const first = written(await writer.write(command(null, { intent: 'publish' })))
    const store = createPostStore(database)
    const published = await store.getPublishedPost(first.id)
    expect(await store.importDraft({ id: first.id, ...content })).toEqual(first)
    expect(await store.restoreRevision(first.id, first.revisionId, first.revisionId)).toEqual({ status: 'success', value: first })
    const imported = await store.importDraft({ id: first.id, ...content, body: '文件内容' })
    expect(await writer.getDraft(first.id)).toEqual(imported)
    expect(await writer.write(command(first))).toEqual({ status: 'conflict', current: imported })
    expect(await store.restoreRevision(first.id, first.revisionId, first.revisionId)).toEqual({ status: 'conflict' })
    const restored = await store.restoreRevision(first.id, first.revisionId, imported.revisionId)
    assert.equal(restored.status, 'success')
    expect((await store.listRevisions(first.id)).map(revision => revision.source)).toEqual(['restore', 'import', 'create'])
    expect((await store.listRevisions(first.id))[0].restoredFromRevisionId).toBe(first.revisionId)
    expect(await store.getPublishedPost(first.id)).toEqual(published)
    expect((await store.getRevisionHistory(first.id))?.draft).toEqual(restored.value)
  })
})

describe('明确动作操作回执', () => {
  it('丢响应重放返回原 ACK，随后草稿和公开引用移动也不被回写', async () => {
    const input = command(null, { intent: 'publish' })
    const original = await writer.write(input)
    const first = written(original)
    expect(await writer.write(input)).toEqual(original)
    const latest = written(await writer.write(command(first, { intent: 'publish', content: { ...content, body: '更新' } })))
    const before = await snapshot()
    expect(await writer.write(input)).toEqual(original)
    expect(await writer.inspect({ postId: input.postId, operationId: input.operationId })).toEqual(original)
    expect(await writer.getDraft(first.id)).toEqual(latest)
    expect((await createPostStore(database).getPublishedPost(first.id))?.revisionId).toBe(latest.revisionId)
    expect(await snapshot()).toEqual(before)
    expect(await createPostStore(database).listRevisions(first.id)).toHaveLength(2)
    expect(await createPostStore(database).listPublications(first.id)).toHaveLength(2)
  })

  it('保存回执从不可变修订重建，不借用当前内容和时间，也不带后续发布事件', async () => {
    const input = command(null)
    const original = await writer.write(input)
    const first = written(original)
    written(await writer.write(command(first, { intent: 'publish', content: { ...content, title: 'New title' } })))
    const other = await openDatabase(databaseUrl)
    try {
      expect(await createWritingStore(other).inspect({ postId: first.id, operationId: input.operationId })).toEqual(original)
      expect(await createWritingStore(other).write(input)).toEqual(original)
    } finally { await other.close() }
  })

  it('同一操作 ID 不得改变正文、意图、文档或基线，对象字段顺序不影响请求身份', async () => {
    const input = command(null)
    const original = await writer.write(input)
    for (const patch of [
      { content: { ...content, body: '不同' } }, { intent: 'publish' as const },
      { postId: randomUUID() }, { expectedRevisionId: written(original).revisionId },
    ]) expect((await writer.write({ ...input, ...patch })).status).toBe('invalid')
    expect(await writer.write({ ...input, content: { body: content.body, title: content.title, description: content.description } })).toEqual(original)
    expect(await database.select().from(postWriteReceipts)).toHaveLength(1)
  })

  it('inspect 只读现有回执，未知操作返回 unconfirmed 且不创建身份、修订或回执', async () => {
    const input = command(null)
    const before = await snapshot()
    await database.transaction(async tx => {
      await tx.execute(sql`SET TRANSACTION READ ONLY`)
      const readOnlyWriter = createWritingStore(tx as unknown as AppDatabase)
      expect(await readOnlyWriter.inspect({ postId: input.postId, operationId: input.operationId })).toEqual({ status: 'unconfirmed' })
      expect(await readOnlyWriter.getDraft(input.postId)).toBeNull()
    })
    expect(await snapshot()).toEqual(before)
    const original = await writer.write(input)
    const after = await snapshot()
    await database.transaction(async tx => {
      await tx.execute(sql`SET TRANSACTION READ ONLY`)
      const readOnlyWriter = createWritingStore(tx as unknown as AppDatabase)
      expect(await readOnlyWriter.inspect({ postId: input.postId, operationId: input.operationId })).toEqual(original)
      expect(await readOnlyWriter.inspect({ postId: input.postId, operationId: randomUUID() })).toEqual({ status: 'unconfirmed' })
      expect((await readOnlyWriter.inspect({ postId: randomUUID(), operationId: input.operationId })).status).toBe('invalid')
    })
    expect(await snapshot()).toEqual(after)
  })

  it('inspect 的操作身份必须合法且完整，不接受正文或代写入命令', async () => {
    const input = command(null)
    expect(operationIdentitySchema.safeParse(input).success).toBe(false)
    expect((await writer.inspect(input)).status).toBe('invalid')
    expect((await writer.inspect({ postId: input.postId, operationId: 'bad' })).status).toBe('invalid')
    expect((await writer.inspect({ postId: 'not-a-uuid', operationId: input.operationId })).status).toBe('invalid')
    expect(await database.select().from(postWriteReceipts)).toEqual([])
  })

  it('回执写入失败时身份、修订、草稿和发布全部回滚，inspect 不替代重试', async () => {
    await database.execute(sql`
      CREATE OR REPLACE FUNCTION reject_receipt_fn() RETURNS TRIGGER AS $$
      BEGIN RAISE EXCEPTION 'receipt unavailable'; END;
      $$ LANGUAGE plpgsql;
    `)
    await database.execute(sql`
      CREATE TRIGGER reject_receipt BEFORE INSERT ON post_write_receipts
      FOR EACH ROW EXECUTE FUNCTION reject_receipt_fn();
    `)
    const input = command(null, { intent: 'publish' })
    const before = await snapshot()
    await expect(writer.write(input)).rejects.toMatchObject({
      cause: { message: expect.stringContaining('receipt unavailable') },
    })
    expect(await writer.getDraft(input.postId)).toBeNull()
    expect(await writer.inspect({ postId: input.postId, operationId: input.operationId })).toEqual({ status: 'unconfirmed' })
    expect(await snapshot()).toEqual(before)
    await database.execute(sql`DROP TRIGGER reject_receipt ON post_write_receipts`)
    await database.execute(sql`DROP FUNCTION reject_receipt_fn()`)
    expect((await writer.write(input)).status).toBe('success')
  })

  it.each(['save', 'publish'] as const)('已有稿件 %s 的回执失败也完整回滚新修订、草稿头和公开引用', async intent => {
    const first = written(await writer.write(command(null, { intent: 'publish' })))
    const input = command(first, { intent, content: { ...content, body: '尚未确认的新内容' } })
    const before = await snapshot()
    await database.execute(sql`
      CREATE OR REPLACE FUNCTION reject_receipt_fn() RETURNS TRIGGER AS $$
      BEGIN RAISE EXCEPTION 'receipt unavailable'; END;
      $$ LANGUAGE plpgsql;
    `)
    await database.execute(sql`
      CREATE TRIGGER reject_receipt BEFORE INSERT ON post_write_receipts
      FOR EACH ROW EXECUTE FUNCTION reject_receipt_fn();
    `)
    await expect(writer.write(input)).rejects.toMatchObject({
      cause: { message: expect.stringContaining('receipt unavailable') },
    })
    expect(await writer.getDraft(first.id)).toEqual(first)
    expect(await writer.inspect({ postId: first.id, operationId: input.operationId })).toEqual({ status: 'unconfirmed' })
    expect(await snapshot()).toEqual(before)
    await database.execute(sql`DROP TRIGGER reject_receipt ON post_write_receipts`)
    await database.execute(sql`DROP FUNCTION reject_receipt_fn()`)
    expect((await writer.write(input)).status).toBe('success')
  })

  it('回执只存不可变引用与请求摘要，不可更新，文章删除级联释放', async () => {
    const input = command(null)
    const draft = written(await writer.write(input))
    const [receipt] = await database.select().from(postWriteReceipts).limit(1)
    expect(receipt).toEqual({
      operationId: input.operationId, postId: draft.id, requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      revisionId: draft.revisionId, publicationId: null,
    })
    await expect(database.execute(sql`UPDATE post_write_receipts SET request_hash = 'changed'`))
      .rejects.toMatchObject({ cause: { message: expect.stringContaining('Post write receipts are immutable') } })
    await database.execute(sql`DELETE FROM posts WHERE id = ${input.postId}`)
    expect(await database.select().from(postWriteReceipts)).toEqual([])
    expect(await writer.inspect({ postId: input.postId, operationId: input.operationId })).toEqual({ status: 'unconfirmed' })
  })

  it('真实外键约束回执引用同文章的修订及该修订的发布事件', async () => {
    const first = written(await writer.write(command(null)))
    const published = await writer.write(command(first, { intent: 'publish', content: { ...content, body: 'Published' } }))
    assert.equal(published.status, 'success')
    assert.ok(published.value.publication)
    const other = written(await writer.write(command(null)))
    const receipt = {
      operationId: randomUUID(), requestHash: 'hash', postId: first.id,
      revisionId: first.revisionId, publicationId: published.value.publication.id,
    }
    await expect(database.insert(postWriteReceipts).values(receipt)).rejects.toThrow()
    await expect(database.insert(postWriteReceipts).values({ ...receipt, publicationId: null, revisionId: other.revisionId })).rejects.toThrow()
    await expect(database.execute(sql`
      INSERT INTO post_write_receipts (operation_id, post_id, request_hash, revision_id)
      VALUES (${randomUUID()}, ${first.id}, 'hash', NULL)
    `)).rejects.toThrow()
  })

  it('外部命令拒绝系统字段、旧基线字段和非法身份', async () => {
    expect(writingCommandSchema.safeParse({ ...command(null), operationId: 'bad' }).success).toBe(false)
    expect(writingCommandSchema.safeParse({ ...command(null), unexpected: true }).success).toBe(false)
    expect(writingCommandSchema.safeParse({ ...command(null), expectedVersion: 'old' }).success).toBe(false)
    expect(writingCommandSchema.safeParse({ ...command(null), content: { ...content, revisionId: 1 } }).success).toBe(false)
    expect((await writer.write(command(null, { postId: 'not-a-uuid' }))).status).toBe('invalid')
  })
})

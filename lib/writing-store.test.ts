// @vitest-environment node
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeDatabase, openDatabase, type AppDatabase } from './database'
import { createPostStore } from './posts'
import { createWritingStore } from './writing-store'
import { postWriteReceipts } from './schema'
import type { DraftPost } from './content'
import { operationIdentitySchema, writingCommandSchema, type WritingCommand, type WritingResult, type WritingStore } from './writing'

let directory: string
let database: AppDatabase
let writer: WritingStore
const content = { title: 'Title', description: '', body: '原文\r\n' }

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

function snapshot() {
  return Object.fromEntries(['posts', 'post_revisions', 'post_drafts', 'post_publications', 'post_published', 'post_write_receipts']
    .map(table => [table, database.$client.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'nim-writing-'))
  await initializeDatabase(join(directory, 'test.sqlite'))
  database = openDatabase(join(directory, 'test.sqlite'))
  writer = createWritingStore(database)
})
afterEach(() => {
  if (database?.$client.open) database.$client.close()
  if (directory) rmSync(directory, { recursive: true })
})

describe('明确草稿写入与修订基线', () => {
  it('首次保存建立不可变 create 修订，跨连接可读取草稿但不发布', () => {
    const first = written(writer.write(command(null)))
    const store = createPostStore(database)
    expect(store.getDraft(first.id)).toEqual(first)
    expect(store.listRevisions(first.id)).toEqual([{
      id: first.revisionId, postId: first.id, ...content,
      createdAt: first.updatedAt, source: 'create', restoredFromRevisionId: null,
    }])
    expect(store.getPublishedPost(first.id)).toBeNull()
    expect(store.listPosts()).toEqual([{
      id: first.id, title: content.title, description: content.description, updatedAt: first.updatedAt, status: 'draft',
    }])
    expect(database.$client.prepare("SELECT name FROM sqlite_master WHERE name = 'post_working_copies'").all()).toEqual([])
    const other = openDatabase(join(directory, 'test.sqlite'))
    try { expect(createWritingStore(other).getDraft(first.id)).toEqual(first) }
    finally { other.$client.close() }
  })

  it('首次发布同事务建立 create 修订与发布事件，后续保存不动公开版', () => {
    const published = writer.write(command(null, { intent: 'publish' }))
    assert.equal(published.status, 'success')
    const first = published.value.draft
    expect(published.value.publication).not.toBeNull()
    const next = written(writer.write(command(first, { content: { ...content, body: '私有草稿' } })))
    const store = createPostStore(database)
    expect(store.listRevisions(first.id).map(item => item.source)).toEqual(['save', 'create'])
    expect(store.getPublishedPost(first.id)?.body).toBe(content.body)
    expect(store.listPosts()[0]).toMatchObject({ updatedAt: next.updatedAt, status: 'modified' })
    const republished = writer.write(command(next, { intent: 'publish', content: { ...content, body: '当前可见内容' } }))
    assert.equal(republished.status, 'success')
    expect(store.getDraft(first.id)).toEqual(republished.value.draft)
    expect(store.getPublishedPost(first.id)?.body).toBe('当前可见内容')
    expect(store.listRevisions(first.id).map(item => item.source)).toEqual(['publish', 'save', 'create'])
  })

  it('同内容保存与重复发布不制造修订、不刷新草稿和发布时间', () => {
    const original = writer.write(command(null, { intent: 'publish' }))
    assert.equal(original.status, 'success')
    const first = original.value.draft
    const save = writer.write(command(first))
    expect(save).toEqual({ status: 'success', value: { draft: first, publication: null } })
    const again = writer.write(command(first, { intent: 'publish' }))
    expect(again).toEqual(original)
    expect(createPostStore(database).listRevisions(first.id)).toHaveLength(1)
    expect(createPostStore(database).listPublications(first.id)).toHaveLength(1)
    expect(database.select().from(postWriteReceipts).all()).toHaveLength(3)
  })

  it('保存与发布都要求完成标题并保留原始文本，自动写入不属于契约', () => {
    const before = snapshot()
    for (const intent of ['save', 'publish'] as const) {
      expect(writer.write(command(null, { intent, content: { ...content, title: ' \t\n' } })).status).toBe('invalid')
    }
    expect(writingCommandSchema.safeParse({ ...command(null), intent: 'autosave' }).success).toBe(false)
    expect(snapshot()).toEqual(before)
    const saved = written(writer.write(command(null, { content: { ...content, title: ' Title\n' } })))
    expect(saved.title).toBe(' Title\n')
    expect(saved.body).toBe(content.body)
  })

  it('CAS 先于内容比较，旧基线即使内容相同也冲突，两连接不能相互覆盖', () => {
    const first = written(writer.write(command(null)))
    const nextContent = { ...content, body: '其他标签页' }
    const next = written(writer.write(command(first, { content: nextContent })))
    const other = openDatabase(join(directory, 'test.sqlite'))
    try {
      for (const intent of ['save', 'publish'] as const) {
        expect(createWritingStore(other).write(command(first, { intent, content: nextContent })))
          .toEqual({ status: 'conflict', current: next })
      }
      expect(createWritingStore(other).write(command(null, { postId: first.id, content: nextContent })))
        .toEqual({ status: 'conflict', current: next })
    } finally { other.$client.close() }
    expect(createPostStore(database).listRevisions(first.id)).toHaveLength(2)
    expect(database.select().from(postWriteReceipts).all()).toHaveLength(2)
  })

  it('null 基线只允许新身份，缺失文章的非空基线不能创建内容', () => {
    const id = randomUUID()
    expect(writer.write(command(null, { postId: id, expectedRevisionId: 1 }))).toEqual({ status: 'conflict', current: null })
    expect(writer.getDraft(id)).toBeNull()
    database.$client.prepare('INSERT INTO posts (id, created_at) VALUES (?, ?)').run(id, new Date().toISOString())
    const before = snapshot()
    expect(writer.write(command(null, { postId: id }))).toEqual({ status: 'conflict', current: null })
    expect(snapshot()).toEqual(before)
  })

  it('导入和恢复只在内容变化时追加明确修订，旧写入基线随内容变化失效', () => {
    const first = written(writer.write(command(null, { intent: 'publish' })))
    const store = createPostStore(database)
    const published = store.getPublishedPost(first.id)
    expect(store.importDraft({ id: first.id, ...content })).toEqual(first)
    expect(store.restoreRevision(first.id, first.revisionId, first.revisionId)).toEqual({ status: 'success', value: first })
    const imported = store.importDraft({ id: first.id, ...content, body: '文件内容' })
    expect(writer.getDraft(first.id)).toEqual(imported)
    expect(writer.write(command(first))).toEqual({ status: 'conflict', current: imported })
    expect(store.restoreRevision(first.id, first.revisionId, first.revisionId)).toEqual({ status: 'conflict' })
    const restored = store.restoreRevision(first.id, first.revisionId, imported.revisionId)
    assert.equal(restored.status, 'success')
    expect(store.listRevisions(first.id).map(revision => revision.source)).toEqual(['restore', 'import', 'create'])
    expect(store.listRevisions(first.id)[0].restoredFromRevisionId).toBe(first.revisionId)
    expect(store.getPublishedPost(first.id)).toEqual(published)
    expect(store.getRevisionHistory(first.id)?.draft).toEqual(restored.value)
  })
})

describe('明确动作操作回执', () => {
  it('丢响应重放返回原 ACK，随后草稿和公开引用移动也不被回写', () => {
    const input = command(null, { intent: 'publish' })
    const original = writer.write(input)
    const first = written(original)
    expect(writer.write(input)).toEqual(original)
    const latest = written(writer.write(command(first, { intent: 'publish', content: { ...content, body: '更新' } })))
    const before = snapshot()
    expect(writer.write(input)).toEqual(original)
    expect(writer.inspect({ postId: input.postId, operationId: input.operationId })).toEqual(original)
    expect(writer.getDraft(first.id)).toEqual(latest)
    expect(createPostStore(database).getPublishedPost(first.id)?.revisionId).toBe(latest.revisionId)
    expect(snapshot()).toEqual(before)
    expect(createPostStore(database).listRevisions(first.id)).toHaveLength(2)
    expect(createPostStore(database).listPublications(first.id)).toHaveLength(2)
  })

  it('保存回执从不可变修订重建，不借用当前内容和时间，也不带后续发布事件', () => {
    const input = command(null)
    const original = writer.write(input)
    const first = written(original)
    written(writer.write(command(first, { intent: 'publish', content: { ...content, title: 'New title' } })))
    const other = openDatabase(join(directory, 'test.sqlite'))
    try {
      expect(createWritingStore(other).inspect({ postId: first.id, operationId: input.operationId })).toEqual(original)
      expect(createWritingStore(other).write(input)).toEqual(original)
    } finally { other.$client.close() }
  })

  it('同一操作 ID 不得改变正文、意图、文档或基线，对象字段顺序不影响请求身份', () => {
    const input = command(null)
    const original = writer.write(input)
    for (const patch of [
      { content: { ...content, body: '不同' } }, { intent: 'publish' as const },
      { postId: randomUUID() }, { expectedRevisionId: written(original).revisionId },
    ]) expect(writer.write({ ...input, ...patch }).status).toBe('invalid')
    expect(writer.write({ ...input, content: { body: content.body, title: content.title, description: content.description } })).toEqual(original)
    expect(database.select().from(postWriteReceipts).all()).toHaveLength(1)
  })

  it('inspect 只读现有回执，未知操作返回 unconfirmed 且不创建身份、修订或回执', () => {
    const input = command(null)
    const before = snapshot()
    database.$client.pragma('query_only = ON')
    try {
      expect(writer.inspect({ postId: input.postId, operationId: input.operationId })).toEqual({ status: 'unconfirmed' })
      expect(writer.getDraft(input.postId)).toBeNull()
    } finally { database.$client.pragma('query_only = OFF') }
    expect(snapshot()).toEqual(before)
    const original = writer.write(input)
    const after = snapshot()
    database.$client.pragma('query_only = ON')
    try {
      expect(writer.inspect({ postId: input.postId, operationId: input.operationId })).toEqual(original)
      expect(writer.inspect({ postId: input.postId, operationId: randomUUID() })).toEqual({ status: 'unconfirmed' })
      expect(writer.inspect({ postId: randomUUID(), operationId: input.operationId }).status).toBe('invalid')
    } finally { database.$client.pragma('query_only = OFF') }
    expect(snapshot()).toEqual(after)
  })

  it('inspect 的操作身份必须合法且完整，不接受正文或代写入命令', () => {
    const input = command(null)
    expect(operationIdentitySchema.safeParse(input).success).toBe(false)
    expect(writer.inspect(input).status).toBe('invalid')
    expect(writer.inspect({ postId: input.postId, operationId: 'bad' }).status).toBe('invalid')
    expect(writer.inspect({ postId: 'not-a-uuid', operationId: input.operationId }).status).toBe('invalid')
    expect(database.select().from(postWriteReceipts).all()).toEqual([])
  })

  it('回执写入失败时身份、修订、草稿和发布全部回滚，inspect 不替代重试', () => {
    database.$client.exec(`CREATE TRIGGER reject_receipt BEFORE INSERT ON post_write_receipts
      BEGIN SELECT RAISE(ABORT, 'receipt unavailable'); END;`)
    const input = command(null, { intent: 'publish' })
    const before = snapshot()
    expect(() => writer.write(input)).toThrow('receipt unavailable')
    expect(writer.getDraft(input.postId)).toBeNull()
    expect(writer.inspect({ postId: input.postId, operationId: input.operationId })).toEqual({ status: 'unconfirmed' })
    expect(snapshot()).toEqual(before)
    database.$client.exec('DROP TRIGGER reject_receipt')
    expect(writer.write(input).status).toBe('success')
  })

  it.each(['save', 'publish'] as const)('已有稿件 %s 的回执失败也完整回滚新修订、草稿头和公开引用', intent => {
    const first = written(writer.write(command(null, { intent: 'publish' })))
    const input = command(first, { intent, content: { ...content, body: '尚未确认的新内容' } })
    const before = snapshot()
    database.$client.exec(`CREATE TRIGGER reject_receipt BEFORE INSERT ON post_write_receipts
      BEGIN SELECT RAISE(ABORT, 'receipt unavailable'); END;`)
    expect(() => writer.write(input)).toThrow('receipt unavailable')
    expect(writer.getDraft(first.id)).toEqual(first)
    expect(writer.inspect({ postId: first.id, operationId: input.operationId })).toEqual({ status: 'unconfirmed' })
    expect(snapshot()).toEqual(before)
    database.$client.exec('DROP TRIGGER reject_receipt')
    expect(writer.write(input).status).toBe('success')
  })

  it('回执只存不可变引用与请求摘要，不可更新，文章删除级联释放', () => {
    const input = command(null)
    const draft = written(writer.write(input))
    const receipt = database.select().from(postWriteReceipts).get()
    expect(receipt).toEqual({
      operationId: input.operationId, postId: draft.id, requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      revisionId: draft.revisionId, publicationId: null,
    })
    expect(() => database.$client.exec("UPDATE post_write_receipts SET request_hash = 'changed'"))
      .toThrow('Post write receipts are immutable')
    database.$client.prepare('DELETE FROM posts WHERE id = ?').run(input.postId)
    expect(database.select().from(postWriteReceipts).all()).toEqual([])
    expect(writer.inspect({ postId: input.postId, operationId: input.operationId })).toEqual({ status: 'unconfirmed' })
  })

  it('真实外键约束回执引用同文章的修订及该修订的发布事件', () => {
    const first = written(writer.write(command(null)))
    const published = writer.write(command(first, { intent: 'publish', content: { ...content, body: 'Published' } }))
    assert.equal(published.status, 'success')
    assert.ok(published.value.publication)
    const other = written(writer.write(command(null)))
    const receipt = {
      operationId: randomUUID(), requestHash: 'hash', postId: first.id,
      revisionId: first.revisionId, publicationId: published.value.publication.id,
    }
    expect(() => database.insert(postWriteReceipts).values(receipt).run()).toThrow()
    expect(() => database.insert(postWriteReceipts).values({ ...receipt, publicationId: null, revisionId: other.revisionId }).run()).toThrow()
    expect(() => database.$client.prepare(`INSERT INTO post_write_receipts (operation_id, post_id, request_hash, revision_id)
      VALUES (?, ?, ?, NULL)`).run(randomUUID(), first.id, 'hash')).toThrow()
    expect(database.$client.pragma('foreign_key_check')).toEqual([])
  })

  it('外部命令拒绝系统字段、旧基线字段和非法身份', () => {
    expect(writingCommandSchema.safeParse({ ...command(null), operationId: 'bad' }).success).toBe(false)
    expect(writingCommandSchema.safeParse({ ...command(null), unexpected: true }).success).toBe(false)
    expect(writingCommandSchema.safeParse({ ...command(null), expectedVersion: 'old' }).success).toBe(false)
    expect(writingCommandSchema.safeParse({ ...command(null), content: { ...content, revisionId: 1 } }).success).toBe(false)
    expect(writer.write(command(null, { postId: 'not-a-uuid' })).status).toBe('invalid')
  })
})

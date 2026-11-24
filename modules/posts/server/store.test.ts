// @vitest-environment node
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { initializeDatabase, openDatabase, type ManagedDatabase } from '@/lib/server/database'
import { createPostStore, importPublishedPosts, type PostStore } from './store'
import { createWritingStore } from './writing-store'
import type { WritingStore } from '../writing'
import { createTestDraft, publishTestDraft, saveTestDraft } from '@/test/post-commands'
import type { DraftPost, PostContent, PostMutationResult } from '../model'
import { postDrafts, postPublications, postPublished, postRevisions, posts } from './schema'

let directory: string
let target: string
let database: ManagedDatabase
let store: PostStore
let writer: WritingStore

const content = { title: 'First post', description: 'Description.', body: '# First body\r\n' }

function success<T>(result: PostMutationResult<T>): T {
  assert.ok(result.status === 'success')
  return result.value
}

function save(draft: DraftPost, input: PostContent) {
  return saveTestDraft(writer, draft, input)
}

function publish(draft: DraftPost, input: PostContent = draft) {
  return publishTestDraft(writer, draft, input)
}

async function snapshot() {
  return {
    posts: await database.select().from(posts),
    revisions: await database.select().from(postRevisions),
    drafts: await database.select().from(postDrafts),
    publications: await database.select().from(postPublications),
    published: await database.select().from(postPublished),
  }
}

async function createRejectTrigger(table: string, operation: 'INSERT' | 'UPDATE', message: string) {
  await database.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION reject_${table}_${operation.toLowerCase()}()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION '${message}';
    END;
    $$ LANGUAGE plpgsql;
  `))
  await database.execute(sql.raw(`
    CREATE TRIGGER reject_${table}_${operation.toLowerCase()}_trg
    BEFORE ${operation} ON ${table}
    FOR EACH ROW EXECUTE FUNCTION reject_${table}_${operation.toLowerCase()}();
  `))
}

async function dropRejectTrigger(table: string, operation: 'INSERT' | 'UPDATE') {
  await database.execute(sql.raw(`DROP TRIGGER IF EXISTS reject_${table}_${operation.toLowerCase()}_trg ON ${table};`))
  await database.execute(sql.raw(`DROP FUNCTION IF EXISTS reject_${table}_${operation.toLowerCase()}();`))
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'nim-posts-'))
  target = join(directory, 'pgdata')
  await initializeDatabase(target)
  database = await openDatabase(target)
  store = createPostStore(database)
  writer = createWritingStore(database)
})

afterEach(async () => {
  await database?.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

describe('文章修订与草稿', () => {
  it('生成独立文章身份和首次修订，重开数据库及重复初始化后仍在', async () => {
    const draft = await createTestDraft(writer, content)
    const another = await createTestDraft(writer, content)
    expect(another.id).not.toBe(draft.id)
    expect(await store.listRevisions(draft.id)).toEqual([{
      id: draft.revisionId, postId: draft.id, ...content,
      createdAt: draft.updatedAt, source: 'create', restoredFromRevisionId: null,
    }])
    await database.close()
    await initializeDatabase(target)
    database = await openDatabase(target)
    store = createPostStore(database)
    writer = createWritingStore(database)
    expect(await store.getDraft(draft.id)).toEqual(draft)
    expect(await store.getPublishedPost(draft.id)).toBeNull()
  })

  it('同一无 ID 导入标识重试不重复建稿，固定以 import 创建，内容不同则冲突', async () => {
    const id = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'
    const created = success(await store.createImportedDraftOnce(id, content))
    expect((await store.listRevisions(id))[0].source).toBe('import')
    const before = await snapshot()
    expect(success(await store.createImportedDraftOnce(id, content))).toEqual(created)
    expect(await snapshot()).toEqual(before)
    expect(await store.createImportedDraftOnce(id, { ...content, body: '# Changed after lost response' }))
      .toEqual({ status: 'conflict' })
    expect(await snapshot()).toEqual(before)
    const edited = await save(created, { ...content, title: 'Edited elsewhere' })
    expect(await store.createImportedDraftOnce(id, content)).toEqual({ status: 'conflict' })
    expect(await store.getDraft(id)).toEqual(edited)
  })

  it('内容变化才追加修订，不改写旧版，也不为相同内容刷新时间', async () => {
    const draft = await createTestDraft(writer, content)
    expect(await save(draft, content)).toEqual(draft)
    const revised = await save(draft, { ...content, body: '# Revised\n' })
    expect(revised.revisionId).not.toBe(draft.revisionId)
    expect((await store.listRevisions(draft.id)).map(revision => revision.source)).toEqual(['save', 'create'])
    expect(await store.getRevision(draft.id, draft.revisionId)).toMatchObject(content)
    expect(await save(revised, revised)).toEqual(revised)
    expect(await store.listRevisions(draft.id)).toHaveLength(2)
    const returned = await save(revised, content)
    expect(returned.revisionId).not.toBe(draft.revisionId)
    expect(await store.listRevisions(draft.id)).toHaveLength(3)
  })

  it('写命令拒绝混入内容的身份与持久化字段，保持当前稿件不变', async () => {
    const original = await createTestDraft(writer, content)
    const sourceRevision = await store.getRevision(original.id, original.revisionId)
    assert.ok(sourceRevision)
    const before = await snapshot()
    const input = { ...original, ...sourceRevision, stage: 'published' }
    expect((await writer.write({
      postId: original.id, operationId: randomUUID(), expectedRevisionId: original.revisionId,
      intent: 'save', content: input,
    })).status).toBe('invalid')
    expect(await snapshot()).toEqual(before)
  })

  it('不存在的文章与修订返回缺失结果，不留下身份或快照', async () => {
    expect(await store.getDraft('missing')).toBeNull()
    expect(await store.getPublishedPost('missing')).toBeNull()
    expect(await store.getRevision('missing', 1)).toBeNull()
    expect(await writer.write({
      postId: randomUUID(), operationId: randomUUID(), expectedRevisionId: 1, intent: 'save', content,
    })).toEqual({ status: 'conflict', current: null })
    expect(await writer.write({
      postId: randomUUID(), operationId: randomUUID(), expectedRevisionId: 1, intent: 'publish', content,
    })).toEqual({ status: 'conflict', current: null })
    expect(await store.restoreRevision('missing', 1, 1)).toEqual({ status: 'missing' })
    expect(await snapshot()).toEqual({ posts: [], revisions: [], drafts: [], publications: [], published: [] })
  })

  it('创建修订失败时一并回滚文章身份，排除故障后可重试', async () => {
    await createRejectTrigger('post_revisions', 'INSERT', 'revision unavailable')
    await expect(createTestDraft(writer, content)).rejects.toThrow()
    expect((await snapshot()).posts).toEqual([])
    await dropRejectTrigger('post_revisions', 'INSERT')
    const draft = await createTestDraft(writer, content)
    expect(await store.getDraft(draft.id)).toEqual(draft)
  })

  it('草稿头更新失败时不留下孤立的新修订', async () => {
    const draft = await createTestDraft(writer, content)
    const before = await snapshot()
    await createRejectTrigger('post_drafts', 'UPDATE', 'head unavailable')
    await expect(save(draft, { ...content, title: 'Changed' })).rejects.toThrow()
    expect(await snapshot()).toEqual(before)
  })
})

describe('编辑基线与显式导入', () => {
  it('另一编辑入口保存后，旧基线的保存、发布和恢复均冲突，即使内容相同', async () => {
    const draft = await createTestDraft(writer, content)
    const revised = await save(draft, { ...content, title: 'Changed' })
    const before = await snapshot()
    for (const intent of ['save', 'publish'] as const) expect(await writer.write({
      postId: draft.id, operationId: randomUUID(), expectedRevisionId: draft.revisionId, intent,
      content: { title: revised.title, description: revised.description, body: revised.body },
    })).toEqual({ status: 'conflict', current: revised })
    expect(await store.restoreRevision(draft.id, draft.revisionId, draft.revisionId)).toEqual({ status: 'conflict' })
    expect(await snapshot()).toEqual(before)
  })

  it('存储导入要求明确身份，不在缺失身份时另建文章', async () => {
    const before = await snapshot()
    // @ts-expect-error 未分配身份的文件解析结果不是存储导入命令。
    await expect(store.importDraft(content)).rejects.toThrow(z.ZodError)
    expect(await snapshot()).toEqual(before)
  })

  it('只按传入身份创建或覆盖草稿，既有公开内容保持不变', async () => {
    const draft = await createTestDraft(writer, content)
    const published = await publish(draft)
    const imported = await store.importDraft({ ...content, id: draft.id, body: '# Imported\n\n' })
    expect(imported.id).toBe(draft.id)
    expect(imported.createdAt).toBe(draft.createdAt)
    expect(await store.getPublishedPost(draft.id)).toEqual(published)
    expect((await store.listRevisions(draft.id))[0].source).toBe('import')
    expect(await store.importDraft(imported)).toEqual(imported)
    expect(await store.listRevisions(draft.id)).toHaveLength(2)
    expect(await writer.write({
      postId: draft.id, operationId: randomUUID(), expectedRevisionId: draft.revisionId, intent: 'save', content,
    })).toEqual({ status: 'conflict', current: imported })

    const specifiedId = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'
    expect((await store.importDraft({ ...content, id: specifiedId })).id).toBe(specifiedId)
    expect(await store.getPublishedPost(specifiedId)).toBeNull()
  })
})

describe('发布快照与发布记录', () => {
  it('发布当前可见的未保存内容，原子更新草稿与公开引用', async () => {
    const draft = await createTestDraft(writer, content)
    const visible = { ...content, title: 'Visible title', body: '# Visible\r\n' }
    const published = await publish(draft, visible)
    expect(published).toMatchObject(visible)
    expect(await store.getDraft(draft.id)).toMatchObject({ ...visible, revisionId: published.revisionId })
    expect((await store.listRevisions(draft.id)).map(revision => revision.source)).toEqual(['publish', 'create'])
    expect(await store.listPublications(draft.id)).toEqual([{
      id: published.publicationId, postId: draft.id, revisionId: published.revisionId, publishedAt: published.publishedAt,
    }])
  })

  it('已保存内容发布不复制修订，重复发布同一当前修订不刷时间或发布记录', async () => {
    const draft = await createTestDraft(writer, content)
    const published = await publish(draft)
    expect(await publish(draft)).toEqual(published)
    expect(await store.listRevisions(draft.id)).toHaveLength(1)
    expect(await store.listPublications(draft.id)).toHaveLength(1)
    const edited = await save(draft, { ...content, title: 'Edited' })
    expect(await store.getPublishedPost(draft.id)).toEqual(published)
    const next = await publish(edited)
    expect(next.publicationId).not.toBe(published.publicationId)
    expect(await store.listPublications(draft.id)).toHaveLength(2)
    expect(await store.listRevisions(draft.id)).toHaveLength(2)
  })

  it.each([
    ['post_revisions', 'INSERT'],
    ['post_publications', 'INSERT'],
    ['post_published', 'UPDATE'],
  ] as const)('发布在 %s 写入失败时整体回滚', async (table, operation) => {
    const draft = await createTestDraft(writer, content)
    await publish(draft)
    const before = await snapshot()
    await createRejectTrigger(table, operation, 'publication unavailable')
    await expect(publish(draft, { ...content, body: '# Unsaved publication' })).rejects.toThrow()
    expect(await snapshot()).toEqual(before)
  })
})

describe('历史恢复与管理状态', () => {
  it('恢复只追加草稿修订，不删除后续历史或改变公开内容，按内容判断已发布状态', async () => {
    const draft = await createTestDraft(writer, content)
    const published = await publish(draft)
    const edited = await save(draft, { ...content, body: '# Modified' })
    expect((await store.listPosts())[0].status).toBe('modified')
    const restored = success(await store.restoreRevision(draft.id, draft.revisionId, edited.revisionId))
    expect(restored.revisionId).not.toBe(draft.revisionId)
    expect(await store.getRevision(draft.id, restored.revisionId)).toMatchObject({
      ...content, source: 'restore', restoredFromRevisionId: draft.revisionId,
    })
    expect(await store.listRevisions(draft.id)).toHaveLength(3)
    expect(await store.getPublishedPost(draft.id)).toEqual(published)
    expect(await store.listPosts()).toEqual([{
      id: draft.id, title: content.title, description: content.description,
      updatedAt: restored.updatedAt, status: 'published',
    }])
    expect(success(await store.restoreRevision(draft.id, draft.revisionId, restored.revisionId))).toEqual(restored)
    const republished = await publish(restored)
    expect(republished.publicationId).not.toBe(published.publicationId)
    expect(await store.listPublications(draft.id)).toHaveLength(2)
  })

  it('不能读取或恢复另一篇文章的修订', async () => {
    const draft = await createTestDraft(writer, content)
    const another = await createTestDraft(writer, { ...content, title: 'Another' })
    const before = await snapshot()
    expect(await store.getRevision(draft.id, another.revisionId)).toBeNull()
    expect(await store.restoreRevision(draft.id, another.revisionId, draft.revisionId)).toEqual({ status: 'missing' })
    expect(await snapshot()).toEqual(before)
  })

  it('真实外键拒绝跨文章的草稿、发布修订、公开指针和恢复来源', async () => {
    const draft = await createTestDraft(writer, content)
    const another = await createTestDraft(writer, { ...content, title: 'Another' })
    const published = await publish(another)
    await expect(database.update(postDrafts).set({ revisionId: another.revisionId })
      .where(eq(postDrafts.postId, draft.id))).rejects.toThrow()
    await expect(database.insert(postPublications).values({
      postId: draft.id, revisionId: another.revisionId, publishedAt: new Date().toISOString(),
    })).rejects.toThrow()
    await expect(database.insert(postPublished).values({ postId: draft.id, publicationId: published.publicationId })).rejects.toThrow()
    await expect(database.insert(postRevisions).values({
      postId: draft.id, ...content, createdAt: new Date().toISOString(), source: 'restore',
      restoredFromRevisionId: another.revisionId,
    })).rejects.toThrow()
  })

  it('修订与发布记录不可更新，整篇删除仍可级联清理其记录', async () => {
    const draft = await createTestDraft(writer, content)
    const published = await publish(draft)
    const edited = await save(draft, { ...content, title: 'Edited' })
    success(await store.restoreRevision(draft.id, draft.revisionId, edited.revisionId))
    await expect(database.update(postRevisions).set({ body: 'Changed' }).where(eq(postRevisions.id, draft.revisionId)))
      .rejects.toMatchObject({ cause: { message: expect.stringContaining('Post revisions are immutable') } })
    await expect(database.update(postPublications).set({ publishedAt: '2099-01-01' }).where(eq(postPublications.id, published.publicationId)))
      .rejects.toMatchObject({ cause: { message: expect.stringContaining('Post publications are immutable') } })
    await database.delete(posts).where(eq(posts.id, draft.id))
    expect(await snapshot()).toEqual({ posts: [], revisions: [], drafts: [], publications: [], published: [] })
  })
})

describe('修订历史读取', () => {
  it('按文章与时间读取一页历史时不排序扫描全部修订', async () => {
    const draft = await createTestDraft(writer, content)
    const result = await database.transaction(async tx => {
      await tx.execute(sql`SET LOCAL enable_seqscan = off`)
      await tx.execute(sql`SET LOCAL enable_bitmapscan = off`)
      return tx.execute(sql`
        EXPLAIN (FORMAT TEXT)
        SELECT id, title, created_at, source FROM post_revisions
        WHERE post_id = ${draft.id} ORDER BY created_at DESC, id DESC LIMIT 20
      `)
    })
    const rows = (result as { rows: Record<string, unknown>[] }).rows
    const plan = rows.map(row => String(Object.values(row)[0])).join('\n')
    expect(plan).toContain('post_revisions_history_idx')
    expect(plan).not.toContain('Sort')
  })

  it('分页只读取摘要，选中的完整修订独立于当前页，同时返回一致的草稿与公开引用', async () => {
    let draft = await createTestDraft(writer, content)
    const original = draft
    const published = await publish(draft)
    for (let index = 0; index < 24; index += 1) draft = await save(draft, { ...content, body: `# Revision ${index}` })

    const first = await store.getRevisionHistory(draft.id, { page: 1, revisionId: original.revisionId })
    assert.ok(first)
    expect(first.draft).toEqual(draft)
    expect(first.published).toEqual(published)
    expect(first.selectedRevision).toMatchObject({ id: original.revisionId, body: content.body })
    expect(first.revisions).toHaveLength(20)
    expect(first.revisionCount).toBe(25)
    expect(first.pageCount).toBe(2)
    expect(first.revisions.every(revision => !('body' in revision) && !('description' in revision))).toBe(true)
    const second = await store.getRevisionHistory(draft.id, { page: 2 })
    assert.ok(second)
    expect(second.revisions).toHaveLength(5)
    expect(second.selectedRevision.id).toBe(draft.revisionId)
    expect(new Set([...first.revisions, ...second.revisions].map(revision => revision.id)).size).toBe(25)
    expect(await store.getRevisionHistory(draft.id, { page: 3 })).toBeNull()
  })

  it('不返回不存在文章、跨文章选中修订或无效分页的历史', async () => {
    const draft = await createTestDraft(writer, content)
    const another = await createTestDraft(writer, { ...content, title: 'Another' })
    expect(await store.getRevisionHistory('missing')).toBeNull()
    expect(await store.getRevisionHistory(draft.id, { page: 1, revisionId: another.revisionId })).toBeNull()
    expect(await store.getRevisionHistory(draft.id, { page: 0 })).toBeNull()
    expect(await store.getRevisionHistory(draft.id, { page: 1.5 })).toBeNull()
  })
})

describe('初始发布素材导入', () => {
  it('保留原文，重复导入不覆盖现有草稿或公开内容，也不发布已有未发布稿', async () => {
    const existing = await createTestDraft(writer, content)
    const published = await publish(existing)
    const edited = await save(existing, { ...content, title: 'Edited' })
    const unpublished = await createTestDraft(writer, content)
    const input = { id: '9ea8d4be-4b45-46d2-954c-3e1da354d33f', ...content }
    expect(await importPublishedPosts(database, [input, { ...content, id: existing.id }, { ...content, id: unpublished.id }]))
      .toEqual({ imported: 1, skipped: 2 })
    expect(await store.getDraft(existing.id)).toEqual(edited)
    expect(await store.getPublishedPost(existing.id)).toEqual(published)
    expect(await store.getPublishedPost(unpublished.id)).toBeNull()
    expect(await store.getPublishedPost(input.id)).toMatchObject(input)
    expect(await store.getDraft(input.id)).toMatchObject(input)
  })

  it('整批导入中途失败时回滚前面的身份、修订和发布引用，并拒绝非 UUID 身份', async () => {
    await expect(importPublishedPosts(database, [{ id: 'not-a-uuid', ...content }])).rejects.toThrow(z.ZodError)
    const firstId = randomUUID()
    const inputs = [
      { id: firstId, ...content },
      { id: randomUUID(), ...content, title: ' \t ' },
    ]
    await expect(importPublishedPosts(database, inputs)).rejects.toThrow()
    expect(await snapshot()).toEqual({ posts: [], revisions: [], drafts: [], publications: [], published: [] })
    expect(await importPublishedPosts(database, [{ id: firstId, ...content }])).toEqual({ imported: 1, skipped: 0 })
  })
})

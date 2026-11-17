// @vitest-environment node
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { initializeDatabase, openDatabase, type AppDatabase } from './server/database'
import { createPostStore, importPublishedPosts } from './posts'
import { createWritingStore } from './writing-store'
import type { WritingStore } from './writing'
import { createTestDraft, publishTestDraft, saveTestDraft } from '../test/post-commands'
import type { DraftPost, PostContent, PostMutationResult, PostStore } from './content'
import { postDrafts, postPublications, postPublished, postRevisions, posts } from './schema'

let directory: string
let filename: string
let database: AppDatabase
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

function snapshot() {
  return {
    posts: database.select().from(posts).all(),
    revisions: database.select().from(postRevisions).all(),
    drafts: database.select().from(postDrafts).all(),
    publications: database.select().from(postPublications).all(),
    published: database.select().from(postPublished).all(),
  }
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'nim-posts-'))
  filename = join(directory, 'nim.sqlite')
  await initializeDatabase(filename)
  database = openDatabase(filename)
  store = createPostStore(database)
  writer = createWritingStore(database)
})

afterEach(() => {
  if (database?.$client.open) database.$client.close()
  if (directory) rmSync(directory, { recursive: true })
})

describe('文章修订与草稿', () => {
  it('生成独立文章身份和首次修订，重开数据库及重复初始化后仍在', async () => {
    const draft = createTestDraft(writer, content)
    const another = createTestDraft(writer, content)
    expect(another.id).not.toBe(draft.id)
    expect(store.listRevisions(draft.id)).toEqual([{
      id: draft.revisionId, postId: draft.id, ...content,
      createdAt: draft.updatedAt, source: 'create', restoredFromRevisionId: null,
    }])
    database.$client.close()
    await initializeDatabase(filename)
    database = openDatabase(filename)
    store = createPostStore(database)
    writer = createWritingStore(database)
    expect(store.getDraft(draft.id)).toEqual(draft)
    expect(store.getPublishedPost(draft.id)).toBeNull()
  })

  it('同一无 ID 导入标识重试不重复建稿，固定以 import 创建，内容不同则冲突', () => {
    const id = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'
    const created = success(store.createImportedDraftOnce(id, content))
    expect(store.listRevisions(id)[0].source).toBe('import')
    const before = snapshot()
    expect(success(store.createImportedDraftOnce(id, content))).toEqual(created)
    expect(snapshot()).toEqual(before)
    expect(store.createImportedDraftOnce(id, { ...content, body: '# Changed after lost response' }))
      .toEqual({ status: 'conflict' })
    expect(snapshot()).toEqual(before)
    const edited = save(created, { ...content, title: 'Edited elsewhere' })
    expect(store.createImportedDraftOnce(id, content)).toEqual({ status: 'conflict' })
    expect(store.getDraft(id)).toEqual(edited)
  })

  it('内容变化才追加修订，不改写旧版，也不为相同内容刷新时间', () => {
    const draft = createTestDraft(writer, content)
    expect(save(draft, content)).toEqual(draft)
    const revised = save(draft, { ...content, body: '# Revised\n' })
    expect(revised.revisionId).not.toBe(draft.revisionId)
    expect(store.listRevisions(draft.id).map(revision => revision.source)).toEqual(['save', 'create'])
    expect(store.getRevision(draft.id, draft.revisionId)).toMatchObject(content)
    expect(save(revised, revised)).toEqual(revised)
    expect(store.listRevisions(draft.id)).toHaveLength(2)
    const returned = save(revised, content)
    expect(returned.revisionId).not.toBe(draft.revisionId)
    expect(store.listRevisions(draft.id)).toHaveLength(3)
  })

  it('写命令拒绝混入内容的身份与持久化字段，保持当前稿件不变', () => {
    const original = createTestDraft(writer, content)
    const sourceRevision = store.getRevision(original.id, original.revisionId)
    assert.ok(sourceRevision)
    const before = snapshot()
    const input = { ...original, ...sourceRevision, stage: 'published' }
    expect(writer.write({
      postId: original.id, operationId: randomUUID(), expectedRevisionId: original.revisionId,
      intent: 'save', content: input,
    }).status).toBe('invalid')
    expect(snapshot()).toEqual(before)
  })

  it('不存在的文章与修订返回缺失结果，不留下身份或快照', () => {
    expect(store.getDraft('missing')).toBeNull()
    expect(store.getPublishedPost('missing')).toBeNull()
    expect(store.getRevision('missing', 1)).toBeNull()
    expect(writer.write({
      postId: randomUUID(), operationId: randomUUID(), expectedRevisionId: 1, intent: 'save', content,
    })).toEqual({ status: 'conflict', current: null })
    expect(writer.write({
      postId: randomUUID(), operationId: randomUUID(), expectedRevisionId: 1, intent: 'publish', content,
    })).toEqual({ status: 'conflict', current: null })
    expect(store.restoreRevision('missing', 1, 1)).toEqual({ status: 'missing' })
    expect(snapshot()).toEqual({ posts: [], revisions: [], drafts: [], publications: [], published: [] })
  })

  it('创建修订失败时一并回滚文章身份，排除故障后可重试', () => {
    database.$client.exec(`CREATE TRIGGER reject_revision BEFORE INSERT ON post_revisions
      BEGIN SELECT RAISE(ABORT, 'revision unavailable'); END;`)
    expect(() => createTestDraft(writer, content)).toThrow()
    expect(snapshot().posts).toEqual([])
    database.$client.exec('DROP TRIGGER reject_revision')
    const draft = createTestDraft(writer, content)
    expect(store.getDraft(draft.id)).toEqual(draft)
  })

  it('草稿头更新失败时不留下孤立的新修订', () => {
    const draft = createTestDraft(writer, content)
    const before = snapshot()
    database.$client.exec(`CREATE TRIGGER reject_head BEFORE UPDATE ON post_drafts
      BEGIN SELECT RAISE(ABORT, 'head unavailable'); END;`)
    expect(() => save(draft, { ...content, title: 'Changed' })).toThrow()
    expect(snapshot()).toEqual(before)
  })
})

describe('编辑基线与显式导入', () => {
  it('另一编辑入口保存后，旧基线的保存、发布和恢复均冲突，即使内容相同', () => {
    const draft = createTestDraft(writer, content)
    const revised = save(draft, { ...content, title: 'Changed' })
    const before = snapshot()
    for (const intent of ['save', 'publish'] as const) expect(writer.write({
      postId: draft.id, operationId: randomUUID(), expectedRevisionId: draft.revisionId, intent,
      content: { title: revised.title, description: revised.description, body: revised.body },
    })).toEqual({ status: 'conflict', current: revised })
    expect(store.restoreRevision(draft.id, draft.revisionId, draft.revisionId)).toEqual({ status: 'conflict' })
    expect(snapshot()).toEqual(before)
  })

  it('存储导入要求明确身份，不在缺失身份时另建文章', () => {
    const before = snapshot()
    // @ts-expect-error 未分配身份的文件解析结果不是存储导入命令。
    expect(() => store.importDraft(content)).toThrow(z.ZodError)
    expect(snapshot()).toEqual(before)
  })

  it('只按传入身份创建或覆盖草稿，既有公开内容保持不变', () => {
    const draft = createTestDraft(writer, content)
    const published = publish(draft)
    const imported = store.importDraft({ ...content, id: draft.id, body: '# Imported\n\n' })
    expect(imported.id).toBe(draft.id)
    expect(imported.createdAt).toBe(draft.createdAt)
    expect(store.getPublishedPost(draft.id)).toEqual(published)
    expect(store.listRevisions(draft.id)[0].source).toBe('import')
    expect(store.importDraft(imported)).toEqual(imported)
    expect(store.listRevisions(draft.id)).toHaveLength(2)
    expect(writer.write({
      postId: draft.id, operationId: randomUUID(), expectedRevisionId: draft.revisionId, intent: 'save', content,
    })).toEqual({ status: 'conflict', current: imported })

    const specifiedId = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'
    expect(store.importDraft({ ...content, id: specifiedId }).id).toBe(specifiedId)
    expect(store.getPublishedPost(specifiedId)).toBeNull()
  })
})

describe('发布快照与发布记录', () => {
  it('发布当前可见的未保存内容，原子更新草稿与公开引用', () => {
    const draft = createTestDraft(writer, content)
    const visible = { ...content, title: 'Visible title', body: '# Visible\r\n' }
    const published = publish(draft, visible)
    expect(published).toMatchObject(visible)
    expect(store.getDraft(draft.id)).toMatchObject({ ...visible, revisionId: published.revisionId })
    expect(store.listRevisions(draft.id).map(revision => revision.source)).toEqual(['publish', 'create'])
    expect(store.listPublications(draft.id)).toEqual([{
      id: published.publicationId, postId: draft.id, revisionId: published.revisionId, publishedAt: published.publishedAt,
    }])
  })

  it('已保存内容发布不复制修订，重复发布同一当前修订不刷时间或发布记录', () => {
    const draft = createTestDraft(writer, content)
    const published = publish(draft)
    expect(publish(draft)).toEqual(published)
    expect(store.listRevisions(draft.id)).toHaveLength(1)
    expect(store.listPublications(draft.id)).toHaveLength(1)
    const edited = save(draft, { ...content, title: 'Edited' })
    expect(store.getPublishedPost(draft.id)).toEqual(published)
    const next = publish(edited)
    expect(next.publicationId).not.toBe(published.publicationId)
    expect(store.listPublications(draft.id)).toHaveLength(2)
    expect(store.listRevisions(draft.id)).toHaveLength(2)
  })

  it.each([
    ['post_revisions', 'INSERT'],
    ['post_publications', 'INSERT'],
    ['post_published', 'UPDATE'],
  ])('发布在 %s 写入失败时整体回滚', (table, operation) => {
    const draft = createTestDraft(writer, content)
    publish(draft)
    const before = snapshot()
    database.$client.exec(`CREATE TRIGGER reject_publish BEFORE ${operation} ON ${table}
      BEGIN SELECT RAISE(ABORT, 'publication unavailable'); END;`)
    expect(() => publish(draft, { ...content, body: '# Unsaved publication' })).toThrow()
    expect(snapshot()).toEqual(before)
  })
})

describe('历史恢复与管理状态', () => {
  it('恢复只追加草稿修订，不删除后续历史或改变公开内容，按内容判断已发布状态', () => {
    const draft = createTestDraft(writer, content)
    const published = publish(draft)
    const edited = save(draft, { ...content, body: '# Modified' })
    expect(store.listPosts()[0].status).toBe('modified')
    const restored = success(store.restoreRevision(draft.id, draft.revisionId, edited.revisionId))
    expect(restored.revisionId).not.toBe(draft.revisionId)
    expect(store.getRevision(draft.id, restored.revisionId)).toMatchObject({
      ...content, source: 'restore', restoredFromRevisionId: draft.revisionId,
    })
    expect(store.listRevisions(draft.id)).toHaveLength(3)
    expect(store.getPublishedPost(draft.id)).toEqual(published)
    expect(store.listPosts()).toEqual([{
      id: draft.id, title: content.title, description: content.description,
      updatedAt: restored.updatedAt, status: 'published',
    }])
    expect(success(store.restoreRevision(draft.id, draft.revisionId, restored.revisionId))).toEqual(restored)
    const republished = publish(restored)
    expect(republished.publicationId).not.toBe(published.publicationId)
    expect(store.listPublications(draft.id)).toHaveLength(2)
  })

  it('不能读取或恢复另一篇文章的修订', () => {
    const draft = createTestDraft(writer, content)
    const another = createTestDraft(writer, { ...content, title: 'Another' })
    const before = snapshot()
    expect(store.getRevision(draft.id, another.revisionId)).toBeNull()
    expect(store.restoreRevision(draft.id, another.revisionId, draft.revisionId)).toEqual({ status: 'missing' })
    expect(snapshot()).toEqual(before)
  })

  it('真实外键拒绝跨文章的草稿、发布修订、公开指针和恢复来源', () => {
    const draft = createTestDraft(writer, content)
    const another = createTestDraft(writer, { ...content, title: 'Another' })
    const published = publish(another)
    expect(() => database.update(postDrafts).set({ revisionId: another.revisionId })
      .where(eq(postDrafts.postId, draft.id)).run()).toThrow()
    expect(() => database.insert(postPublications).values({
      postId: draft.id, revisionId: another.revisionId, publishedAt: new Date().toISOString(),
    }).run()).toThrow()
    expect(() => database.insert(postPublished).values({ postId: draft.id, publicationId: published.publicationId }).run()).toThrow()
    expect(() => database.insert(postRevisions).values({
      postId: draft.id, ...content, createdAt: new Date().toISOString(), source: 'restore',
      restoredFromRevisionId: another.revisionId,
    }).run()).toThrow()
    expect(database.$client.pragma('foreign_key_check')).toEqual([])
  })

  it('修订与发布记录不可更新，整篇删除仍可级联清理其记录', () => {
    const draft = createTestDraft(writer, content)
    const published = publish(draft)
    const edited = save(draft, { ...content, title: 'Edited' })
    success(store.restoreRevision(draft.id, draft.revisionId, edited.revisionId))
    expect(() => database.update(postRevisions).set({ body: 'Changed' }).where(eq(postRevisions.id, draft.revisionId)).run()).toThrow()
    expect(() => database.update(postPublications).set({ publishedAt: '2099-01-01' }).where(eq(postPublications.id, published.publicationId)).run()).toThrow()
    database.delete(posts).where(eq(posts.id, draft.id)).run()
    expect(snapshot()).toEqual({ posts: [], revisions: [], drafts: [], publications: [], published: [] })
  })
})

describe('修订历史读取', () => {
  it('按文章与时间读取一页历史时不排序扫描全部修订', () => {
    const draft = createTestDraft(writer, content)
    const rows = database.$client.prepare(`EXPLAIN QUERY PLAN
      SELECT id, title, created_at, source FROM post_revisions
      WHERE post_id = ? ORDER BY created_at DESC, id DESC LIMIT 20`).all(draft.id)
    const plan = z.array(z.object({ detail: z.string() })).parse(rows)
    expect(plan.some(row => row.detail.includes('USE TEMP B-TREE'))).toBe(false)
  })

  it('分页只读取摘要，选中的完整修订独立于当前页，同时返回一致的草稿与公开引用', () => {
    let draft = createTestDraft(writer, content)
    const original = draft
    const published = publish(draft)
    for (let index = 0; index < 24; index += 1) draft = save(draft, { ...content, body: `# Revision ${index}` })

    const first = store.getRevisionHistory(draft.id, { page: 1, revisionId: original.revisionId })
    assert.ok(first)
    expect(first.draft).toEqual(draft)
    expect(first.published).toEqual(published)
    expect(first.selectedRevision).toMatchObject({ id: original.revisionId, body: content.body })
    expect(first.revisions).toHaveLength(20)
    expect(first.revisionCount).toBe(25)
    expect(first.pageCount).toBe(2)
    expect(first.revisions.every(revision => !('body' in revision) && !('description' in revision))).toBe(true)
    const second = store.getRevisionHistory(draft.id, { page: 2 })
    assert.ok(second)
    expect(second.revisions).toHaveLength(5)
    expect(second.selectedRevision.id).toBe(draft.revisionId)
    expect(new Set([...first.revisions, ...second.revisions].map(revision => revision.id)).size).toBe(25)
    expect(store.getRevisionHistory(draft.id, { page: 3 })).toBeNull()
  })

  it('不返回不存在文章、跨文章选中修订或无效分页的历史', () => {
    const draft = createTestDraft(writer, content)
    const another = createTestDraft(writer, { ...content, title: 'Another' })
    expect(store.getRevisionHistory('missing')).toBeNull()
    expect(store.getRevisionHistory(draft.id, { page: 1, revisionId: another.revisionId })).toBeNull()
    expect(store.getRevisionHistory(draft.id, { page: 0 })).toBeNull()
    expect(store.getRevisionHistory(draft.id, { page: 1.5 })).toBeNull()
  })
})

describe('初始发布素材导入', () => {
  it('保留原文，重复导入不覆盖现有草稿或公开内容，也不发布已有未发布稿', () => {
    const existing = createTestDraft(writer, content)
    const published = publish(existing)
    const edited = save(existing, { ...content, title: 'Edited' })
    const unpublished = createTestDraft(writer, content)
    const input = { id: '9ea8d4be-4b45-46d2-954c-3e1da354d33f', ...content }
    expect(importPublishedPosts(database, [input, { ...content, id: existing.id }, { ...content, id: unpublished.id }]))
      .toEqual({ imported: 1, skipped: 2 })
    expect(store.getDraft(existing.id)).toEqual(edited)
    expect(store.getPublishedPost(existing.id)).toEqual(published)
    expect(store.getPublishedPost(unpublished.id)).toBeNull()
    expect(store.getPublishedPost(input.id)).toMatchObject(input)
    expect(store.getDraft(input.id)).toMatchObject(input)
  })

  it('整批导入中途失败时回滚前面的身份、修订和发布引用', () => {
    const inputs = [
      { id: 'first', ...content },
      { id: 'second', ...content, title: ' \t ' },
    ]
    expect(() => importPublishedPosts(database, inputs)).toThrow()
    expect(snapshot()).toEqual({ posts: [], revisions: [], drafts: [], publications: [], published: [] })
    expect(importPublishedPosts(database, [{ id: 'first', ...content }])).toEqual({ imported: 1, skipped: 0 })
  })
})

// @vitest-environment node
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeDatabase, openDatabase, type AppDatabase } from './database'
import { createPostStore, importPublishedPosts } from './posts'
import { postContents } from './schema'

let directory: string
let filename: string
let database: AppDatabase
let store: ReturnType<typeof createPostStore>

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'nim-posts-'))
  filename = join(directory, 'nim.sqlite')
  await initializeDatabase(filename)
  database = openDatabase(filename)
  store = createPostStore(database)
})

afterEach(() => {
  if (database?.$client.open) database.$client.close()
  if (directory) rmSync(directory, { recursive: true })
})

describe('文章管理列表', () => {
  it('列出草稿摘要，并依据完整发布快照区分状态，恢复相同内容后不再标记修改', () => {
    const content = {
      title: 'First post',
      description: 'Post description.',
      body: '# First body',
    }
    expect(store.listPosts()).toEqual([])
    const draft = store.createDraft(content)
    const summary = {
      id: draft.id,
      title: content.title,
      description: content.description,
      updatedAt: draft.updatedAt,
    }
    expect(store.listPosts()).toEqual([{ ...summary, status: 'draft' }])

    const published = store.publishDraft(draft.id)
    expect(store.listPosts()).toEqual([{ ...summary, status: 'published' }])

    const edited = store.saveDraft(draft.id, { ...content, body: '# Revised body' })
    assert.ok(edited)
    expect(store.listPosts()).toEqual([
      { ...summary, updatedAt: edited.updatedAt, status: 'modified' },
    ])
    expect(store.getPublishedPost(draft.id)).toEqual(published)

    const restored = store.saveDraft(draft.id, content)
    assert.ok(restored)
    expect(store.listPosts()).toEqual([
      { ...summary, updatedAt: restored.updatedAt, status: 'published' },
    ])
  })
})

describe('已发布文章导入', () => {
  it('按素材 ID 持久导入标题、摘要和 Markdown 原文', () => {
    const input = {
      id: '9ea8d4be-4b45-46d2-954c-3e1da354d33f',
      title: 'Existing post',
      description: 'Existing description.',
      body: '# Existing post\n\n**Markdown** content.\n',
    }

    expect(importPublishedPosts(database, [input])).toEqual({ imported: 1, skipped: 0 })
    database.$client.close()
    database = openDatabase(filename)
    store = createPostStore(database)

    const published = store.getPublishedPost(input.id)
    expect(published).toMatchObject(input)
    expect(store.getDraft(input.id)).toMatchObject(input)
    expect(store.listPublishedPosts()).toEqual([
      {
        id: input.id,
        title: input.title,
        description: input.description,
        publishedAt: published!.publishedAt,
      },
    ])
  })

  it('重复导入不覆盖已编辑的草稿和发布版本，也不发布已有的未发布草稿', () => {
    const content = {
      title: 'Original title',
      description: 'Original description.',
      body: '# Original body',
    }
    const draft = store.createDraft(content)
    const published = store.publishDraft(draft.id)
    const edited = store.saveDraft(draft.id, {
      title: 'Edited title',
      description: 'Edited description.',
      body: '# Edited body',
    })
    const unpublished = store.createDraft(content)

    expect(importPublishedPosts(database, [
      { ...content, id: draft.id, title: 'Outdated source title' },
      { ...content, id: unpublished.id },
    ])).toEqual({ imported: 0, skipped: 2 })

    expect(store.getDraft(draft.id)).toEqual(edited)
    expect(store.getPublishedPost(draft.id)).toEqual(published)
    expect(store.getDraft(unpublished.id)).toEqual(unpublished)
    expect(store.getPublishedPost(unpublished.id)).toBeNull()
    expect(store.listPublishedPosts()).toHaveLength(1)
  })
})

describe('文章持久化与发布边界', () => {
  it('不存在的文章读写均返回缺失结果，不创建文章或快照', () => {
    const content = { title: 'Missing', description: '', body: '# Missing' }
    expect(store.getDraft('missing')).toBeNull()
    expect(store.getPublishedPost('missing')).toBeNull()
    expect(store.saveDraft('missing', content)).toBeNull()
    expect(store.publishDraft('missing')).toBeNull()
    expect(store.listPosts()).toEqual([])
    expect(store.listPublishedPosts()).toEqual([])
    expect(database.$client.prepare('SELECT * FROM posts').all()).toEqual([])
    expect(database.$client.prepare('SELECT * FROM post_contents').all()).toEqual([])
  })

  it('用已有文章内容新建和保存时，各自身份和草稿阶段保持独立', () => {
    const original = store.createDraft({ title: 'Original', description: '', body: '# Original' })
    store.publishDraft(original.id)
    const published = database.select().from(postContents).where(eq(postContents.stage, 'published')).get()!
    const content = { ...original, ...published }

    const copied = store.createDraft(content)
    expect(copied.id).not.toBe(original.id)
    expect(store.getDraft(copied.id)).toEqual(copied)
    expect(store.getPublishedPost(copied.id)).toBeNull()

    const saved = store.saveDraft(copied.id, content)
    assert.ok(saved)
    expect(saved.id).toBe(copied.id)
    expect(store.getDraft(copied.id)).toEqual(saved)
    expect(store.getPublishedPost(copied.id)).toBeNull()
  })

  it('创建内容失败时不留下只有身份的文章，排除故障后可以重试', () => {
    database.$client.exec(`
      CREATE TRIGGER reject_content BEFORE INSERT ON post_contents
      BEGIN SELECT RAISE(ABORT, 'content unavailable'); END;
    `)
    const content = { title: 'Draft', description: '', body: '# Draft' }

    expect(() => store.createDraft(content)).toThrow()
    expect(database.$client.prepare('SELECT * FROM posts').all()).toEqual([])
    expect(database.$client.prepare('SELECT * FROM post_contents').all()).toEqual([])

    database.$client.exec('DROP TRIGGER reject_content')
    const draft = store.createDraft(content)
    expect(store.getDraft(draft.id)).toMatchObject(content)
  })

  it('整批导入中途失败时回滚前面的文章和发布快照', () => {
    database.$client.exec(`
      CREATE TRIGGER reject_second BEFORE INSERT ON post_contents
      WHEN NEW.title = 'Rejected'
      BEGIN SELECT RAISE(ABORT, 'content unavailable'); END;
    `)
    const inputs = [
      { id: 'first', title: 'First', description: '', body: '# First' },
      { id: 'second', title: 'Rejected', description: '', body: '# Second' },
    ]

    expect(() => importPublishedPosts(database, inputs)).toThrow()
    expect(database.$client.prepare('SELECT * FROM posts').all()).toEqual([])
    expect(store.listPosts()).toEqual([])
    expect(store.listPublishedPosts()).toEqual([])

    database.$client.exec('DROP TRIGGER reject_second')
    expect(importPublishedPosts(database, inputs)).toEqual({ imported: 2, skipped: 0 })
    expect(store.listPublishedPosts()).toHaveLength(2)
  })

  it('只提供内容即可生成独立 ID，重开数据库及重复初始化后草稿仍在', async () => {
    const input = {
      title: 'First post',
      description: 'A saved draft.',
      body: '# Draft\n\nMarkdown content.',
    }
    const draft = store.createDraft(input)
    const another = store.createDraft(input)
    expect(another.id).not.toBe(draft.id)

    database.$client.close()
    await initializeDatabase(filename)
    database = openDatabase(filename)
    store = createPostStore(database)

    expect(store.getDraft(draft.id)).toEqual(draft)
    expect(store.getPublishedPost(draft.id)).toBeNull()
    expect(store.listPublishedPosts()).toEqual([])
  })

  it('保存草稿不改变发布快照，再次发布才整体替换公开内容，文章 ID 始终不变', () => {
    const first = {
      title: 'Published title',
      description: 'Published description.',
      body: '# Published body',
    }
    const second = {
      title: 'Edited title',
      description: 'Edited description.',
      body: '# Edited body',
    }
    const draft = store.createDraft(first)
    const published = store.publishDraft(draft.id)
    assert.ok(published)
    store.saveDraft(draft.id, second)

    expect(store.getDraft(draft.id)).toMatchObject(second)
    expect(store.getPublishedPost(draft.id)).toEqual(published)
    expect(store.listPublishedPosts()).toEqual([
      {
        id: draft.id,
        title: first.title,
        description: first.description,
        publishedAt: published.publishedAt,
      },
    ])

    const republished = store.publishDraft(draft.id)
    expect(republished).toMatchObject({ id: draft.id, ...second })
    expect(store.getPublishedPost(draft.id)).toEqual(republished)
    expect(store.listPublishedPosts()).toHaveLength(1)
    expect(store.listPublishedPosts()[0]).toMatchObject({
      title: second.title,
      description: second.description,
    })
  })
})

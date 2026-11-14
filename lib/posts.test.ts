// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeDatabase, openDatabase } from './database'
import { createPostStore, importPublishedPosts } from './posts'

let directory: string
let filename: string
let database: Database
let store: ReturnType<typeof createPostStore>

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'nim-posts-'))
  filename = join(directory, 'nim.sqlite')
  await initializeDatabase(filename)
  database = openDatabase(filename)
  store = createPostStore(database)
})

afterEach(() => {
  if (database?.open) database.close()
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
    expect(store.listPosts()).toEqual([
      { ...summary, updatedAt: edited.updatedAt, status: 'modified' },
    ])
    expect(store.getPublishedPost(draft.id)).toEqual(published)

    const restored = store.saveDraft(draft.id, content)
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
    database.close()
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
  it('只提供内容即可生成独立 ID，重开数据库及重复初始化后草稿仍在', async () => {
    const input = {
      title: 'First post',
      description: 'A saved draft.',
      body: '# Draft\n\nMarkdown content.',
    }
    const draft = store.createDraft(input)
    const another = store.createDraft(input)
    expect(another.id).not.toBe(draft.id)

    database.close()
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

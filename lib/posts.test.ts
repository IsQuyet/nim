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

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'nim-posts-'))
  filename = join(directory, 'nim.sqlite')
  initializeDatabase(filename)
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
    const draft = store.createDraft({ slug: 'first-post', ...content })
    const summary = {
      id: draft.id,
      slug: draft.slug,
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
    expect(store.getPublishedPost(draft.slug)).toEqual(published)

    const restored = store.saveDraft(draft.id, content)
    expect(store.listPosts()).toEqual([
      { ...summary, updatedAt: restored.updatedAt, status: 'published' },
    ])
  })
})

describe('已发布文章导入', () => {
  it('将标题、摘要和 Markdown 原文一起持久导入，保留原来的 slug', () => {
    const input = {
      slug: 'existing-post',
      title: 'Existing post',
      description: 'Existing description.',
      body: '# Existing post\n\n**Markdown** content.\n',
    }

    expect(importPublishedPosts(database, [input])).toEqual({ imported: 1, skipped: 0 })
    database.close()
    database = openDatabase(filename)
    store = createPostStore(database)

    const published = store.getPublishedPost(input.slug)
    expect(published).toMatchObject(input)
    expect(store.getDraft(published!.id)).toMatchObject(input)
    expect(store.listPublishedPosts()).toEqual([
      {
        id: published!.id,
        slug: input.slug,
        title: input.title,
        description: input.description,
        publishedAt: published!.publishedAt,
      },
    ])
  })

  it('重复导入不覆盖已编辑的草稿和发布版本，也不发布已有的未发布草稿', () => {
    const original = {
      slug: 'existing-post',
      title: 'Original title',
      description: 'Original description.',
      body: '# Original body',
    }
    const draft = store.createDraft(original)
    const published = store.publishDraft(draft.id)
    const edited = store.saveDraft(draft.id, {
      title: 'Edited title',
      description: 'Edited description.',
      body: '# Edited body',
    })
    const unpublished = store.createDraft({ ...original, slug: 'unpublished-post' })

    expect(importPublishedPosts(database, [
      { ...original, title: 'Outdated source title' },
      { ...original, slug: unpublished.slug },
    ])).toEqual({ imported: 0, skipped: 2 })

    expect(store.getDraft(draft.id)).toEqual(edited)
    expect(store.getPublishedPost(draft.slug)).toEqual(published)
    expect(store.getDraft(unpublished.id)).toEqual(unpublished)
    expect(store.getPublishedPost(unpublished.slug)).toBeNull()
    expect(store.listPublishedPosts()).toHaveLength(1)
  })
})

describe('文章持久化与发布边界', () => {
  it('重开数据库及重复初始化后草稿仍在，未发布内容不出现在公开读取中', () => {
    const input = {
      slug: 'first-post',
      title: 'First post',
      description: 'A saved draft.',
      body: '# Draft\n\nMarkdown content.',
    }
    const draft = store.createDraft(input)

    database.close()
    initializeDatabase(filename)
    database = openDatabase(filename)
    store = createPostStore(database)

    expect(store.getDraft(draft.id)).toEqual(draft)
    expect(store.getPublishedPost(input.slug)).toBeNull()
    expect(store.listPublishedPosts()).toEqual([])
  })

  it('保存草稿不改变发布快照，再次发布才整体替换公开内容', () => {
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
    const draft = store.createDraft({ slug: 'first-post', ...first })
    const published = store.publishDraft(draft.id)
    store.saveDraft(draft.id, second)

    expect(store.getDraft(draft.id)).toMatchObject(second)
    expect(store.getPublishedPost(draft.slug)).toEqual(published)
    expect(store.listPublishedPosts()).toEqual([
      {
        id: draft.id,
        slug: draft.slug,
        title: first.title,
        description: first.description,
        publishedAt: published.publishedAt,
      },
    ])

    const republished = store.publishDraft(draft.id)
    expect(republished).toMatchObject(second)
    expect(store.getPublishedPost(draft.slug)).toEqual(republished)
    expect(store.listPublishedPosts()).toHaveLength(1)
    expect(store.listPublishedPosts()[0]).toMatchObject({
      title: second.title,
      description: second.description,
    })
  })
})

// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeDatabase, openDatabase } from './database'
import { createPostStore } from './posts'

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

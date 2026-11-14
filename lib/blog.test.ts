// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Database } from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase, openDatabase } from './database'
import { createPostStore } from './posts'
import { getBlogPost, getBlogPosts } from './blog'

vi.mock('server-only', () => ({}))
vi.mock('next/server', () => ({ connection: async () => {} }))

let directory: string
let database: Database
let store: ReturnType<typeof createPostStore>

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'nim-blog-'))
  const filename = join(directory, 'nim.sqlite')
  vi.stubEnv('DATABASE_PATH', filename)
  await initializeDatabase(filename)
  database = openDatabase(filename)
  store = createPostStore(database)
})

afterEach(() => {
  if (database?.open) database.close()
  vi.unstubAllEnvs()
  if (directory) rmSync(directory, { recursive: true })
})

describe('公开文章数据来源', () => {
  it('空库返回空列表和不存在，不回退到仓库里的文章', async () => {
    expect(await getBlogPosts()).toEqual([])
    expect(await getBlogPost('264efa5a-5f48-4f4d-bbc3-56021a5f6342')).toBeNull()
  })

  it('只读取数据库中的发布快照，支持新文章，保存草稿不改变公开结果', async () => {
    const first = {
      title: 'Published title',
      description: 'Published description.',
      body: '# Published body',
    }
    const second = {
      title: 'Revised title',
      description: 'Revised description.',
      body: '# Revised body',
    }
    const draft = store.createDraft(first)

    expect(await getBlogPosts()).toEqual([])
    expect(await getBlogPost(draft.id)).toBeNull()

    const published = store.publishDraft(draft.id)
    store.saveDraft(draft.id, second)

    expect(await getBlogPost(draft.id)).toEqual(published)
    expect(await getBlogPosts()).toEqual([
      {
        id: draft.id,
        title: first.title,
        description: first.description,
        publishedAt: published.publishedAt,
      },
    ])

    const republished = store.publishDraft(draft.id)
    expect(await getBlogPost(draft.id)).toEqual(republished)
    expect(await getBlogPosts()).toEqual([
      {
        id: draft.id,
        title: second.title,
        description: second.description,
        publishedAt: republished.publishedAt,
      },
    ])
  })
})

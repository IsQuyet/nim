// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeDatabase, openDatabase, type AppDatabase } from './database'
import { createWritingStore } from './writing-store'
import { createTestDraft, publishTestDraft, saveTestDraft } from '../test/post-commands'
import { getBlogPost, getBlogPosts } from './blog'

vi.mock('server-only', () => ({}))
vi.mock('next/server', () => ({ connection: async () => {} }))

let directory: string
let database: AppDatabase
let writer: ReturnType<typeof createWritingStore>

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'nim-blog-'))
  const filename = join(directory, 'nim.sqlite')
  vi.stubEnv('DATABASE_PATH', filename)
  await initializeDatabase(filename)
  database = openDatabase(filename)
  writer = createWritingStore(database)
})

afterEach(() => {
  if (database?.$client.open) database.$client.close()
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
    const draft = createTestDraft(writer, first)

    expect(await getBlogPosts()).toEqual([])
    expect(await getBlogPost(draft.id)).toBeNull()

    const published = publishTestDraft(writer, draft)
    const saved = saveTestDraft(writer, draft, second)

    expect(await getBlogPost(draft.id)).toEqual(published)
    expect(await getBlogPosts()).toEqual([
      {
        id: draft.id,
        title: first.title,
        description: first.description,
        publishedAt: published.publishedAt,
      },
    ])

    const republished = publishTestDraft(writer, saved, second)
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

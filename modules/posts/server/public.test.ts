// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabaseConnections, initializeDatabase, openDatabase, type ManagedDatabase } from '@/lib/server/database'
import { createWritingStore } from './writing-store'
import { createTestDraft, publishTestDraft, saveTestDraft } from '@/test/post-commands'
import { getBlogPost, getBlogPosts } from './public'

vi.mock('server-only', () => ({}))
vi.mock('next/server', () => ({ connection: async () => {} }))

let directory: string
let database: ManagedDatabase
let writer: ReturnType<typeof createWritingStore>

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'nim-blog-'))
  const target = join(directory, 'pgdata')
  vi.stubEnv('DATABASE_PATH', target)
  await initializeDatabase(target)
  database = await openDatabase(target)
  writer = createWritingStore(database)
})

afterEach(async () => {
  await database?.close()
  await closeDatabaseConnections()
  vi.unstubAllEnvs()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

describe('公开文章数据来源', () => {
  it('空库返回空列表和不存在，不回退到仓库里的文章', async () => {
    await database.close()
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
    const draft = await createTestDraft(writer, first)
    await database.close()

    expect(await getBlogPosts()).toEqual([])
    expect(await getBlogPost(draft.id)).toBeNull()

    await closeDatabaseConnections()
    database = await openDatabase()
    writer = createWritingStore(database)
    const published = await publishTestDraft(writer, draft)
    const saved = await saveTestDraft(writer, draft, second)
    await database.close()

    expect(await getBlogPost(draft.id)).toEqual(published)
    expect(await getBlogPosts()).toEqual([
      {
        id: draft.id,
        title: first.title,
        description: first.description,
        publishedAt: published.publishedAt,
      },
    ])

    await closeDatabaseConnections()
    database = await openDatabase()
    writer = createWritingStore(database)
    const republished = await publishTestDraft(writer, saved, second)
    await database.close()

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

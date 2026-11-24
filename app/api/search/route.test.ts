// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabaseConnections, initializeDatabase, openDatabase, type ManagedDatabase } from '@/lib/server/database'
import { createGalleryStore } from '@/modules/gallery/server/store'
import { createFileMediaStorage } from '@/modules/media/server/storage'
import { createMediaStore } from '@/modules/media/server/store'
import { prepareMediaUpload } from '@/modules/media/server/upload'
import { createWritingStore } from '@/modules/posts/server/writing-store'
import { createTestImage } from '@/test/media-fixtures'
import { createTestDraft, publishTestDraft, saveTestDraft } from '@/test/post-commands'
import { GET } from './route'

vi.mock('next/server', () => ({ connection: vi.fn(async () => {}) }))

let directory: string
let filename: string
let database: ManagedDatabase

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'nim-search-api-'))
  filename = join(directory, 'pgdata')
  vi.stubEnv('DATABASE_PATH', filename)
  await initializeDatabase(filename)
  database = await openDatabase(filename)
})

afterEach(async () => {
  await database?.close()
  await closeDatabaseConnections()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

async function uploadPhoto(name: string) {
  const bytes = await createTestImage()
  const prepared = await prepareMediaUpload({
    id: randomUUID(),
    originalName: name,
    declaredType: 'image/png',
    bytes,
  })
  if (prepared.status !== 'success') throw new Error(prepared.message)
  const storage = createFileMediaStorage(join(directory, 'media'))
  const uploaded = await createMediaStore(database, storage).upload(prepared.value)
  if (uploaded.status !== 'success') throw new Error('Upload failed')
  return uploaded.value
}

describe('公开站内检索 Route Handler', () => {
  it('严格只搜已发布文章与已发布画廊，绝不泄漏草稿和未发布编辑', async () => {
    const writer = createWritingStore(database)
    await createTestDraft(writer, {
      title: 'Secret draft',
      description: 'Hidden',
      body: 'SecretKeyword only inside private draft.',
    })
    const live = await createTestDraft(writer, {
      title: 'Public article',
      description: 'Published summary',
      body: 'Contains SearchToken inside published revision.',
    })
    const published = await publishTestDraft(writer, live)
    await saveTestDraft(writer, { ...live, revisionId: published.revisionId }, {
      title: 'Public article',
      description: 'Published summary',
      body: 'Contains DraftOnlyEditToken in uncommitted draft revision.',
    })

    const draftMedia = await uploadPhoto('draft.png')
    const pubMedia = await uploadPhoto('public.png')
    const gallery = createGalleryStore(database)
    await gallery.save({
      mediaId: draftMedia.id,
      title: 'Private frame',
      caption: 'Contains SearchToken',
      location: 'Hidden',
      takenAt: null,
      status: 'draft',
    })
    const pubPhoto = await gallery.save({
      mediaId: pubMedia.id,
      title: 'Public frame',
      caption: 'Includes SearchToken',
      location: 'Kyoto',
      takenAt: null,
      status: 'published',
    })
    expect(pubPhoto.status).toBe('success')

    // 释放 PGlite 目录独占锁后再让 GET 路由的 getSharedDatabase 打开同一本地库。
    await database.close()

    const secretResponse = await GET(new Request('http://localhost:3000/api/search?q=SecretKeyword'))
    expect((await secretResponse.json()).hits).toEqual([])

    const draftEditResponse = await GET(new Request('http://localhost:3000/api/search?q=DraftOnlyEditToken'))
    expect((await draftEditResponse.json()).hits).toEqual([])

    const matchResponse = await GET(new Request('http://localhost:3000/api/search?q=SearchToken'))
    expect(matchResponse.headers.get('cache-control')).toBe('no-store')
    const data = await matchResponse.json()
    expect(data.counts).toEqual({ all: 2, posts: 1, gallery: 1 })
    expect(data.hits.map((hit: { title: string }) => hit.title).sort()).toEqual([
      'Public article',
      'Public frame',
    ])

    // 画廊作品下架后立即退出检索结果（关闭共享连接后再由测试直接更新状态）。
    if (pubPhoto.status === 'success') {
      await closeDatabaseConnections()
      database = await openDatabase(filename)
      await createGalleryStore(database).setStatus(pubPhoto.item.id, 'draft')
      await database.close()
      const afterUnpublish = await GET(new Request('http://localhost:3000/api/search?q=SearchToken'))
      expect((await afterUnpublish.json()).counts).toEqual({ all: 1, posts: 1, gallery: 0 })
    }
  })
})

// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initializeDatabase, openDatabase, type AppDatabase } from '@/lib/server/database'
import { createGalleryStore } from '@/modules/gallery/server/store'
import { createFileMediaStorage } from '@/modules/media/server/storage'
import { createMediaStore } from '@/modules/media/server/store'
import { prepareMediaUpload } from '@/modules/media/server/upload'
import { createWritingStore } from '@/modules/posts/server/writing-store'
import { createTestImage } from '@/test/media-fixtures'
import { createTestDraft, publishTestDraft } from '@/test/post-commands'
import { PROJECTS, WORK_EXPERIENCE } from '../data'
import { createHomeStore } from './home-store'

let directory: string
let database: AppDatabase

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'nim-home-store-'))
  const filename = join(directory, 'nim.sqlite')
  await initializeDatabase(filename)
  database = openDatabase(filename)
})

afterEach(() => {
  database?.$client.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

async function createPublishedPhoto(title: string) {
  const bytes = await createTestImage()
  const prepared = await prepareMediaUpload({
    id: randomUUID(),
    originalName: `${title}.png`,
    declaredType: 'image/png',
    bytes,
  })
  if (prepared.status !== 'success') throw new Error(prepared.message)
  const storage = createFileMediaStorage(join(directory, 'media'))
  const uploaded = await createMediaStore(database, storage).upload(prepared.value)
  if (uploaded.status !== 'success') throw new Error('Expected upload to succeed.')
  const saved = createGalleryStore(database).save({
    mediaId: uploaded.value.id,
    title,
    caption: '',
    location: '',
    takenAt: null,
    status: 'published',
  })
  if (saved.status !== 'success') throw new Error('Expected gallery publish to succeed.')
  return saved.item
}

describe('首页独立策展存储', () => {
  it('未配置时使用默认顺序，无公开画廊时不显示空画廊区块', () => {
    const store = createHomeStore(database)
    const data = store.getPublicHomepage()
    expect(data.writing.section.visible).toBe(true)
    expect(data.writing.section.sourceMode).toBe('latest')
    expect(data.sections.map(entry => entry.section.sectionKey)).toEqual(['projects', 'experience'])
  })

  it('支持区块开关、全宽区块重排、手动精选与静态条目显隐', async () => {
    const writer = createWritingStore(database)
    const postA = publishTestDraft(writer, createTestDraft(writer, { title: 'Post A', description: '', body: 'A' }))
    const postB = publishTestDraft(writer, createTestDraft(writer, { title: 'Post B', description: '', body: 'B' }))

    const photo1 = await createPublishedPhoto('Photo 1')
    const photo2 = await createPublishedPhoto('Photo 2')

    const home = createHomeStore(database)
    home.saveConfig({
      sections: [
        {
          sectionKey: 'writing',
          title: 'Featured writing',
          visible: true,
          sortOrder: 0,
          sourceMode: 'manual',
          maxItems: 4,
          items: [
            { itemKind: 'post', itemId: postA.id, visible: true },
            { itemKind: 'post', itemId: postB.id, visible: false },
          ],
        },
        {
          sectionKey: 'projects',
          title: 'Projects',
          visible: true,
          sortOrder: 1,
          sourceMode: 'manual',
          maxItems: 6,
          items: PROJECTS.map(project => ({ itemKind: 'project', itemId: project.id, visible: true })),
        },
        {
          sectionKey: 'gallery',
          title: 'Selected frames',
          visible: true,
          sortOrder: 2,
          sourceMode: 'manual',
          maxItems: 6,
          items: [
            { itemKind: 'gallery', itemId: photo1.id, visible: true },
            { itemKind: 'gallery', itemId: photo2.id, visible: true },
          ],
        },
        {
          sectionKey: 'experience',
          title: 'Work experience',
          visible: false,
          sortOrder: 3,
          sourceMode: 'manual',
          maxItems: 6,
          items: WORK_EXPERIENCE.map(job => ({ itemKind: 'experience', itemId: job.id, visible: true })),
        },
      ],
    })

    const initialPublic = home.getPublicHomepage()
    expect(initialPublic.writing.section.title).toBe('Featured writing')
    expect(initialPublic.writing.posts.map(post => post.id)).toEqual([postA.id])
    expect(initialPublic.sections.map(entry => entry.section.sectionKey)).toEqual(['projects', 'gallery'])
    const gallerySection = initialPublic.sections.find(entry => entry.section.sectionKey === 'gallery')
    expect(gallerySection?.items.map(item => item.id)).toEqual([photo1.id, photo2.id])

    // 当某个已上首页的画廊条目被转回草稿，首页自动过滤而不泄漏草稿，但后台保留提示状态。
    createGalleryStore(database).setStatus(photo1.id, 'draft')
    const afterUnpublish = home.getPublicHomepage()
    const filteredGallery = afterUnpublish.sections.find(entry => entry.section.sectionKey === 'gallery')
    expect(filteredGallery?.items.map(item => item.id)).toEqual([photo2.id])

    const adminState = home.getAdminHomepage()
    const adminGallerySection = adminState.sections.find(section => section.sectionKey === 'gallery')
    expect(adminGallerySection?.items.find(item => item.itemId === photo1.id)?.available).toBe(false)
  })
})

// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mediaAssets } from './schema'
import { initializeDatabase, openDatabase, type AppDatabase } from '@/lib/server/database'
import { createMediaStore } from './store'
import { createFileMediaStorage } from './storage'
import { prepareMediaUpload } from './upload'
import { createTestImage } from '@/test/media-fixtures'

let directory: string
let database: AppDatabase
let png: Buffer

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'nim-media-store-'))
  const filename = join(directory, 'nim.sqlite')
  await initializeDatabase(filename)
  database = openDatabase(filename)
  png = await createTestImage()
})

afterEach(() => {
  database?.$client.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

async function prepared(id: string = randomUUID(), bytes: Uint8Array = png) {
  const result = await prepareMediaUpload({ id, originalName: 'photo.png', declaredType: 'image/png', bytes })
  if (result.status !== 'success') throw new Error(result.message)
  return result.value
}

function store() {
  return createMediaStore(database, createFileMediaStorage(join(directory, 'media')))
}

describe('媒体上传', () => {
  it('重复上传保持媒体身份、不可变内容与首次时间', async () => {
    const media = store()
    const input = await prepared()
    const first = await media.upload(input)
    expect(first).toMatchObject({ status: 'success', value: { id: input.id, state: 'ready' } })
    expect(await media.upload(input)).toEqual(first)
    expect(media.get(input.id)?.sha256).toBe(input.sha256)
  })

  it('同 ID 不同显示内容冲突，不覆盖原元数据和文件', async () => {
    const media = store()
    const first = await prepared()
    const different = await prepared(first.id, await createTestImage('png', '#123456'))
    await media.upload(first)
    expect(await media.upload(different)).toEqual({ status: 'conflict' })
    expect(media.get(first.id)?.sha256).toBe(first.sha256)
  })

  it('同一图片并发重试最终指向同一份已完成内容', async () => {
    const media = store()
    const input = await prepared()
    const [first, second] = await Promise.all([media.upload(input), media.upload(input)])
    expect(first).toMatchObject({ status: 'success', value: { state: 'ready' } })
    expect(second).toEqual(first)
    expect(database.select().from(mediaAssets).all()).toHaveLength(1)
  })

  it('文件写入失败保留可重试的 pending 身份', async () => {
    const input = await prepared()
    const failed = createMediaStore(database, {
      async put() { throw new Error('Disk unavailable') },
      async read() { return null },
      async remove() {},
    })
    await expect(failed.upload(input)).rejects.toThrow('Disk unavailable')
    expect(failed.get(input.id)?.state).toBe('pending')
    expect(await store().upload(input)).toMatchObject({ status: 'success', value: { state: 'ready' } })
  })

  it('文件已写入而元数据提交失败后，可用同一上传身份核对并完成', async () => {
    const input = await prepared()
    database.$client.exec("CREATE TRIGGER fail_media_ready BEFORE UPDATE ON media_assets BEGIN SELECT RAISE(ABORT, 'Metadata unavailable'); END")
    const media = store()
    await expect(media.upload(input)).rejects.toThrow('Metadata unavailable')
    expect(media.get(input.id)?.state).toBe('pending')
    database.$client.exec('DROP TRIGGER fail_media_ready')
    expect(await media.upload(input)).toMatchObject({ status: 'success', value: { state: 'ready' } })
  })
})

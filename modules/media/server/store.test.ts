// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mediaAssets } from './schema'
import { initializeDatabase, openDatabase, type ManagedDatabase } from '@/lib/server/database'
import { createMediaStore } from './store'
import { createFileMediaStorage } from './storage'
import { prepareMediaUpload } from './upload'
import { createTestImage } from '@/test/media-fixtures'

let directory: string
let database: ManagedDatabase
let png: Buffer

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'nim-media-store-'))
  const target = join(directory, 'pgdata')
  await initializeDatabase(target)
  database = await openDatabase(target)
  png = await createTestImage()
})

afterEach(async () => {
  await database?.close()
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
    expect((await media.get(input.id))?.sha256).toBe(input.sha256)
  })

  it('同 ID 不同显示内容冲突，不覆盖原元数据和文件', async () => {
    const media = store()
    const first = await prepared()
    const different = await prepared(first.id, await createTestImage('png', '#123456'))
    await media.upload(first)
    expect(await media.upload(different)).toEqual({ status: 'conflict' })
    expect((await media.get(first.id))?.sha256).toBe(first.sha256)
  })

  it('同一图片并发重试最终指向同一份已完成内容', async () => {
    const media = store()
    const input = await prepared()
    const [first, second] = await Promise.all([media.upload(input), media.upload(input)])
    expect(first).toMatchObject({ status: 'success', value: { state: 'ready' } })
    expect(second).toEqual(first)
    expect(await database.select().from(mediaAssets)).toHaveLength(1)
  })

  it('文件写入失败保留可重试的 pending 身份', async () => {
    const input = await prepared()
    const failed = createMediaStore(database, {
      async put() { throw new Error('Disk unavailable') },
      async read() { return null },
      async remove() {},
    })
    await expect(failed.upload(input)).rejects.toThrow('Disk unavailable')
    expect((await failed.get(input.id))?.state).toBe('pending')
    expect(await store().upload(input)).toMatchObject({ status: 'success', value: { state: 'ready' } })
  })

  it('文件已写入而元数据提交失败后，可用同一上传身份核对并完成', async () => {
    const input = await prepared()
    await database.execute(sql`
      CREATE OR REPLACE FUNCTION reject_media_ready() RETURNS TRIGGER AS $$
      BEGIN RAISE EXCEPTION 'Metadata unavailable'; END;
      $$ LANGUAGE plpgsql;
    `)
    await database.execute(sql`
      CREATE TRIGGER fail_media_ready BEFORE UPDATE ON media_assets
      FOR EACH ROW EXECUTE FUNCTION reject_media_ready();
    `)
    const media = store()
    await expect(media.upload(input)).rejects.toMatchObject({
      cause: { message: expect.stringContaining('Metadata unavailable') },
    })
    expect((await media.get(input.id))?.state).toBe('pending')
    await database.execute(sql`DROP TRIGGER fail_media_ready ON media_assets`)
    await database.execute(sql`DROP FUNCTION reject_media_ready()`)
    expect(await media.upload(input)).toMatchObject({ status: 'success', value: { state: 'ready' } })
  })
})

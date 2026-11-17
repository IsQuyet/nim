// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFileMediaStorage } from './storage'

const mediaId = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'
const bytes = new Uint8Array(Buffer.from('local media fixture'))
const asset = {
  id: mediaId, mediaType: 'image/png' as const, sha256: createHash('sha256').update(bytes).digest('hex'),
}
let root: string

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'nim-media-storage-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('文件媒体存储适配器', () => {
  it('以稳定媒体身份原子新建文件，并验证摘要和重试幂等', async () => {
    const storage = createFileMediaStorage(root)
    expect(await storage.put(asset, bytes)).toBe('created')
    expect(readFileSync(join(root, `${mediaId}.png`))).toEqual(Buffer.from(bytes))
    expect(Buffer.from((await storage.read(asset)) ?? [])).toEqual(Buffer.from(bytes))
    expect(await storage.put(asset, bytes)).toBe('existing')
    expect(readdirSync(root)).toEqual([`${mediaId}.png`])
  })

  it('同 ID 不同内容不覆盖已有媒体，摘要损坏时拒绝读取', async () => {
    const storage = createFileMediaStorage(root)
    await storage.put(asset, bytes)
    const different = new Uint8Array(Buffer.from('other bytes'))
    expect(await storage.put({ ...asset, sha256: createHash('sha256').update(different).digest('hex') }, different))
      .toBe('conflict')
    await expect(storage.read({ ...asset, sha256: '0'.repeat(64) })).rejects.toThrow('integrity check')
  })

  it('摘要不一致时不落盘', async () => {
    const storage = createFileMediaStorage(root)
    await expect(storage.put({ ...asset, sha256: '0'.repeat(64) }, bytes)).rejects.toThrow('hash')
    expect(readdirSync(root)).toEqual([])
  })
})

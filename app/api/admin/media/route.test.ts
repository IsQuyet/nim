// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { closeDatabaseConnections, initializeDatabase, openDatabase } from '@/lib/server/database'
import { mediaAssets } from '@/modules/media/server/schema'
import { getAdminSession } from '@/modules/auth/server/auth'
import { mediaUploadResponseSchema } from '@/modules/media/model'
import { createTestAdminSession } from '@/test/admin-session'
import { createTestImage } from '@/test/media-fixtures'
import { POST } from './route'

vi.mock('@/modules/auth/server/auth', () => ({ getAdminSession: vi.fn() }))
vi.mock('@/lib/server/data-paths', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/server/data-paths')>()
  return { ...actual, getMediaDirectory: () => join(directory, 'media') }
})

let directory: string
let filename: string
let bytes: Uint8Array<ArrayBuffer>
const origin = 'http://localhost:3000'
const id = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'nim-media-route-'))
  filename = join(directory, 'pgdata')
  vi.stubEnv('DATABASE_PATH', filename)
  vi.stubEnv('SITE_URL', origin)
  vi.mocked(getAdminSession).mockReset().mockResolvedValue(createTestAdminSession())
  bytes = new Uint8Array(await createTestImage())
  await initializeDatabase(filename)
})

afterEach(async () => {
  await closeDatabaseConnections()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  rmSync(directory, { recursive: true, force: true })
})

async function request(form: FormData, headers: Record<string, string> = {}) {
  const initial = new Request(`${origin}/api/admin/media`, { method: 'POST', headers: { origin }, body: form })
  const body = await initial.arrayBuffer()
  const combined = new Headers(initial.headers)
  combined.set('content-length', String(body.byteLength))
  for (const [key, value] of Object.entries(headers)) combined.set(key, value)
  return new Request(initial.url, { method: 'POST', headers: combined, body })
}

function form(idValue: string, content = bytes, name = 'tiny.png', type = 'image/png') {
  const body = new FormData()
  body.set('id', idValue)
  body.set('file', new File([content], name, { type }))
  return body
}

describe('管理员图片上传 Route Handler', () => {
  it('必须鉴权并拒绝跨站或无有界 Content-Length 请求', async () => {
    vi.mocked(getAdminSession).mockResolvedValueOnce(null)
    expect((await POST(await request(form(id)))).status).toBe(401)
    expect((await POST(await request(form(id), { origin: 'https://attacker.example' }))).status).toBe(403)
    expect((await POST(await request(form(id), { origin: '://invalid' }))).status).toBe(403)
    expect((await POST(new Request(`${origin}/api/admin/media`, { method: 'POST', headers: { origin }, body: form(id) }))).status).toBe(411)
    expect((await POST(await request(form(id), { 'content-length': String(11 * 1024 * 1024) }))).status).toBe(413)
  })

  it('完整解码后保存 WebP，重复同 ID 上传返回同一响应', async () => {
    const response = await POST(await request(form(id)))
    expect(response.status).toBe(200)
    const value = mediaUploadResponseSchema.parse(await response.json())
    expect(value).toMatchObject({ status: 'success', media: { id, mediaType: 'image/webp', width: 2, height: 3, url: `/media/${id}` } })
    const retry = await POST(await request(form(id)))
    expect(await retry.json()).toEqual(value)
    const database = await openDatabase(filename)
    try {
      const [stored] = await database.select().from(mediaAssets).limit(1)
      expect(stored).toMatchObject({ id, state: 'ready', mediaType: 'image/webp' })
      expect((await sharp(readFileSync(join(directory, 'media', `${id}.webp`))).metadata()).format).toBe('webp')
    } finally { await database.close() }
  })

  it('拒绝伪造 MIME、截断图片及重复字段，不创建媒体元数据', async () => {
    expect((await POST(await request(form(id, bytes, 'tiny.svg', 'image/svg+xml')))).status).toBe(400)
    expect((await POST(await request(form(id, bytes.subarray(0, 32))))).status).toBe(400)
    const duplicate = form(randomUUID())
    duplicate.append('id', randomUUID())
    expect((await POST(await request(duplicate))).status).toBe(400)
    const database = await openDatabase(filename)
    try { expect(await database.select().from(mediaAssets)).toEqual([]) } finally { await database.close() }
  })

  it('拒绝同上传身份绑定不同的有效图片', async () => {
    expect((await POST(await request(form(id)))).status).toBe(200)
    const different = new Uint8Array(await createTestImage('png', '#123456'))
    expect((await POST(await request(form(id, different)))).status).toBe(409)
  })

  it('错误的 multipart 和与声明不符的实际长度返回 400', async () => {
    const invalid = new Request(`${origin}/api/admin/media`, {
      method: 'POST', headers: { origin, 'content-length': '3', 'content-type': 'multipart/form-data; boundary=missing' }, body: 'bad',
    })
    expect((await POST(invalid)).status).toBe(400)
    expect((await POST(await request(form(id), { 'content-length': '1' }))).status).toBe(400)
  })

  it('声明长度不能绕过对实际读取字节数的上限', async () => {
    const body = new Uint8Array(11 * 1024 * 1024)
    const oversized = new Request(`${origin}/api/admin/media`, {
      method: 'POST', headers: { origin, 'content-length': '1', 'content-type': 'multipart/form-data; boundary=test' }, body,
    })
    expect((await POST(oversized)).status).toBe(413)
  })
})

// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { getAdminSession } from '@/lib/auth'
import { initializeDatabase, openDatabase } from '@/lib/server/database'
import { createTestDraft, publishTestDraft, saveTestDraft } from '@/test/post-commands'
import { createTestAdminSession } from '@/test/admin-session'
import { createTestImage } from '@/test/media-fixtures'
import { prepareMediaUpload } from '@/lib/media-upload'
import { createMediaStore } from '@/lib/media-store'
import { createFileMediaStorage } from '@/lib/media-storage'
import { createWritingStore } from '@/lib/writing-store'
import { GET } from './route'

vi.mock('next/server', () => ({ connection: vi.fn(async () => {}) }))
vi.mock('@/lib/auth', () => ({ getAdminSession: vi.fn() }))

const origin = 'http://localhost:3000'
let bytes: Uint8Array
let directory: string
let filename: string

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'nim-media-read-'))
  filename = join(directory, 'nim.sqlite')
  vi.stubEnv('DATABASE_PATH', filename)
  vi.mocked(getAdminSession).mockReset().mockResolvedValue(createTestAdminSession())
  bytes = await createTestImage()
  await initializeDatabase(filename)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  rmSync(directory, { recursive: true, force: true })
})

async function upload(id: string) {
  const database = openDatabase(filename)
  try {
    const input = await prepareMediaUpload({ id, originalName: 'tiny.png', declaredType: 'image/png', bytes })
    if (input.status !== 'success') throw new Error('Fixture must be a valid PNG.')
    await createMediaStore(database, createFileMediaStorage(join(directory, 'media'))).upload(input.value)
    const draft = createTestDraft(createWritingStore(database), {
      title: 'Media post', description: '', body: `![tiny](/media/${id})`,
    })
    return { draft, media: input.value }
  } finally { database.$client.close() }
}

function mediaRequest(id: string, etag?: string) {
  return new Request(`${origin}/media/${id}`, { headers: etag ? { 'if-none-match': etag } : undefined })
}

describe('媒体公开读取 Route Handler', () => {
  it('发布前匿名不可读，管理员可读取处理后的图片', async () => {
    const id = randomUUID()
    const { media } = await upload(id)
    vi.mocked(getAdminSession).mockResolvedValueOnce(null)
    const anonymous = await GET(mediaRequest(id), { params: Promise.resolve({ id }) })
    expect(anonymous.status).toBe(404)
    expect((await anonymous.arrayBuffer()).byteLength).toBe(0)
    const admin = await GET(mediaRequest(id), { params: Promise.resolve({ id }) })
    expect(admin.status).toBe(200)
    expect(admin.headers.get('cache-control')).toBe('private, no-store')
    expect(Buffer.from(await admin.arrayBuffer())).toEqual(Buffer.from(media.bytes))
  })

  it('发布后可匿名读取无源元数据的 WebP，ETag 对应实际存储字节', async () => {
    const id = randomUUID()
    const { draft, media } = await upload(id)
    const database = openDatabase(filename)
    try { publishTestDraft(createWritingStore(database), draft) } finally { database.$client.close() }
    vi.mocked(getAdminSession).mockResolvedValue(null)
    const response = await GET(mediaRequest(id), { params: Promise.resolve({ id }) })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/webp')
    expect(response.headers.get('content-disposition')).toBe('inline')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    const output = Buffer.from(await response.arrayBuffer())
    expect(output).toEqual(Buffer.from(media.bytes))
    expect(response.headers.get('etag')).toBe(`"${createHash('sha256').update(output).digest('hex')}"`)
    expect(await sharp(output).ensureAlpha().raw().toBuffer()).toEqual(await sharp(bytes).ensureAlpha().raw().toBuffer())
    const cached = await GET(mediaRequest(id, response.headers.get('etag') ?? undefined), { params: Promise.resolve({ id }) })
    expect(cached.status).toBe(304)
    expect(await cached.text()).toBe('')
  })

  it('新发布版移除图片不会撤回已经公开的历史媒体', async () => {
    const id = randomUUID()
    const { draft } = await upload(id)
    const database = openDatabase(filename)
    try {
      const writer = createWritingStore(database)
      publishTestDraft(writer, draft)
      const next = saveTestDraft(writer, draft, { title: draft.title, description: '', body: 'No image' })
      publishTestDraft(writer, next)
    } finally { database.$client.close() }
    vi.mocked(getAdminSession).mockResolvedValue(null)
    expect((await GET(mediaRequest(id), { params: Promise.resolve({ id }) })).status).toBe(200)
  })

  it('缺失、不完整或无效媒体保持一致的 404', async () => {
    const id = randomUUID()
    const database = openDatabase(filename)
    const incomplete = await prepareMediaUpload({ id, originalName: 'tiny.png', declaredType: 'image/png', bytes })
    if (incomplete.status !== 'success') throw new Error('Fixture must be a valid PNG.')
    try {
      await createMediaStore(database, { async put() { return 'created' }, async read() { return null } }).upload(incomplete.value)
    } finally { database.$client.close() }
    const missing = await GET(mediaRequest(randomUUID()), { params: Promise.resolve({ id: randomUUID() }) })
    const invalid = await GET(mediaRequest('not-a-uuid'), { params: Promise.resolve({ id: 'not-a-uuid' }) })
    const absentFile = await GET(mediaRequest(id), { params: Promise.resolve({ id }) })
    expect(missing.status).toBe(404)
    expect(invalid.status).toBe(404)
    expect(absentFile.status).toBe(404)
  })
})

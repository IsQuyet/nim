// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { serializeMarkdownFile } from '@/lib/markdown-file'
import { GET } from './route'

const mocks = vi.hoisted(() => ({
  withAdminPostStore: vi.fn(), getDraft: vi.fn(), getPublishedPost: vi.fn(),
}))
vi.mock('@/lib/admin-posts', () => ({ withAdminPostStore: mocks.withAdminPostStore }))

const id = '264efa5a-5f48-4f4d-bbc3-56021a5f6342'
const draft = {
  id, revisionId: 3, title: '已保存草稿', description: 'Private summary', body: '\n    原始正文\r\n\r\nLast line  \n',
  createdAt: '2026-11-15T00:00:00Z', updatedAt: '2026-11-15T01:00:00Z',
  accessToken: 'not-to-be-exported',
}
const published = {
  id, revisionId: 2, publicationId: 1, title: '公开版本', description: 'Published summary', body: '# Published body\n',
  createdAt: draft.createdAt, publishedAt: draft.createdAt,
}

function request(query = '') {
  return new Request(`https://example.test/admin/posts/${id}/export${query}`)
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.withAdminPostStore.mockImplementation(async operation => ({
    authorized: true, value: await operation({ getDraft: mocks.getDraft, getPublishedPost: mocks.getPublishedPost }),
  }))
  mocks.getDraft.mockReturnValue(draft)
  mocks.getPublishedPost.mockReturnValue(published)
})

describe('已保存 Markdown 下载入口', () => {
  it('独立鉴权，未登录即401，不读取参数或暴露stage验证结果', async () => {
    mocks.withAdminPostStore.mockResolvedValue({ authorized: false })
    const readId = vi.fn(() => id)
    const params = Promise.resolve({ get id() { return readId() } })
    const response = await GET(request('?stage=invalid'), { params })
    expect(response.status).toBe(401)
    expect(readId).not.toHaveBeenCalled()
    expect(mocks.getDraft).not.toHaveBeenCalled()
    expect(mocks.getPublishedPost).not.toHaveBeenCalled()
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it.each(['', '?stage=draft'])('默认或显式草稿只导出已保存草稿，UTF-8附件且不缓存：%s', async query => {
    const response = await GET(request(query), { params: Promise.resolve({ id }) })
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/markdown; charset=utf-8')
    expect(response.headers.get('Content-Disposition')).toBe(`attachment; filename="${id}.md"`)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    const source = new TextDecoder('utf-8', { fatal: true }).decode(await response.arrayBuffer())
    expect(source).toBe(serializeMarkdownFile(draft))
    expect(source.endsWith(draft.body)).toBe(true)
    expect(source).not.toContain(draft.accessToken)
    expect(mocks.getDraft).toHaveBeenCalledExactlyOnceWith(id)
    expect(mocks.getPublishedPost).not.toHaveBeenCalled()
  })

  it('显式published只导出公开快照，不落回草稿', async () => {
    const response = await GET(request('?stage=published'), { params: Promise.resolve({ id }) })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe(serializeMarkdownFile(published))
    expect(mocks.getPublishedPost).toHaveBeenCalledExactlyOnceWith(id)
    expect(mocks.getDraft).not.toHaveBeenCalled()
  })

  it.each(['?stage=', '?stage=other', '?stage=draft&stage=published', '?stage=draft&stage=draft'])(
    '非法或重复stage返回400，不读取快照：%s', async query => {
      const response = await GET(request(query), { params: Promise.resolve({ id }) })
      expect(response.status).toBe(400)
      expect(mocks.getDraft).not.toHaveBeenCalled()
      expect(mocks.getPublishedPost).not.toHaveBeenCalled()
      expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    },
  )

  it.each(['draft', 'published'])('%s快照缺失返回404，不伪装成功或回退其他快照', async stage => {
    mocks.getDraft.mockReturnValue(null)
    mocks.getPublishedPost.mockReturnValue(null)
    const response = await GET(request(`?stage=${stage}`), { params: Promise.resolve({ id }) })
    expect(response.status).toBe(404)
    expect(response.headers.get('Content-Disposition')).toBeNull()
    if (stage === 'draft') expect(mocks.getPublishedPost).not.toHaveBeenCalled()
    else expect(mocks.getDraft).not.toHaveBeenCalled()
  })

  it.each([
    { ...draft, id: 'not-a-uuid' },
    { ...draft, title: '  ' },
  ])('已保存快照不符合文件契约时返回422而不是不安全附件', async invalid => {
    mocks.getDraft.mockReturnValue(invalid)
    const response = await GET(request(), { params: Promise.resolve({ id }) })
    expect(response.status).toBe(422)
    expect(await response.text()).toBe('This post does not satisfy the Markdown file format. Review its ID and content.')
    expect(response.headers.get('Content-Disposition')).toBeNull()
  })

  it.each(['connection', 'query'])('%s存储故障返回500并记录原始错误，不当作401或404', async kind => {
    const error = new Error('Private SQL detail')
    if (kind === 'connection') mocks.withAdminPostStore.mockRejectedValue(error)
    else mocks.getDraft.mockImplementation(() => { throw error })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const response = await GET(request(), { params: Promise.resolve({ id }) })
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('Could not export the Markdown file. Please try again.')
    expect(log).toHaveBeenCalledWith('导出 Markdown 文件失败。', error)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  })

  it('Next控制流不被错误响应吞掉', async () => {
    const navigation = await vi.importActual<typeof import('next/navigation')>('next/navigation')
    let signal: unknown
    try { navigation.redirect('/admin/login') } catch (error) { signal = error }
    mocks.withAdminPostStore.mockRejectedValue(signal)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(GET(request(), { params: Promise.resolve({ id }) })).rejects.toBe(signal)
    expect(log).not.toHaveBeenCalled()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import robots from './robots'
import sitemap from './sitemap'

vi.mock('@/modules/posts/server/public', () => ({
  getBlogPosts: async () => [
    { id: '3f4229bc-e848-47fc-88b0-358c90b111b5' },
    { id: '68767e8c-c86e-4b97-bb15-356c2553f49c' },
  ],
}))

vi.mock('@/modules/gallery/server/public', () => ({
  getGalleryItems: async () => [
    { id: '912d6c40-2a8e-4c1b-8a05-44f22c980111' },
  ],
}))

afterEach(() => vi.unstubAllEnvs())

describe('公开站点爬虫入口', () => {
  it('列出首页、博客、画廊及已发布文章与画廊条目的完整公开地址', async () => {
    vi.stubEnv('SITE_URL', 'https://example.test')
    expect(await sitemap()).toEqual([
      { url: 'https://example.test/' },
      { url: 'https://example.test/blog' },
      { url: 'https://example.test/gallery' },
      { url: 'https://example.test/blog/3f4229bc-e848-47fc-88b0-358c90b111b5' },
      { url: 'https://example.test/blog/68767e8c-c86e-4b97-bb15-356c2553f49c' },
      { url: 'https://example.test/gallery/912d6c40-2a8e-4c1b-8a05-44f22c980111' },
    ])
  })

  it('robots 声明公开抓取规则与同一站点的地图地址', () => {
    vi.stubEnv('SITE_URL', 'https://example.test')
    expect(robots()).toEqual({
      rules: { userAgent: '*', allow: '/' },
      sitemap: 'https://example.test/sitemap.xml',
    })
  })
})

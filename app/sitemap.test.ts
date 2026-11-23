import { afterEach, describe, expect, it, vi } from 'vitest'
import robots from './robots'
import sitemap from './sitemap'

vi.mock('@/modules/posts/server/public', () => ({
  getBlogPosts: async () => [
    { id: '3f4229bc-e848-47fc-88b0-358c90b111b5' },
    { id: '68767e8c-c86e-4b97-bb15-356c2553f49c' },
  ],
}))

afterEach(() => vi.unstubAllEnvs())

describe('公开站点爬虫入口', () => {
  it('列出首页、文章索引及每篇已发布文章的完整公开地址', async () => {
    vi.stubEnv('SITE_URL', 'https://example.test')
    expect(await sitemap()).toEqual([
      { url: 'https://example.test/' },
      { url: 'https://example.test/blog' },
      { url: 'https://example.test/blog/3f4229bc-e848-47fc-88b0-358c90b111b5' },
      { url: 'https://example.test/blog/68767e8c-c86e-4b97-bb15-356c2553f49c' },
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

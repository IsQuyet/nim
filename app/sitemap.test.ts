import { afterEach, describe, expect, it, vi } from 'vitest'
import robots from './robots'
import sitemap from './sitemap'

vi.mock('./data', () => ({
  BLOG_POSTS: [
    { link: '/blog/first-post' },
    { link: '/blog/second-post' },
  ],
}))

afterEach(() => vi.unstubAllEnvs())

describe('公开站点爬虫入口', () => {
  it('列出首页及每篇文章的完整公开地址', () => {
    vi.stubEnv('SITE_URL', 'https://example.test')
    expect(sitemap()).toEqual([
      { url: 'https://example.test/' },
      { url: 'https://example.test/blog/first-post' },
      { url: 'https://example.test/blog/second-post' },
    ])
  })

  it('robots 声明同一站点的地图地址，保留现有抓取规则', () => {
    vi.stubEnv('SITE_URL', 'https://example.test')
    expect(robots()).toEqual({
      rules: { userAgent: '*', allow: '/', disallow: '/private/' },
      sitemap: 'https://example.test/sitemap.xml',
    })
  })
})
